import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import User from '../models/user.model.js';
import { TestMongoReplicaSet } from './helpers/testMongo.js';
import {
  computeNextRecoveryEpoch,
  acquireRecoveryLeaseStep1,
  acquireRecoveryLeaseStep2,
  executeMilestoneA,
  executeReplicaSetMilestoneB,
  executeStandaloneMilestoneC,
} from '../services/reconciler.service.js';

describe('NEXA 2.0 Milestone 3.3 — Domain 4: Real MongoDB Replica Set Integration Tests', () => {
  const rs = new TestMongoReplicaSet();
  const testDeviceId = 'NEXA-RS-DEV-001';
  const testOperationId = 'OP-RS-TEST-001';
  let client;
  let testUserId;
  let testSessionId;

  before(async () => {
    const started = await rs.start();
    client = started.client;

    const user = await User.create({
      email: `rs_test_${Date.now()}@nexa.ai`,
      password: 'TemporaryPassword123',
    });
    testUserId = user._id;
  });

  after(async () => {
    await rs.stop();
  });

  beforeEach(async () => {
    await Device.deleteMany({ deviceId: testDeviceId });
    await PairingSession.deleteMany({ userId: testUserId });

    await Device.create({
      deviceId: testDeviceId,
      deviceName: 'Replica Set Anchor Workstation',
      userId: testUserId,
      deviceGeneration: 1,
      hashedMasterRecoveryCode: crypto.createHash('sha256').update('RS-CODE').digest('hex'),
      stagedDeviceToken: {
        operationId: testOperationId,
        hashedToken: 'rs_staged_token',
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
      pairingCode: 'RS-9999',
      expiresAt: new Date(Date.now() + 600000),
      status: 'delivering',
      operationId: testOperationId,
      encryptedCredentialBundle: { ciphertext: 'rs_encrypted_bundle' },
      recoveryLease: {
        workerId: null,
        recoveryEpoch: 0,
        fencedEpoch: 0,
        expiresAt: null,
        state: 'idle',
      },
    });
    testSessionId = session._id.toString();
  });

  it('test_replica_set_acid_milestone_b_and_idempotency: commits Milestone B in multi-doc transaction and supports idempotent repeat', async () => {
    const W1 = 'rs_worker_1';
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

    const res1 = await executeReplicaSetMilestoneB({
      client,
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch1,
    });
    assert.equal(res1.success, true);

    // Idempotent repeat
    const res2 = await executeReplicaSetMilestoneB({
      client,
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch1,
    });
    assert.equal(res2.success, true);
    assert.equal(res2.idempotentRepeat, true);

    await executeStandaloneMilestoneC({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: epoch1,
    });

    const finalSession = await PairingSession.findById(testSessionId);
    const finalDevice = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(finalSession.status, 'failed_rolled_back');
    assert.equal(finalSession.encryptedCredentialBundle, null);
    assert.equal(finalSession.recoveryLease.state, 'completed');
    assert.equal(finalDevice.activePairingLock.state, 'idle');
    assert.equal(finalDevice.activePairingLock.recoveryEpoch, 1);
  });

  it('test_replica_set_concurrent_w1_w2_takeover: only W2 at epoch 2 commits; stale W1 at epoch 1 is rejected', async () => {
    const W1 = 'rs_concurrent_w1';
    const W2 = 'rs_concurrent_w2';

    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });
    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });
    await executeMilestoneA({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });

    // W1 stalls and leases expire
    await Device.updateOne(
      { deviceId: testDeviceId },
      { $set: { 'activePairingLock.recoveryLeaseExpiresAt': new Date(Date.now() - 1000) } }
    );
    await PairingSession.findByIdAndUpdate(testSessionId, {
      $set: { 'recoveryLease.expiresAt': new Date(Date.now() - 1000) },
    });

    // W2 takes over at epoch 2
    const epoch2 = await computeNextRecoveryEpoch(testDeviceId, testSessionId);
    assert.equal(epoch2, 2);

    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: epoch2,
    });
    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: epoch2,
    });

    // Concurrent execution of Milestone B by stale W1 and active W2
    const [w1Outcome, w2Outcome] = await Promise.allSettled([
      executeReplicaSetMilestoneB({
        client,
        deviceId: testDeviceId,
        sessionId: testSessionId,
        operationId: testOperationId,
        workerId: W1,
        assignedEpoch: 1,
      }),
      executeReplicaSetMilestoneB({
        client,
        deviceId: testDeviceId,
        sessionId: testSessionId,
        operationId: testOperationId,
        workerId: W2,
        assignedEpoch: epoch2,
      }),
    ]);

    assert.equal(w1Outcome.status, 'rejected');
    assert.equal(w1Outcome.reason.statusCode, 409);
    assert.equal(w2Outcome.status, 'fulfilled');
    assert.equal(w2Outcome.value.success, true);

    const finalSession = await PairingSession.findById(testSessionId);
    assert.equal(finalSession.status, 'failed_rolled_back');
    assert.equal(finalSession.recoveryLease.recoveryEpoch, 2);
    assert.equal(finalSession.recoveryLease.workerId, W2);
  });

  it('test_replica_set_transaction_rollback_and_crash: aborted transaction leaves no partial writes and allows clean recovery', async () => {
    const W1 = 'rs_tx_abort_w1';
    const W2 = 'rs_tx_recover_w2';

    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });
    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });
    await executeMilestoneA({
      deviceId: testDeviceId,
      operationId: testOperationId,
      workerId: W1,
      assignedEpoch: 1,
    });

    // Simulate a transaction that mutates Device then hits a failure (aborting the transaction)
    const txSession = client.startSession();
    await assert.rejects(
      async () => {
        await txSession.withTransaction(async () => {
          await Device.updateOne(
            { deviceId: testDeviceId },
            { $set: { 'activePairingLock.milestoneState': 'milestone_b_in_progress' } },
            { session: txSession }
          );
          throw new Error('SIMULATED_CRASH_MID_TRANSACTION');
        });
      },
      /SIMULATED_CRASH_MID_TRANSACTION/
    );
    await txSession.endSession();

    // Verify rollback: Device milestoneState was NOT persisted as milestone_b_in_progress
    const devAfterRollback = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(devAfterRollback.activePairingLock.milestoneState, 'milestone_a_done');

    // Also test executeReplicaSetMilestoneB rollback when session is fenced at higher epoch
    await PairingSession.findByIdAndUpdate(testSessionId, {
      $set: { 'recoveryLease.fencedEpoch': 2 },
    });

    await assert.rejects(
      async () => {
        await executeReplicaSetMilestoneB({
          client,
          deviceId: testDeviceId,
          sessionId: testSessionId,
          operationId: testOperationId,
          workerId: W1,
          assignedEpoch: 1,
        });
      },
      (err) => err.statusCode === 409 && err.message.includes('REPLICA_SET_SESSION_LOST')
    );

    const sessionAfterReject = await PairingSession.findById(testSessionId);
    assert.equal(sessionAfterReject.status, 'rolling_back');
    assert.deepEqual(sessionAfterReject.encryptedCredentialBundle, { ciphertext: 'rs_encrypted_bundle' });

    // W2 recovers after W1's lease expires
    await Device.updateOne(
      { deviceId: testDeviceId },
      { $set: { 'activePairingLock.recoveryLeaseExpiresAt': new Date(Date.now() - 1000) } }
    );
    await PairingSession.findByIdAndUpdate(testSessionId, {
      $set: { 'recoveryLease.expiresAt': new Date(Date.now() - 1000) },
    });

    const epoch3 = await computeNextRecoveryEpoch(testDeviceId, testSessionId);
    assert.equal(epoch3, 3);

    await acquireRecoveryLeaseStep1({
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: epoch3,
    });
    await acquireRecoveryLeaseStep2({
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: epoch3,
    });
    await executeReplicaSetMilestoneB({
      client,
      deviceId: testDeviceId,
      sessionId: testSessionId,
      operationId: testOperationId,
      workerId: W2,
      assignedEpoch: epoch3,
    });

    const recoveredSession = await PairingSession.findById(testSessionId);
    assert.equal(recoveredSession.status, 'failed_rolled_back');
    assert.equal(recoveredSession.encryptedCredentialBundle, null);
    assert.equal(recoveredSession.recoveryLease.recoveryEpoch, 3);
  });
});
