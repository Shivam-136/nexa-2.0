import Device from '../models/device.model.js';
import {
  executeInitialRecoveryBurn,
  executeAtomicNonceConsumptionAndFetchRat,
  verifyRetryPoPSignature,
  verifyDeliveryFencePoP,
  renewDeviceDeliveryFence,
  ackAndPromoteDeviceDeliveryFence,
  releaseDeviceDeliveryFence,
  executeFencedAdminReset,
} from '../services/pairing.service.js';
import { SecurityError } from '../utils/security.errors.js';

/**
 * Handles initial Master Recovery Code burn and staging of Pending Reset Authorization.
 * POST /api/v1/pairing/recover-mrc
 */
export async function handleRecoverMrc(req, res, next) {
  try {
    const {
      deviceId,
      deviceGeneration = 1,
      mrcPlaintext,
      intendedNewUserId,
      clientRecoveryPubKey,
    } = req.body;

    const pubKeyBuffer = Buffer.isBuffer(clientRecoveryPubKey)
      ? clientRecoveryPubKey
      : Buffer.from(clientRecoveryPubKey, 'base64');

    const result = await executeInitialRecoveryBurn({
      deviceId,
      deviceGeneration: Number(deviceGeneration),
      mrcPlaintext,
      intendedNewUserId,
      clientRecoveryPubKeyDER: pubKeyBuffer,
    });

    return res.status(200).json({
      success: true,
      status: 'RECOVERY_AUTHORIZED',
      ratToken: result.ratToken,
      ratId: result.ratId,
      deviceGeneration: result.deviceGeneration,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    if (err instanceof SecurityError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
      });
    }
    next(err);
  }
}

/**
 * Handles idempotent recovery retries with atomic nonce consumption and PoP verification.
 * POST /api/v1/pairing/recover-retry
 */
export async function handleRecoverRetry(req, res, next) {
  try {
    const {
      deviceId,
      deviceGeneration,
      ratId,
      action,
      nonce,
      timestamp,
      signature,
    } = req.body;

    // 1. Locate Device and Staged PRA
    const device = await Device.findOne({
      deviceId,
      deviceGeneration: Number(deviceGeneration),
    });

    if (!device || !device.pendingResetAuth || device.pendingResetAuth.ratId !== ratId) {
      return res.status(404).json({
        success: false,
        error: 'NO_ACTIVE_RECOVERY_SESSION_FOUND',
      });
    }

    const pra = device.pendingResetAuth;

    if (pra.isConsumed) {
      return res.status(403).json({
        success: false,
        error: 'RESET_AUTHORIZATION_ALREADY_CONSUMED',
      });
    }

    // 2. Cryptographic Ed25519 PoP Verification
    verifyRetryPoPSignature({
      ratId,
      deviceGeneration: Number(deviceGeneration),
      action,
      nonce,
      timestamp: Number(timestamp),
      signatureBase64: signature,
      clientRecoveryPubKeyBuffer: pra.clientRecoveryPubKey,
    });

    // 3. Atomic Nonce Consumption CAS & Durable Token Retrieval
    const result = await executeAtomicNonceConsumptionAndFetchRat({
      deviceId,
      deviceGeneration: Number(deviceGeneration),
      ratId,
      nonce,
      timestamp: Number(timestamp),
    });

    return res.status(200).json({
      success: true,
      status: 'RECOVERY_AUTHORIZED',
      ratToken: result.ratToken, // Exact persisted string (ZERO new JWTs)
      idempotentlyRecovered: true,
      retryCount: result.retryCount,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    if (err instanceof SecurityError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
      });
    }
    next(err);
  }
}

/**
 * Handles signed keepalive requests for active delivery fences.
 * POST /api/v1/pairing/delivery-keepalive
 */
export async function handleDeliveryKeepalive(req, res, next) {
  try {
    const {
      action,
      sessionId,
      deviceId,
      operationId,
      deviceGeneration,
      clientRetrievalId,
      fencingToken,
      timestamp,
      signature,
    } = req.body;

    if (action !== 'KEEPALIVE') {
      return res.status(400).json({
        success: false,
        error: `INVALID_FENCE_ACTION: Expected KEEPALIVE, received ${action}`,
      });
    }

    const device = await Device.findOne({
      deviceId,
      deviceGeneration: Number(deviceGeneration),
    });

    if (
      !device ||
      !device.activePairingLock?.deliveryFence?.clientSessionPubKey ||
      device.activePairingLock.deliveryFence.clientRetrievalId !== clientRetrievalId
    ) {
      return res.status(404).json({
        success: false,
        error: 'NO_ACTIVE_DELIVERY_FENCE_FOUND',
      });
    }

    // Cryptographic PoP Verification
    verifyDeliveryFencePoP({
      action,
      sessionId,
      deviceId,
      clientRetrievalId,
      fencingToken: Number(fencingToken),
      timestamp: Number(timestamp),
      signatureBase64: signature,
      clientSessionPubKeyDER: device.activePairingLock.deliveryFence.clientSessionPubKey,
    });

    // CAS Fence Renewal
    const result = await renewDeviceDeliveryFence({
      deviceId,
      operationId,
      deviceGeneration: Number(deviceGeneration),
      clientRetrievalId,
      fencingToken: Number(fencingToken),
    });

    return res.status(200).json({
      success: true,
      status: result.status,
      fencingToken: result.fencingToken,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    if (err instanceof SecurityError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
      });
    }
    next(err);
  }
}

/**
 * Handles signed ACK and promotion of staged credentials.
 * POST /api/v1/pairing/confirm-activation
 */
export async function handleConfirmActivation(req, res, next) {
  try {
    const {
      action,
      sessionId,
      deviceId,
      operationId,
      deviceGeneration,
      clientRetrievalId,
      fencingToken,
      timestamp,
      signature,
    } = req.body;

    // 1. Explicitly require action === 'ACK' before any DB/PoP work
    if (action !== 'ACK') {
      return res.status(400).json({
        success: false,
        error: `INVALID_FENCE_ACTION: Expected ACK for activation confirmation, received ${action}`,
      });
    }

    const device = await Device.findOne({
      deviceId,
      deviceGeneration: Number(deviceGeneration),
    });

    if (!device) {
      return res.status(404).json({
        success: false,
        error: 'DEVICE_NOT_FOUND',
      });
    }

    // 2. Bound idempotent repeat: only if device was previously confirmed for this exact operation,
    // retrievalId, fencingToken, AND passes Ed25519 PoP verification.
    if (
      device.hashedDeviceToken !== null &&
      device.stagedDeviceToken === null &&
      device.activePairingLock?.state === 'idle'
    ) {
      const confirmed = device.lastConfirmedActivation;
      if (
        !confirmed ||
        confirmed.operationId !== operationId ||
        confirmed.clientRetrievalId !== clientRetrievalId ||
        confirmed.fencingToken !== Number(fencingToken) ||
        !confirmed.clientSessionPubKey
      ) {
        return res.status(409).json({
          success: false,
          error: 'ACTIVATION_IDEMPOTENCY_CONFLICT: Stale or unrelated operation cannot confirm activation',
        });
      }

      verifyDeliveryFencePoP({
        action: 'ACK',
        sessionId,
        deviceId,
        clientRetrievalId,
        fencingToken: Number(fencingToken),
        deviceGeneration: Number(deviceGeneration),
        timestamp: Number(timestamp),
        signatureBase64: signature,
        clientSessionPubKeyDER: confirmed.clientSessionPubKey,
      });

      return res.status(200).json({
        success: true,
        status: 'ACTIVATION_CONFIRMED',
        confirmedGen: Number(deviceGeneration),
        confirmedToken: device.activePairingLock?.deliveryFence?.fencingToken || Number(fencingToken),
        idempotentRepeat: true,
      });
    }

    const fence = device.activePairingLock?.deliveryFence;
    if (!fence || !fence.clientSessionPubKey || fence.clientRetrievalId !== clientRetrievalId) {
      return res.status(404).json({
        success: false,
        error: 'NO_MATCHING_DELIVERY_FENCE',
      });
    }

    // Cryptographic PoP Verification
    verifyDeliveryFencePoP({
      action,
      sessionId,
      deviceId,
      clientRetrievalId,
      fencingToken: Number(fencingToken),
      deviceGeneration: Number(deviceGeneration),
      timestamp: Number(timestamp),
      signatureBase64: signature,
      clientSessionPubKeyDER: fence.clientSessionPubKey,
    });

    // CAS Promotion
    const result = await ackAndPromoteDeviceDeliveryFence({
      deviceId,
      operationId,
      deviceGeneration: Number(deviceGeneration),
      clientRetrievalId,
      fencingToken: Number(fencingToken),
    });

    return res.status(200).json({
      success: true,
      status: result.status,
      confirmedGen: result.confirmedGen,
      confirmedToken: result.confirmedToken,
      ...(result.idempotentRepeat && { idempotentRepeat: true }),
    });
  } catch (err) {
    if (err instanceof SecurityError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
      });
    }
    next(err);
  }
}

/**
 * Handles explicit signed fence release.
 * POST /api/v1/pairing/release-fence
 */
export async function handleReleaseFence(req, res, next) {
  try {
    const {
      action,
      sessionId,
      deviceId,
      operationId,
      deviceGeneration,
      clientRetrievalId,
      fencingToken,
      timestamp,
      signature,
    } = req.body;

    if (action !== 'RELEASE') {
      return res.status(400).json({
        success: false,
        error: `INVALID_FENCE_ACTION: Expected RELEASE, received ${action}`,
      });
    }

    const device = await Device.findOne({
      deviceId,
      deviceGeneration: Number(deviceGeneration),
    });

    if (
      !device ||
      !device.activePairingLock?.deliveryFence?.clientSessionPubKey ||
      device.activePairingLock.deliveryFence.clientRetrievalId !== clientRetrievalId
    ) {
      return res.status(404).json({
        success: false,
        error: 'NO_ACTIVE_DELIVERY_FENCE_FOUND',
      });
    }

    // Cryptographic PoP Verification
    verifyDeliveryFencePoP({
      action,
      sessionId,
      deviceId,
      clientRetrievalId,
      fencingToken: Number(fencingToken),
      deviceGeneration: Number(deviceGeneration),
      timestamp: Number(timestamp),
      signatureBase64: signature,
      clientSessionPubKeyDER: device.activePairingLock.deliveryFence.clientSessionPubKey,
    });

    const result = await releaseDeviceDeliveryFence({
      deviceId,
      operationId,
      clientRetrievalId,
      fencingToken: Number(fencingToken),
    });

    return res.status(200).json({
      success: true,
      status: result.status,
      fencingToken: result.fencingToken,
    });
  } catch (err) {
    if (err instanceof SecurityError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
      });
    }
    next(err);
  }
}

/**
 * Handles administrative reset.
 * POST /api/v1/pairing/admin-reset/:deviceId
 */
export async function handleAdminReset(req, res, next) {
  try {
    const paramDeviceId = req.params.deviceId;
    if (!paramDeviceId || !paramDeviceId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'DEVICE_ID_PARAM_REQUIRED: deviceId must be specified in the URL path',
      });
    }

    const { deviceId: bodyDeviceId, expectedGeneration, newMasterHash } = req.body;
    if (bodyDeviceId && bodyDeviceId !== paramDeviceId) {
      return res.status(400).json({
        success: false,
        error: 'DEVICE_ID_MISMATCH: Body deviceId does not match URL parameter',
      });
    }

    const result = await executeFencedAdminReset({
      deviceId: paramDeviceId.trim(),
      expectedGeneration: Number(expectedGeneration),
      newMasterHash,
      adminUser: req.user,
    });

    return res.status(200).json({
      success: true,
      status: result.status,
      newGeneration: result.newGeneration,
      fencingToken: result.fencingToken,
    });
  } catch (err) {
    if (err instanceof SecurityError) {
      return res.status(err.statusCode).json({
        success: false,
        error: err.message,
      });
    }
    next(err);
  }
}
