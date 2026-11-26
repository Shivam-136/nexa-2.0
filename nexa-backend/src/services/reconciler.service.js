/**
 * NEXA 2.0 Backend - Cross-Document Recovery Lease & Reconciler Service
 * Phase 6 — Milestone 3.3 Domain 3: Cross-Document Recovery Lease & Standalone Safety
 *
 * Implements Anchor-First Sequential Locking Protocol:
 * - Step 1: Acquire Device anchor lease
 * - Step 2: Acquire PairingSession coordinator lease
 * - Milestone A: Commit revocation on Device
 * - Milestone B: Anchor Pre-Check CAS -> Finalize PairingSession -> Anchor Post-Check
 * - Milestone C: Release Device lock to idle with strict epoch preservation
 * - Compensatory Release on partial acquisition failure
 * - Support for both Standalone MongoDB sequential CAS and Replica Set multi-document transactions
 */

import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import { SecurityError } from '../utils/security.errors.js';

/**
 * Calculates the next strictly monotonic recovery epoch across both documents.
 */
export async function computeNextRecoveryEpoch(deviceId, sessionId) {
  const [deviceDoc, sessionDoc] = await Promise.all([
    Device.findOne({ deviceId }),
    sessionId ? PairingSession.findById(sessionId) : null,
  ]);

  const devEpoch = deviceDoc?.activePairingLock?.recoveryEpoch ?? 0;
  const sessEpoch = sessionDoc?.recoveryLease?.recoveryEpoch ?? 0;
  const sessFencedEpoch = sessionDoc?.recoveryLease?.fencedEpoch ?? 0;

  return Math.max(devEpoch, sessEpoch, sessFencedEpoch) + 1;
}

/**
 * Step 1: Acquire recovery lease on Device (Anchor Document).
 *
 * Standalone Safety Protocol:
 * 1. Verify Device anchor lease is currently free or expired (and epoch < assignedEpoch).
 * 2. Fence PairingSession (`recoveryLease.fencedEpoch = assignedEpoch`) BEFORE taking over Device,
 *    preventing any paused stale worker from finalizing PairingSession after Device takeover.
 * 3. Atomically acquire Device anchor lease with monotonic epoch guard.
 */
export async function acquireRecoveryLeaseStep1({
  deviceId,
  sessionId = null,
  operationId,
  workerId,
  assignedEpoch,
  leaseTtlMs = 30000,
}) {
  const anchorAvailableQuery = {
    deviceId,
    'activePairingLock.recoveryEpoch': { $lt: assignedEpoch },
    $or: [
      { 'activePairingLock.recoveryWorkerId': null },
      { $expr: { $lte: ['$activePairingLock.recoveryLeaseExpiresAt', '$$NOW'] } },
    ],
  };

  // Pre-flight check: do not fence PairingSession if Device is actively held by an unexpired worker
  const availableDevice = await Device.findOne(anchorAvailableQuery).lean();
  if (!availableDevice) {
    throw new SecurityError(
      `RECOVERY_STEP1_FAILED: Device anchor lock currently held by another worker or epoch not monotonic`,
      409
    );
  }

  // Fence PairingSession BEFORE acquiring Device anchor so a paused stale worker
  // cannot finalize PairingSession after losing Device.
  const sessionFilter = sessionId ? { _id: sessionId } : { operationId };
  const existingSession = await PairingSession.findOne(sessionFilter).lean();
  if (sessionId && !existingSession) {
    throw new SecurityError(`RECOVERY_STEP1_FAILED: PairingSession ${sessionId} not found`, 404);
  }

  if (existingSession) {
    const fencedSession = await PairingSession.findOneAndUpdate(
      {
        ...sessionFilter,
        status: { $nin: ['failed_rolled_back', 'completed'] },
        $expr: {
          $lte: [{ $ifNull: ['$recoveryLease.fencedEpoch', 0] }, assignedEpoch],
        },
      },
      [
        {
          $set: {
            'recoveryLease.fencedEpoch': {
              $max: [{ $ifNull: ['$recoveryLease.fencedEpoch', 0] }, assignedEpoch],
            },
          },
        },
      ],
      { returnDocument: 'after', updatePipeline: true }
    );

    if (!fencedSession) {
      throw new SecurityError(
        `RECOVERY_STEP1_FENCE_FAILED: PairingSession already finalized or fenced at a higher epoch`,
        409
      );
    }
  }

  const updatePipeline = [
    {
      $set: {
        'activePairingLock.operationId': operationId,
        'activePairingLock.recoveryWorkerId': workerId,
        'activePairingLock.recoveryEpoch': assignedEpoch,
        'activePairingLock.recoveryLeaseExpiresAt': { $add: ['$$NOW', leaseTtlMs] },
        'activePairingLock.milestoneState': 'idle',
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updated = await Device.findOneAndUpdate(anchorAvailableQuery, updatePipeline, options);
  if (!updated) {
    throw new SecurityError(
      `RECOVERY_STEP1_FAILED: Device anchor lock currently held by another worker`,
      409
    );
  }

  return {
    success: true,
    deviceId: updated.deviceId,
    assignedEpoch,
    leaseExpiresAt: updated.activePairingLock.recoveryLeaseExpiresAt,
  };
}

/**
 * Step 2: Acquire recovery lease on PairingSession (Coordinator Document).
 */
export async function acquireRecoveryLeaseStep2({
  sessionId,
  operationId,
  workerId,
  assignedEpoch,
  leaseTtlMs = 30000,
}) {
  const query = {
    _id: sessionId,
    status: { $nin: ['failed_rolled_back', 'completed'] },
    $expr: {
      $and: [
        {
          $or: [
            { $eq: ['$recoveryLease.workerId', null] },
            { $lte: ['$recoveryLease.expiresAt', '$$NOW'] },
          ],
        },
        { $lte: [{ $ifNull: ['$recoveryLease.fencedEpoch', 0] }, assignedEpoch] },
      ],
    },
  };

  const updatePipeline = [
    {
      $set: {
        'recoveryLease.workerId': workerId,
        'recoveryLease.recoveryEpoch': assignedEpoch,
        'recoveryLease.expiresAt': { $add: ['$$NOW', leaseTtlMs] },
        'recoveryLease.state': 'lease_acquired',
        status: 'rolling_back',
        operationId,
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updated = await PairingSession.findOneAndUpdate(query, updatePipeline, options);
  if (!updated) {
    throw new SecurityError(
      `RECOVERY_STEP2_FAILED: PairingSession lease held by another worker`,
      409
    );
  }

  return {
    success: true,
    sessionId: updated._id,
    assignedEpoch,
    leaseExpiresAt: updated.recoveryLease.expiresAt,
  };
}

/**
 * Compensatory Release: Clears Step 1 Device lease if Step 2 fails.
 * STRICT INVARIANT: recoveryEpoch is preserved as an integer and NEVER reset to null!
 */
export async function releaseCompensatoryDeviceLease({
  deviceId,
  operationId,
  workerId,
  assignedEpoch,
}) {
  const query = {
    deviceId,
    'activePairingLock.operationId': operationId,
    'activePairingLock.recoveryWorkerId': workerId,
    'activePairingLock.recoveryEpoch': assignedEpoch,
  };

  const updatePipeline = [
    {
      $set: {
        'activePairingLock.recoveryWorkerId': null,
        'activePairingLock.recoveryLeaseExpiresAt': null,
        'activePairingLock.milestoneState': 'idle',
        // recoveryEpoch is strictly PRESERVED!
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updated = await Device.findOneAndUpdate(query, updatePipeline, options);
  return Boolean(updated);
}

/**
 * Milestone A: Commit revocation on Device anchor document.
 */
export async function executeMilestoneA({
  deviceId,
  operationId,
  workerId,
  assignedEpoch,
}) {
  const query = {
    deviceId,
    'activePairingLock.operationId': operationId,
    'activePairingLock.recoveryWorkerId': workerId,
    'activePairingLock.recoveryEpoch': assignedEpoch,
    $expr: {
      $gt: ['$activePairingLock.recoveryLeaseExpiresAt', '$$NOW'],
    },
  };

  const updatePipeline = [
    {
      $set: {
        stagedDeviceToken: null,
        'activePairingLock.state': 'revocation_committed',
        'activePairingLock.milestoneState': 'milestone_a_done',
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updated = await Device.findOneAndUpdate(query, updatePipeline, options);
  if (!updated) {
    throw new SecurityError(
      `MILESTONE_A_FAILED: Worker ${workerId} at epoch ${assignedEpoch} lost Device lease before Milestone A`,
      409
    );
  }

  return { success: true };
}

/**
 * Milestone B (Standalone MongoDB): Executes Milestone B with mandatory Device Anchor verification.
 * Pre-Check CAS -> Coordinator Finalize (fencedEpoch guarded & idempotent) -> Post-Check.
 */
export async function executeStandaloneMilestoneB({
  deviceId,
  sessionId,
  operationId,
  workerId,
  assignedEpoch,
  onAnchorPreCheckComplete = null,
}) {
  // 1. MANDATORY ANCHOR PRE-CHECK: Touch Device anchor and verify active lease ownership
  const anchorPreCheck = await Device.updateOne(
    {
      deviceId,
      'activePairingLock.operationId': operationId,
      'activePairingLock.recoveryWorkerId': workerId,
      'activePairingLock.recoveryEpoch': assignedEpoch,
      $expr: {
        $gt: ['$activePairingLock.recoveryLeaseExpiresAt', '$$NOW'],
      },
    },
    [
      {
        $set: {
          'activePairingLock.milestoneState': 'milestone_b_in_progress',
          'activePairingLock.lastAnchorVerificationAt': '$$NOW',
        },
      },
    ],
    { updatePipeline: true }
  );

  if (anchorPreCheck.matchedCount !== 1) {
    // FENCED OUT: Competing worker took over Device, or lease expired!
    throw new SecurityError(
      `MILESTONE_B_ANCHOR_FENCED_OUT: Worker ${workerId} at epoch ${assignedEpoch} rejected on Device anchor`,
      409
    );
  }

  if (typeof onAnchorPreCheckComplete === 'function') {
    await onAnchorPreCheckComplete();
  }

  // 2. COORDINATOR FINALIZATION: Execute Milestone B on PairingSession
  // Protected by fencedEpoch <= assignedEpoch so a stale worker paused after Step 1
  // CANNOT finalize PairingSession after a newer worker has fenced it and taken over Device.
  const sessionResult = await PairingSession.updateOne(
    {
      _id: sessionId,
      operationId,
      status: 'rolling_back',
      'recoveryLease.workerId': workerId,
      'recoveryLease.recoveryEpoch': assignedEpoch,
      $expr: {
        $and: [
          { $gt: ['$recoveryLease.expiresAt', '$$NOW'] },
          { $lte: [{ $ifNull: ['$recoveryLease.fencedEpoch', 0] }, assignedEpoch] },
        ],
      },
    },
    {
      $set: {
        status: 'failed_rolled_back',
        encryptedCredentialBundle: null,
        'recoveryLease.state': 'milestone_b_done',
      },
    }
  );

  let idempotentRepeat = false;
  if (sessionResult.matchedCount !== 1) {
    // Check for idempotent repeat by the same active lease holder
    const existing = await PairingSession.findOne({
      _id: sessionId,
      operationId,
      status: 'failed_rolled_back',
      'recoveryLease.workerId': workerId,
      'recoveryLease.recoveryEpoch': assignedEpoch,
      'recoveryLease.state': 'milestone_b_done',
    }).lean();

    if (existing && (existing.recoveryLease?.fencedEpoch ?? 0) <= assignedEpoch) {
      idempotentRepeat = true;
    } else {
      throw new SecurityError(
        `MILESTONE_B_SESSION_FENCED_OUT: Worker ${workerId} at epoch ${assignedEpoch} rejected on Session`,
        409
      );
    }
  }

  // 3. ANCHOR POST-VERIFICATION: Ensure Device was not overtaken during Step 2 write window
  const anchorPostCheck = await Device.findOne({
    deviceId,
    'activePairingLock.operationId': operationId,
    'activePairingLock.recoveryWorkerId': workerId,
    'activePairingLock.recoveryEpoch': assignedEpoch,
    $expr: { $gt: ['$activePairingLock.recoveryLeaseExpiresAt', '$$NOW'] },
  });

  if (!anchorPostCheck) {
    throw new SecurityError(
      `ANCHOR_LOST_DURING_MILESTONE_B: Lease expired while committing coordinator`,
      409
    );
  }

  return { success: true, ...(idempotentRepeat && { idempotentRepeat: true }) };
}

/**
 * Milestone B (Replica Set MongoDB): Executes Milestone B inside an ACID multi-document transaction.
 */
export async function executeReplicaSetMilestoneB({
  client,
  deviceId,
  sessionId,
  operationId,
  workerId,
  assignedEpoch,
}) {
  const session = client.startSession();
  let idempotentRepeat = false;
  try {
    await session.withTransaction(
      async () => {
        idempotentRepeat = false;
        // 1. ANCHOR VERIFICATION: Verify active Device ownership within transaction
        const deviceDoc = await Device.findOne(
          {
            deviceId,
            'activePairingLock.operationId': operationId,
            'activePairingLock.recoveryWorkerId': workerId,
            'activePairingLock.recoveryEpoch': assignedEpoch,
            $expr: { $gt: ['$activePairingLock.recoveryLeaseExpiresAt', '$$NOW'] },
          },
          null,
          { session }
        );

        if (!deviceDoc) {
          throw new SecurityError(
            `REPLICA_SET_ANCHOR_LOST: Worker ${workerId} at epoch ${assignedEpoch} lost Device anchor`,
            409
          );
        }

        // 2. FINALIZE COORDINATOR: Commit Milestone B on PairingSession within transaction
        const sessionResult = await PairingSession.updateOne(
          {
            _id: sessionId,
            operationId,
            status: 'rolling_back',
            'recoveryLease.workerId': workerId,
            'recoveryLease.recoveryEpoch': assignedEpoch,
            $expr: {
              $and: [
                { $gt: ['$recoveryLease.expiresAt', '$$NOW'] },
                { $lte: [{ $ifNull: ['$recoveryLease.fencedEpoch', 0] }, assignedEpoch] },
              ],
            },
          },
          {
            $set: {
              status: 'failed_rolled_back',
              encryptedCredentialBundle: null,
              'recoveryLease.state': 'completed',
            },
          },
          { session }
        );

        if (sessionResult.matchedCount !== 1) {
          const existing = await PairingSession.findOne(
            {
              _id: sessionId,
              operationId,
              status: 'failed_rolled_back',
              'recoveryLease.workerId': workerId,
              'recoveryLease.recoveryEpoch': assignedEpoch,
              'recoveryLease.state': 'completed',
            },
            null,
            { session }
          );

          if (existing && (existing.recoveryLease?.fencedEpoch ?? 0) <= assignedEpoch) {
            idempotentRepeat = true;
          } else {
            throw new SecurityError(
              `REPLICA_SET_SESSION_LOST: Worker ${workerId} at epoch ${assignedEpoch} lost PairingSession lease`,
              409
            );
          }
        }
      },
      {
        readConcern: { level: 'majority' },
        writeConcern: { w: 'majority', j: true },
      }
    );
    return { success: true, ...(idempotentRepeat && { idempotentRepeat: true }) };
  } finally {
    await session.endSession();
  }
}

/**
 * Milestone C: Releases Device lock back to idle.
 * CRITICAL INVARIANT: recoveryEpoch is strictly PRESERVED and NEVER reset to null!
 */
export async function executeStandaloneMilestoneC({
  deviceId,
  operationId,
  workerId,
  assignedEpoch,
}) {
  const result = await Device.updateOne(
    {
      deviceId,
      'activePairingLock.operationId': operationId,
      'activePairingLock.recoveryWorkerId': workerId,
      'activePairingLock.recoveryEpoch': assignedEpoch,
      $expr: {
        $gt: ['$activePairingLock.recoveryLeaseExpiresAt', '$$NOW'],
      },
    },
    [
      {
        $set: {
          'activePairingLock.state': 'idle',
          'activePairingLock.operationId': null,
          'activePairingLock.recoveryWorkerId': null,
          'activePairingLock.recoveryLeaseExpiresAt': null,
          'activePairingLock.milestoneState': 'idle',
          // CRITICAL: recoveryEpoch is PRESERVED! NEVER SET TO NULL!
          'activePairingLock.deliveryFence.clientRetrievalId': null,
          'activePairingLock.deliveryFence.expiresAt': null,
        },
      },
    ],
    { updatePipeline: true }
  );

  if (result.matchedCount !== 1) {
    throw new SecurityError(
      `MILESTONE_C_FENCED_OUT: Worker ${workerId} at epoch ${assignedEpoch} rejected during final release`,
      409
    );
  }

  return { success: true };
}
