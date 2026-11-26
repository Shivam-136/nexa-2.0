import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import crypto from 'node:crypto';

import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import User from '../models/user.model.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';
import {
  computeNextRecoveryEpoch,
  acquireRecoveryLeaseStep1,
  acquireRecoveryLeaseStep2,
  releaseCompensatoryDeviceLease,
  executeMilestoneA,
  executeStandaloneMilestoneB,
  executeStandaloneMilestoneC,
} from '../services/reconciler.service.js';

describe('NEXA 2.0 Milestone 3.3 — Domain 3: Cross-Document Recovery Lease & Standalone Safety', () => {
  const testDeviceId = 'NEXA-RECOVERY-DEV-001';
  let testUserId;
  let testSessionId;
  const testOperationId = 'OP-RECOVERY-TEST-999';

  before(async () => {
    await startTestMongo(27019);

    const user = await User.create({
      email: `recovery_test_${Date.now()}@nexa.ai`,
      password: 'TemporaryPassword123',
    });
    testUserId = user._id;
  });

  after(async () => {
    await stopTestMongo();
  });

  beforeEach(async () => {
    await Device.deleteMany({ deviceId: testDeviceId });
    await PairingSession.deleteMany({ userId: testUserId });

    await Device.create({
      deviceId: testDeviceId,
      deviceName: 'Recovery Anchor Test Workstation',
      userId: testUserId,
      deviceGeneration: 1,
      hashedMasterRecoveryCode: crypto.createHash('sha256').update('TEST-CODE').digest('hex'),
      stagedDeviceToken: {
        operationId: testOperationId,
        hashedToken: 'staged_token_for_recovery_revocation',
      },
      hashedDeviceToken: null,
      activePairingLock: {
        state: 'in_pairing',
        operationId: testOperationId,
        recoveryWorkerId: null,
        recoveryEpoch: 0,
        recoveryLeaseExpiresAt: null,
        milestoneState: 'idle',
        deliveryFence: {
          fencingToken: 0,
        },
      },
    });

    const session = await PairingSession.create({
      userId: testUserId,
      pairingCode: 'RCV-9999',
      expiresAt: new Date(Date.now() + 600000),
      status: 'delivering',
      operationId: testOperationId,
      encryptedCredentialBundle: { ciphertext: 'some_encrypted_bundle' },
      recoveryLease: {
        workerId: null,
        recoveryEpoch: 0,
        expiresAt: null,
        state: 'idle',
      },
    });
    testSessionId = session._id.toString();
  });

  // =========================================================================
  // TEST 11: Milestone B Fails Immediately if Anchor Lost (Stale Worker Fenced Out)
  // =========================================================================
  it('test_recovery_lease_milestone_b_fails_if_anchor_lost: stale worker W1 rejected on Device anchor pre-check with 409', async () => {
    const W1 = 'worker_w1_instance_a';
    const W2 = 'worker_w2_instance_b';

    // 1. Worker W1 calculates epoch 1 and acquires Step 1 and Step 2
    const epoch1 = await computeNextRecoveryEpoch(testDeviceId, testSessionId);
    assert.equal(epoch1, 1);

    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch1,
      leaseTtlMs: 30000,
    });

    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch1,
      leaseTtlMs: 30000,
    });

    // W1 commits Milestone A
    await executeMilestoneA({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch1,
    });

    // 2. W1 experiences OS pause: Device lease expires on primary
    await Device.updateOne(
      { deviceId: testDeviceId },
      { $set: { 'activePairingLock.recoveryLeaseExpiresAt': new Date(Date.now() - 5000) } }
    );

    // 3. Worker W2 detects expired lease on Device; calculates epoch 2 and takes over Device
    const epoch2 = await computeNextRecoveryEpoch(testDeviceId, testSessionId);
    assert.equal(epoch2, 2);

    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: epoch2,
      leaseTtlMs: 30000,
    });

    const deviceAfterW2 = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(deviceAfterW2.activePairingLock.recoveryWorkerId, W2);
    assert.equal(deviceAfterW2.activePairingLock.recoveryEpoch, 2);

    // 4. Stale Worker W1 wakes up and attempts Milestone B at Epoch 1
    // CRITICAL: Milestone B MUST FAIL on Device anchor pre-check!
    await assert.rejects(
      async () => {
        await executeStandaloneMilestoneB({
          deviceId: testDeviceId,
          sessionId: testSessionId,
          operationId: testOperationId,
          workerId: W1,
          assignedEpoch: epoch1,
        });
      },
      (err) => {
        assert.equal(err.name, 'SecurityError');
        assert.equal(err.statusCode, 409);
        assert.ok(err.message.includes('MILESTONE_B_ANCHOR_FENCED_OUT'));
        return true;
      }
    );

    // 5. INVARIANT: Stale W1 NEVER finalized PairingSession!
    const sessionAfterStaleAttempt = await PairingSession.findById(testSessionId);
    assert.notEqual(sessionAfterStaleAttempt.status, 'failed_rolled_back');
    assert.notEqual(sessionAfterStaleAttempt.recoveryLease.state, 'milestone_b_done');
  });

  // =========================================================================
  // TEST 12: Recovery Epoch is Strictly Monotonic & NEVER Reset to Null
  // =========================================================================
  it('test_recovery_epoch_never_resets_to_null: compensatory release and Milestone C strictly preserve epoch integer', async () => {
    const W1 = 'worker_w1';

    // 1. Acquire Step 1 at epoch 1
    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });

    // 2. Compensatory release
    await releaseCompensatoryDeviceLease({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });

    // Invariant: worker is null, but epoch integer 1 is PRESERVED!
    const devAfterComp = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(devAfterComp.activePairingLock.recoveryWorkerId, null);
    assert.equal(devAfterComp.activePairingLock.recoveryEpoch, 1);

    // 3. Next acquisition calculates epoch = max(1, 0) + 1 = 2
    const nextEpoch = await computeNextRecoveryEpoch(testDeviceId, testSessionId);
    assert.equal(nextEpoch, 2);

    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: 'worker_w2',
      assignedEpoch: 2,
    });

    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: 'worker_w2',
      assignedEpoch: 2,
    });

    await executeMilestoneA({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: 'worker_w2',
      assignedEpoch: 2,
    });

    await executeStandaloneMilestoneB({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: 'worker_w2',
      assignedEpoch: 2,
    });

    // 4. Milestone C final release
    await executeStandaloneMilestoneC({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: 'worker_w2',
      assignedEpoch: 2,
    });

    // Invariant: Device is idle, worker is null, recoveryEpoch remains integer 2!
    const devAfterC = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(devAfterC.activePairingLock.state, 'idle');
    assert.equal(devAfterC.activePairingLock.recoveryWorkerId, null);
    assert.equal(devAfterC.activePairingLock.recoveryEpoch, 2);
  });

  // =========================================================================
  // TEST 13: Partial Acquisition Triggers Immediate Compensatory Release
  // =========================================================================
  it('test_recovery_partial_acquisition_compensatory_release: Step 2 failure triggers compensatory release of Device lease', async () => {
    const W1 = 'worker_partial_w1';
    const otherWorker = 'competing_worker';

    // Set active unexpired lease on PairingSession to cause Step 2 to fail
    await PairingSession.findByIdAndUpdate(testSessionId, {
      'recoveryLease.workerId': otherWorker,
      'recoveryLease.recoveryEpoch': 5,
      'recoveryLease.expiresAt': new Date(Date.now() + 60000),
    });

    const epoch = await computeNextRecoveryEpoch(testDeviceId, testSessionId);
    assert.equal(epoch, 6);

    // Step 1 on Device succeeds
    const step1 = await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch,
    });
    assert.equal(step1.success, true);

    // Step 2 on PairingSession fails because held by otherWorker
    let step2Failed = false;
    try {
      await acquireRecoveryLeaseStep2({
        sessionId: testSessionId,
        operationId: testOperationId,
        workerId: W1,
        assignedEpoch: epoch,
      });
    } catch (err) {
      step2Failed = true;
      // Compensatory Release
      await releaseCompensatoryDeviceLease({
        deviceId: testDeviceId,
        operationId: testOperationId,
        workerId: W1,
        assignedEpoch: epoch,
      });
    }

    assert.equal(step2Failed, true);

    // Assert Device lease was cleanly released for subsequent workers
    const dev = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(dev.activePairingLock.recoveryWorkerId, null);
    assert.equal(dev.activePairingLock.recoveryLeaseExpiresAt, null);
    assert.equal(dev.activePairingLock.recoveryEpoch, 6);
  });

  // =========================================================================
  // TEST 14: Full Adversarial Takeover Sequence (W1 / W2 Timeline)
  // =========================================================================
  it('test_adversarial_w1_w2_takeover_sequence: complete adversarial timeline succeeds with perfect consistency', async () => {
    const W1 = 'adversarial_worker_1';
    const W2 = 'adversarial_worker_2';

    // T = 1: W1 acquires Device lease at Epoch 1
    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });

    // T = 2: W1 acquires Session lease at Epoch 1
    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });

    // T = 3: W1 commits Milestone A
    await executeMilestoneA({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });

    // T = 4: W1 stalls; leases expire on primary
    await Device.updateOne(
      { deviceId: testDeviceId },
      { $set: { 'activePairingLock.recoveryLeaseExpiresAt': new Date(Date.now() - 1000) } }
    );
    await PairingSession.findByIdAndUpdate(testSessionId, {
      $set: { 'recoveryLease.expiresAt': new Date(Date.now() - 1000) } },
    );

    // T = 5: W2 acquires Device and Session at Epoch 2
    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: 2,
    });
    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: 2,
    });

    // T = 6: W1 wakes up; attempts Milestone B and is FENCED OUT
    await assert.rejects(
      async () => {
        await executeStandaloneMilestoneB({
          deviceId: testDeviceId,
          sessionId: testSessionId,
          operationId: testOperationId,
          workerId: W1,
          assignedEpoch: 1,
        });
      },
      /MILESTONE_B_ANCHOR_FENCED_OUT/
    );

    // T = 7: W2 completes Milestone B and Milestone C cleanly
    await executeStandaloneMilestoneB({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: 2,
    });

    await executeStandaloneMilestoneC({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: 2,
    });

    // Final Invariants Check
    const finalDevice = await Device.findOne({ deviceId: testDeviceId });
    const finalSession = await PairingSession.findById(testSessionId);

    assert.equal(finalSession.status, 'failed_rolled_back');
    assert.equal(finalSession.encryptedCredentialBundle, null);
    assert.equal(finalSession.recoveryLease.state, 'milestone_b_done');
    assert.equal(finalSession.recoveryLease.recoveryEpoch, 2);

    assert.equal(finalDevice.activePairingLock.state, 'idle');
    assert.equal(finalDevice.activePairingLock.recoveryWorkerId, null);
    assert.equal(finalDevice.activePairingLock.recoveryEpoch, 2);
    assert.equal(finalDevice.stagedDeviceToken, null);
  });

  // =========================================================================
  // TEST 15: Standalone Milestone B Post-Verification Detects Expired Anchor
  // =========================================================================
  it('test_standalone_milestone_b_post_verification: anchor post-check detects mid-operation timeout and throws 409', async () => {
    const W1 = 'worker_mid_timeout';
    const epoch = 10;

    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch,
      leaseTtlMs: 30000,
    });

    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch,
      leaseTtlMs: 30000,
    });

    // Hook: right before or during step 2, expire the device anchor
    // To test post-check, we set leaseExpiresAt to 50ms in the future and wait 60ms
    await Device.updateOne(
      { deviceId: testDeviceId },
      { $set: { 'activePairingLock.recoveryLeaseExpiresAt': new Date(Date.now() + 40) } }
    );

    await new Promise((resolve) => setTimeout(resolve, 60));

    await assert.rejects(
      async () => {
        await executeStandaloneMilestoneB({
          deviceId: testDeviceId,
          sessionId: testSessionId,
          operationId: testOperationId,
          workerId: W1,
          assignedEpoch: epoch,
        });
      },
      /MILESTONE_B_ANCHOR_FENCED_OUT|ANCHOR_LOST_DURING_MILESTONE_B/
    );
  });

  // =========================================================================
  // TEST 16: Exact TOCTOU Interleaving — W1 Paused After Anchor Pre-Check, W2 Takes Over
  // =========================================================================
  it('test_standalone_toctou_w1_paused_after_precheck_w2_takeover: W1 NEVER finalizes PairingSession after W2 takes over Device', async () => {
    const W1 = 'toctou_worker_1';
    const W2 = 'toctou_worker_2';

    const epoch1 = await computeNextRecoveryEpoch(testDeviceId, testSessionId);
    assert.equal(epoch1, 1);

    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch1,
    });

    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch1,
    });

    await executeMilestoneA({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch1,
    });

    // W1 enters executeStandaloneMilestoneB, passes anchorPreCheck, and pauses BEFORE PairingSession.updateOne
    await assert.rejects(
      async () => {
        await executeStandaloneMilestoneB({
          deviceId: testDeviceId,
          sessionId: testSessionId,
          operationId: testOperationId,
          workerId: W1,
          assignedEpoch: epoch1,
          onAnchorPreCheckComplete: async () => {
            // Simulate W1 stall: Device lease expires while W1 is paused mid-Milestone B
            await Device.updateOne(
              { deviceId: testDeviceId },
              { $set: { 'activePairingLock.recoveryLeaseExpiresAt': new Date(Date.now() - 1000) } }
            );

            // W2 computes next epoch and takes over Device (which fences PairingSession first!)
            const epoch2 = await computeNextRecoveryEpoch(testDeviceId, testSessionId);
            assert.equal(epoch2, 2);

            await acquireRecoveryLeaseStep1({
              deviceId: testDeviceId,
              sessionId: testSessionId,
              operationId: testOperationId,
              workerId: W2,
              assignedEpoch: epoch2,
            });
          },
        });
      },
      (err) => {
        assert.equal(err.name, 'SecurityError');
        assert.equal(err.statusCode, 409);
        assert.ok(err.message.includes('MILESTONE_B_SESSION_FENCED_OUT'));
        return true;
      }
    );

    // CRITICAL INVARIANT: PairingSession was NEVER finalized by W1!
    const sessionMid = await PairingSession.findById(testSessionId);
    assert.equal(sessionMid.status, 'rolling_back');
    assert.deepEqual(sessionMid.encryptedCredentialBundle, { ciphertext: 'some_encrypted_bundle' });
    assert.equal(sessionMid.recoveryLease.fencedEpoch, 2);

    // W2 completes Step 2, Milestone B, and Milestone C cleanly (with PairingSession lease expired or overtaken)
    await PairingSession.findByIdAndUpdate(testSessionId, {
      $set: { 'recoveryLease.expiresAt': new Date(Date.now() - 1000) },
    });

    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: 2,
    });

    await executeStandaloneMilestoneB({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: 2,
    });

    await executeStandaloneMilestoneC({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: 2,
    });

    const finalSession = await PairingSession.findById(testSessionId);
    assert.equal(finalSession.status, 'failed_rolled_back');
    assert.equal(finalSession.encryptedCredentialBundle, null);
    assert.equal(finalSession.recoveryLease.recoveryEpoch, 2);
  });

  // =========================================================================
  // TEST 17: Idempotent Finalization & Worker Crash Recovery
  // =========================================================================
  it('test_standalone_milestone_b_idempotent_and_crash_recovery: repeated Milestone B is idempotent and crashed W2 is superseded by W3', async () => {
    const W2 = 'crash_worker_2';
    const W3 = 'recovery_worker_3';

    // W2 acquires Step 1 and then crashes (lease expires) before Step 2
    const epoch2 = await computeNextRecoveryEpoch(testDeviceId, testSessionId);
    assert.equal(epoch2, 1);
    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: epoch2,
    });

    await Device.updateOne(
      { deviceId: testDeviceId },
      { $set: { 'activePairingLock.recoveryLeaseExpiresAt': new Date(Date.now() - 1000) } }
    );

    // W3 recovers at epoch 2
    const epoch3 = await computeNextRecoveryEpoch(testDeviceId, testSessionId);
    assert.equal(epoch3, 2);

    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W3,
      assignedEpoch: epoch3,
    });
    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W3,
      assignedEpoch: epoch3,
    });
    await executeMilestoneA({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W3,
      assignedEpoch: epoch3,
    });

    // First Milestone B finalization
    const firstB = await executeStandaloneMilestoneB({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W3,
      assignedEpoch: epoch3,
    });
    assert.equal(firstB.success, true);

    // Idempotent repeat of Milestone B by same worker W3 at epoch 3
    const repeatB = await executeStandaloneMilestoneB({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W3,
      assignedEpoch: epoch3,
    });
    assert.equal(repeatB.success, true);
    assert.equal(repeatB.idempotentRepeat, true);
  });
});
