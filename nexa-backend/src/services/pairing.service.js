import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Device from '../models/device.model.js';
import User from '../models/user.model.js';
import { SecurityError } from '../utils/security.errors.js';

const TEST_ONLY_RAT_SECRET = 'nexa_isolated_test_rat_secret_not_for_production_use_00000';
const DEV_ONLY_RAT_SECRET = 'nexa_isolated_dev_rat_secret_local_only_not_for_prod_00000';
const KNOWN_INSECURE_DEFAULTS = new Set([
  'nexa_dev_access_secret_super_secure_key_12345',
  'your_jwt_access_secret_min_32_chars',
  'changeme',
  'secret',
]);

function isTestEnvironment() {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'development') {
    return false;
  }
  return process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
}

/**
 * Validates and returns the RAT signing secret.
 * In production, requires a dedicated RAT_SECRET (>= 32 chars, distinct from JWT_ACCESS_SECRET,
 * and not an insecure default) — never falls back to JWT_ACCESS_SECRET.
 * Keeps development and test secrets isolated. Never logs secret values.
 */
export function validateRatSecretConfig() {
  const ratSecret = (process.env.RAT_SECRET || '').trim();

  if (process.env.NODE_ENV === 'production') {
    if (!ratSecret) {
      throw new SecurityError(
        'CONFIGURATION_ERROR: Missing required RAT_SECRET environment variable in production',
        500
      );
    }
    if (ratSecret.length < 32) {
      throw new SecurityError(
        'CONFIGURATION_ERROR: RAT_SECRET must be at least 32 characters',
        500
      );
    }
    if (KNOWN_INSECURE_DEFAULTS.has(ratSecret)) {
      throw new SecurityError(
        'CONFIGURATION_ERROR: Insecure default secret is prohibited in production',
        500
      );
    }
    const jwtAccess = (process.env.JWT_ACCESS_SECRET || '').trim();
    if (jwtAccess && ratSecret === jwtAccess) {
      throw new SecurityError(
        'CONFIGURATION_ERROR: RAT_SECRET must be distinct from JWT_ACCESS_SECRET in production',
        500
      );
    }
    return ratSecret;
  }

  if (ratSecret) {
    if (ratSecret.length < 32) {
      throw new SecurityError(
        'CONFIGURATION_ERROR: RAT_SECRET must be at least 32 characters',
        500
      );
    }
    return ratSecret;
  }

  if (isTestEnvironment()) {
    return TEST_ONLY_RAT_SECRET;
  }

  return DEV_ONLY_RAT_SECRET;
}

/**
 * Returns the secret key for signing Reset Authorization Tokens (RAT).
 */
export function getRatSecret() {
  return validateRatSecretConfig();
}

/**
 * Canonical Ed25519 PoP signature verification for RAT retry requests.
 * Canonical Payload: NEXA-RAT-POP-v1|ratId|deviceGeneration|action|nonce|timestamp
 */
export function verifyRetryPoPSignature({
  ratId,
  deviceGeneration,
  action,
  nonce,
  timestamp,
  signatureBase64,
  clientRecoveryPubKeyBuffer,
}) {
  if (action !== 'RECOVER_RETRY') {
    throw new SecurityError('INVALID_POP_ACTION: Expected RECOVER_RETRY', 400);
  }

  // Enforce 60-second skew window against server clock
  if (Math.abs(Date.now() - timestamp) > 60000) {
    throw new SecurityError('TIMESTAMP_OUT_OF_BOUNDS: Clock skew exceeds 60s limit', 401);
  }

  const canonicalPayload = Buffer.from(
    [
      'NEXA-RAT-POP-v1',
      ratId,
      deviceGeneration.toString(),
      action,
      nonce,
      timestamp.toString(),
    ].join('|'),
    'utf8'
  );

  let keyObject;
  try {
    keyObject = crypto.createPublicKey({
      key: clientRecoveryPubKeyBuffer,
      format: 'der',
      type: 'spki',
    });
  } catch (err) {
    throw new SecurityError(`INVALID_PUBLIC_KEY: ${err.message}`, 400);
  }

  let isVerified = false;
  try {
    isVerified = crypto.verify(
      null,
      canonicalPayload,
      keyObject,
      Buffer.from(signatureBase64, 'base64')
    );
  } catch (err) {
    throw new SecurityError('INVALID_RETRY_POP_SIGNATURE: Verification error', 401);
  }

  if (!isVerified) {
    throw new SecurityError('INVALID_RETRY_POP_SIGNATURE: Cryptographic verification failed', 401);
  }
}

/**
 * Executes the initial Master Recovery Code burn and persists the exact signed RAT token.
 */
export async function executeInitialRecoveryBurn({
  deviceId,
  deviceGeneration,
  mrcPlaintext,
  intendedNewUserId,
  clientRecoveryPubKeyDER,
  masterSecretKey = getRatSecret(),
}) {
  if (!intendedNewUserId || !mongoose.Types.ObjectId.isValid(String(intendedNewUserId))) {
    throw new SecurityError('INVALID_TARGET_USER_ID: intendedNewUserId must be a valid user ID', 400);
  }

  const targetUser = await User.findById(intendedNewUserId).lean();
  if (!targetUser) {
    throw new SecurityError('TARGET_USER_NOT_FOUND: Target recovery user does not exist', 404);
  }

  const currentDevice = await Device.findOne({ deviceId, deviceGeneration });
  if (!currentDevice || !currentDevice.hashedMasterRecoveryCode) {
    throw new SecurityError('DEVICE_NOT_FOUND_OR_ALREADY_BURNED', 404);
  }

  if (
    currentDevice.userId &&
    currentDevice.userId.toString() !== targetUser._id.toString()
  ) {
    throw new SecurityError(
      'RECOVERY_OWNERSHIP_MISMATCH: Device belongs to a different user',
      403
    );
  }

  // 1. Verify Master Recovery Code via constant-time comparison
  const calculatedHash = crypto.createHash('sha256').update(mrcPlaintext).digest('hex');
  const storedHashBuffer = Buffer.from(currentDevice.hashedMasterRecoveryCode, 'hex');
  const calculatedHashBuffer = Buffer.from(calculatedHash, 'hex');

  if (
    storedHashBuffer.length !== calculatedHashBuffer.length ||
    !crypto.timingSafeEqual(storedHashBuffer, calculatedHashBuffer)
  ) {
    throw new SecurityError('INVALID_MASTER_RECOVERY_CODE', 401);
  }

  const nextGeneration = deviceGeneration + 1;
  const ratId = crypto.randomUUID();
  const jti = crypto.randomUUID();

  // 2. Mint the EXACT Signed RAT Token
  const signedRat = jwt.sign(
    {
      sub: deviceId,
      gen: nextGeneration,
      intendedNewUserId,
      ratId,
      jti,
    },
    masterSecretKey,
    {
      algorithm: 'HS256',
      expiresIn: '15m',
    }
  );

  const persistedRatHash = crypto.createHash('sha256').update(signedRat).digest('hex');
  const pubKeyFingerprint = crypto.createHash('sha256').update(clientRecoveryPubKeyDER).digest('hex');

  // 3. Atomically Burn MRC, Advance Generation, and Persist the Exact Signed RAT
  const query = {
    deviceId,
    deviceGeneration,
    hashedMasterRecoveryCode: currentDevice.hashedMasterRecoveryCode,
    $or: [
      { pendingResetAuth: null },
      { 'pendingResetAuth.isConsumed': true },
      { 'pendingResetAuth.ratId': null },
    ],
  };

  const updatePipeline = [
    {
      $set: {
        deviceGeneration: nextGeneration,
        hashedMasterRecoveryCode: null, // BURNED PERMANENTLY
        stagedDeviceToken: null,
        hashedDeviceToken: null,
        pendingResetAuth: {
          ratId,
          deviceGeneration: nextGeneration,
          intendedNewUserId,
          clientRecoveryPubKey: clientRecoveryPubKeyDER,
          clientRecoveryPubKeyFingerprint: pubKeyFingerprint,
          persistedSignedRat: signedRat, // PERSISTED EXACT STRING
          persistedRatHash: persistedRatHash, // SHA-256 INTEGRITY HASH
          consumedNonces: [],
          lastRetryTimestamp: 0,
          lastRetryAt: null,
          retryCounter: 0,
          expiresAt: { $add: ['$$NOW', 15 * 60 * 1000] }, // 15-minute lease
          isConsumed: false,
        },
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updatedDevice = await Device.findOneAndUpdate(query, updatePipeline, options);
  if (!updatedDevice) {
    throw new SecurityError('BURN_CONFLICT: MRC burn collision or invalid device generation', 409);
  }

  return {
    status: 'RECOVERY_AUTHORIZED',
    ratToken: updatedDevice.pendingResetAuth.persistedSignedRat,
    ratId,
    deviceGeneration: nextGeneration,
    expiresAt: updatedDevice.pendingResetAuth.expiresAt,
  };
}

/**
 * Atomically consumes the single-use retry nonce and fetches the exact persisted RAT.
 */
export async function executeAtomicNonceConsumptionAndFetchRat({
  deviceId,
  deviceGeneration,
  ratId,
  nonce,
  timestamp,
}) {
  const query = {
    deviceId,
    deviceGeneration,
    'pendingResetAuth.ratId': ratId,
    'pendingResetAuth.isConsumed': false,
    // ATOMIC REPLAY SHIELD: Nonce must NOT be present in consumedNonces
    'pendingResetAuth.consumedNonces': { $ne: nonce },
    $expr: {
      $and: [
        // Authoritative server clock check:
        { $gt: ['$pendingResetAuth.expiresAt', '$$NOW'] },
        // Monotonic timestamp progression:
        { $gt: [timestamp, { $ifNull: ['$pendingResetAuth.lastRetryTimestamp', 0] }] },
      ],
    },
  };

  const updatePipeline = [
    {
      $set: {
        'pendingResetAuth.consumedNonces': {
          $concatArrays: [
            // Retain last 20 nonces to prevent unbounded document growth
            {
              $slice: [
                { $ifNull: ['$pendingResetAuth.consumedNonces', []] },
                -19,
              ],
            },
            [nonce],
          ],
        },
        'pendingResetAuth.lastRetryTimestamp': timestamp,
        'pendingResetAuth.lastRetryAt': '$$NOW',
        'pendingResetAuth.retryCounter': {
          $add: [{ $ifNull: ['$pendingResetAuth.retryCounter', 0] }, 1],
        },
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updatedDevice = await Device.findOneAndUpdate(query, updatePipeline, options);

  if (!updatedDevice) {
    throw new SecurityError(
      'RETRY_REJECTED: Nonce already consumed, expired PRA, or timestamp regression',
      409
    );
  }

  // STRICT INVARIANT: Return the EXACT stored token. ZERO new JWTs generated.
  return {
    ratToken: updatedDevice.pendingResetAuth.persistedSignedRat,
    retryCount: updatedDevice.pendingResetAuth.retryCounter,
    expiresAt: updatedDevice.pendingResetAuth.expiresAt,
  };
}

/**
 * Validates and decodes a signed RAT JWT.
 */
export function verifyRatToken(token, secret = getRatSecret()) {
  return jwt.verify(token, secret, { algorithms: ['HS256'] });
}

/**
 * Canonical Ed25519 PoP verification for delivery fence keepalive, ACK, and release operations.
 */
export function verifyDeliveryFencePoP({
  action,
  sessionId,
  deviceId,
  clientRetrievalId,
  fencingToken,
  deviceGeneration = null,
  timestamp,
  signatureBase64,
  clientSessionPubKeyDER,
}) {
  const allowedActions = ['KEEPALIVE', 'ACK', 'RELEASE'];
  if (!allowedActions.includes(action)) {
    throw new SecurityError(`INVALID_FENCE_ACTION: ${action}`, 400);
  }

  // 60-second skew window against server clock
  if (Math.abs(Date.now() - timestamp) > 60000) {
    throw new SecurityError('TIMESTAMP_OUT_OF_BOUNDS: Clock skew exceeds 60s limit', 401);
  }

  const parts = [
    'NEXA-FENCE-POP-v1',
    action,
    sessionId,
    deviceId,
    clientRetrievalId,
    fencingToken.toString(),
  ];

  if (action === 'ACK' || action === 'RELEASE') {
    if (deviceGeneration === null || deviceGeneration === undefined) {
      throw new SecurityError('MISSING_DEVICE_GENERATION_IN_POP', 400);
    }
    parts.push(deviceGeneration.toString());
  }

  parts.push(timestamp.toString());

  const canonicalPayload = Buffer.from(parts.join('|'), 'utf8');

  let keyObject;
  try {
    keyObject = crypto.createPublicKey({
      key: clientSessionPubKeyDER,
      format: 'der',
      type: 'spki',
    });
  } catch (err) {
    throw new SecurityError(`INVALID_PUBLIC_KEY: ${err.message}`, 400);
  }

  let isVerified = false;
  try {
    isVerified = crypto.verify(
      null,
      canonicalPayload,
      keyObject,
      Buffer.from(signatureBase64, 'base64')
    );
  } catch (err) {
    throw new SecurityError(`INVALID_DELIVERY_FENCE_POP_SIGNATURE: Action ${action} verification error`, 401);
  }

  if (!isVerified) {
    throw new SecurityError(`INVALID_DELIVERY_FENCE_POP_SIGNATURE: Action ${action} verification failed`, 401);
  }
}

/**
 * Acquires initial delivery fence on Device document.
 */
export async function acquireInitialDeliveryFence({
  deviceId,
  operationId,
  deviceGeneration,
  clientRetrievalId,
  clientSessionPubKeyDER,
}) {
  const query = {
    deviceId,
    deviceGeneration,
    $or: [
      { 'stagedDeviceToken.operationId': operationId },
      { 'activePairingLock.operationId': operationId },
      { 'activePairingLock.operationId': null },
    ],
    $expr: {
      $or: [
        { $eq: ['$activePairingLock.deliveryFence.clientRetrievalId', null] },
        { $lte: ['$activePairingLock.deliveryFence.expiresAt', '$$NOW'] },
      ],
    },
  };

  const updatePipeline = [
    {
      $set: {
        'activePairingLock.operationId': operationId,
        'activePairingLock.state': 'in_pairing',
        'activePairingLock.deliveryFence.clientRetrievalId': clientRetrievalId,
        'activePairingLock.deliveryFence.clientSessionPubKey': clientSessionPubKeyDER,
        'activePairingLock.deliveryFence.fencingToken': {
          $add: [{ $ifNull: ['$activePairingLock.deliveryFence.fencingToken', 0] }, 1],
        },
        'activePairingLock.deliveryFence.expiresAt': { $add: ['$$NOW', 45000] },
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updatedDevice = await Device.findOneAndUpdate(query, updatePipeline, options);
  if (!updatedDevice) {
    throw new SecurityError('FENCE_ACQUISITION_REJECTED: Active fence held or generation mismatch', 409);
  }

  return {
    success: true,
    fencingToken: updatedDevice.activePairingLock.deliveryFence.fencingToken,
    leaseExpiresAt: updatedDevice.activePairingLock.deliveryFence.expiresAt,
    serverTime: Date.now(),
  };
}

/**
 * Renews an active delivery fence via atomic CAS and advances fencingToken.
 */
export async function renewDeviceDeliveryFence({
  deviceId,
  operationId,
  deviceGeneration,
  clientRetrievalId,
  fencingToken,
}) {
  const query = {
    deviceId,
    deviceGeneration,
    'activePairingLock.operationId': operationId,
    'activePairingLock.deliveryFence.clientRetrievalId': clientRetrievalId,
    'activePairingLock.deliveryFence.fencingToken': fencingToken,
    $expr: {
      $gt: ['$activePairingLock.deliveryFence.expiresAt', '$$NOW'],
    },
  };

  const updatePipeline = [
    {
      $set: {
        'activePairingLock.deliveryFence.expiresAt': { $add: ['$$NOW', 45000] },
        'activePairingLock.deliveryFence.fencingToken': {
          $add: ['$activePairingLock.deliveryFence.fencingToken', 1],
        },
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updatedDevice = await Device.findOneAndUpdate(query, updatePipeline, options);
  if (!updatedDevice) {
    throw new SecurityError(
      'FENCE_RENEWAL_REJECTED: Stale fencing token, expired lease, or operation mismatch',
      409
    );
  }

  return {
    status: 'FENCE_RENEWED',
    fencingToken: updatedDevice.activePairingLock.deliveryFence.fencingToken,
    expiresAt: updatedDevice.activePairingLock.deliveryFence.expiresAt,
  };
}

/**
 * Signed ACK & Promotion CAS: promotes staged token and cleans up fence while advancing fencingToken.
 */
export async function ackAndPromoteDeviceDeliveryFence({
  deviceId,
  operationId,
  deviceGeneration,
  clientRetrievalId,
  fencingToken,
}) {
  // Idempotent repeat handling: strictly bound to exact operation, retrievalId, and fencingToken
  const existingActive = await Device.findOne({
    deviceId,
    deviceGeneration,
    hashedDeviceToken: { $ne: null },
    stagedDeviceToken: null,
    'lastConfirmedActivation.operationId': operationId,
    'lastConfirmedActivation.clientRetrievalId': clientRetrievalId,
    'lastConfirmedActivation.fencingToken': fencingToken,
  });

  if (existingActive) {
    return {
      status: 'ACTIVATION_CONFIRMED',
      confirmedGen: deviceGeneration,
      confirmedToken: existingActive.activePairingLock?.deliveryFence?.fencingToken || fencingToken,
      idempotentRepeat: true,
    };
  }

  const query = {
    deviceId,
    deviceGeneration,
    'stagedDeviceToken.operationId': operationId,
    'activePairingLock.operationId': operationId,
    'activePairingLock.deliveryFence.clientRetrievalId': clientRetrievalId,
    'activePairingLock.deliveryFence.fencingToken': fencingToken,
    $expr: {
      $gt: ['$activePairingLock.deliveryFence.expiresAt', '$$NOW'],
    },
  };

  const updatePipeline = [
    {
      $set: {
        hashedDeviceToken: '$stagedDeviceToken.hashedToken',
        stagedDeviceToken: null,
        lastConfirmedActivation: {
          operationId,
          clientRetrievalId,
          fencingToken,
          clientSessionPubKey: '$activePairingLock.deliveryFence.clientSessionPubKey',
        },
        'activePairingLock.state': 'idle',
        'activePairingLock.operationId': null,
        'activePairingLock.deliveryFence.clientRetrievalId': null,
        'activePairingLock.deliveryFence.expiresAt': null,
        // Monotonic fencingToken is incremented: NEVER reset to null
        'activePairingLock.deliveryFence.fencingToken': {
          $add: ['$activePairingLock.deliveryFence.fencingToken', 1],
        },
        lastConfirmedActivationAt: '$$NOW',
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updatedDevice = await Device.findOneAndUpdate(query, updatePipeline, options);
  if (!updatedDevice) {
    throw new SecurityError(
      'ACTIVATION_REJECTED: Lease expired, generation bump, or invalid fencing token',
      409
    );
  }

  return {
    status: 'ACTIVATION_CONFIRMED',
    confirmedGen: deviceGeneration,
    confirmedToken: updatedDevice.activePairingLock.deliveryFence.fencingToken,
  };
}

/**
 * Explicit delivery fence release. Preserves/increments fencingToken.
 */
export async function releaseDeviceDeliveryFence({
  deviceId,
  operationId,
  clientRetrievalId,
  fencingToken,
}) {
  const query = {
    deviceId,
    'activePairingLock.operationId': operationId,
    'activePairingLock.deliveryFence.clientRetrievalId': clientRetrievalId,
    'activePairingLock.deliveryFence.fencingToken': fencingToken,
  };

  const updatePipeline = [
    {
      $set: {
        'activePairingLock.deliveryFence.clientRetrievalId': null,
        'activePairingLock.deliveryFence.expiresAt': null,
        'activePairingLock.deliveryFence.fencingToken': {
          $add: ['$activePairingLock.deliveryFence.fencingToken', 1],
        },
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updatedDevice = await Device.findOneAndUpdate(query, updatePipeline, options);
  if (!updatedDevice) {
    throw new SecurityError(
      'RELEASE_REJECTED: Fencing token mismatch or fence not held',
      409
    );
  }

  return {
    status: 'FENCE_RELEASED',
    fencingToken: updatedDevice.activePairingLock.deliveryFence.fencingToken,
  };
}

/**
 * Server-side Fenced Admin Reset.
 * Enforces verified administrator role and 'device:admin_reset' permission.
 */
export async function executeFencedAdminReset({
  deviceId,
  expectedGeneration,
  newMasterHash,
  adminUser,
}) {
  if (!adminUser || !adminUser.id || adminUser.role !== 'admin') {
    throw new SecurityError('ADMIN_AUTHORIZATION_REQUIRED: Verified admin role required', 403);
  }

  const permissions = Array.isArray(adminUser.permissions) ? adminUser.permissions : [];
  if (!permissions.includes('device:admin_reset') && !permissions.includes('*')) {
    throw new SecurityError(
      'ADMIN_PERMISSION_REQUIRED: Missing device:admin_reset permission',
      403
    );
  }

  if (!deviceId || typeof deviceId !== 'string' || !deviceId.trim()) {
    throw new SecurityError('INVALID_DEVICE_ID: deviceId is required', 400);
  }
  const query = {
    deviceId,
    deviceGeneration: expectedGeneration,
    $expr: {
      $or: [
        { $eq: ['$activePairingLock.deliveryFence.clientRetrievalId', null] },
        { $lte: ['$activePairingLock.deliveryFence.expiresAt', '$$NOW'] },
      ],
    },
  };

  const updatePipeline = [
    {
      $set: {
        deviceGeneration: { $add: ['$deviceGeneration', 1] },
        stagedDeviceToken: null,
        hashedDeviceToken: null,
        lastConfirmedActivation: null,
        hashedMasterRecoveryCode: newMasterHash,
        'activePairingLock.state': 'idle',
        'activePairingLock.operationId': null,
        'activePairingLock.deliveryFence.clientRetrievalId': null,
        'activePairingLock.deliveryFence.expiresAt': null,
        // Increments monotonic token: NEVER reset to null
        'activePairingLock.deliveryFence.fencingToken': {
          $add: [{ $ifNull: ['$activePairingLock.deliveryFence.fencingToken', 0] }, 1],
        },
      },
    },
  ];

  const options = {
    returnDocument: 'after',
    updatePipeline: true,
  };

  const updatedDevice = await Device.findOneAndUpdate(query, updatePipeline, options);
  if (!updatedDevice) {
    throw new SecurityError(
      'RESET_CONFLICT: Active delivery fence held or device generation mismatch',
      409
    );
  }

  return {
    status: 'ADMIN_RESET_COMPLETE',
    newGeneration: updatedDevice.deviceGeneration,
    fencingToken: updatedDevice.activePairingLock.deliveryFence.fencingToken,
  };
}
