import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
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

// ============================================================
// M3.4.1 — Device Pairing Initiation, Status, Cancel, & Claim
// ============================================================

const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PAIRING_CODE_LENGTH = 8;
const PAIRING_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Generates a cryptographically random 8-character pairing code formatted as XXXX-XXXX.
 * Uses a 32-char unambiguous alphabet so randomBytes(8) % 32 has zero modulo bias.
 */
function generateSecurePairingCode() {
  const bytes = crypto.randomBytes(PAIRING_CODE_LENGTH);
  let raw = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    raw += PAIRING_CODE_ALPHABET[bytes[i] % PAIRING_CODE_ALPHABET.length];
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
}

/**
 * Normalizes a user/agent-entered pairing code into XXXX-XXXX format.
 */
export function normalizePairingCode(input) {
  if (typeof input !== 'string') {
    throw new SecurityError('INVALID_PAIRING_CODE: Pairing code must be a string', 400);
  }
  const cleaned = input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (cleaned.length !== PAIRING_CODE_LENGTH) {
    throw new SecurityError('INVALID_PAIRING_CODE: Pairing code must be 8 characters', 400);
  }
  for (const ch of cleaned) {
    if (!PAIRING_CODE_ALPHABET.includes(ch)) {
      throw new SecurityError('INVALID_PAIRING_CODE: Pairing code contains invalid characters', 400);
    }
  }
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
}

/**
 * Hashes a normalized pairing code with SHA-256 (uppercase hex to match schema).
 * Ensures plaintext pairing codes are never persisted or queried in MongoDB.
 */
export function hashPairingCode(normalizedCode) {
  return crypto.createHash('sha256').update(normalizedCode).digest('hex').toUpperCase();
}

/**
 * Initiates a new short-lived pairing session for an authenticated user.
 * Cancels any prior pending unclaimed sessions for the same user.
 */
export async function initiatePairingSession({ userId }) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    throw new SecurityError('INVALID_USER_ID: Valid authenticated user required', 401);
  }

  await PairingSession.updateMany(
    { userId, status: 'pending', isClaimed: false },
    { $set: { status: 'cancelled' } }
  );

  const pairingCode = generateSecurePairingCode();
  const hashedPairingCode = hashPairingCode(pairingCode);
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MS);
  const operationId = crypto.randomUUID();

  const session = await PairingSession.create({
    userId,
    pairingCode: hashedPairingCode,
    expiresAt,
    isClaimed: false,
    status: 'pending',
    operationId,
  });

  return {
    sessionId: session._id.toString(),
    pairingCode,
    expiresAt: session.expiresAt.toISOString(),
    ttlSeconds: Math.floor(PAIRING_TTL_MS / 1000),
    status: session.status,
  };
}

/**
 * Returns the authenticated user's pairing session status and connected devices.
 */
export async function getPairingStatus({ userId, sessionId = null }) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    throw new SecurityError('INVALID_USER_ID: Valid authenticated user required', 401);
  }

  const devices = await Device.find({
    userId,
    isRevoked: false,
    hashedDeviceToken: { $ne: null },
  })
    .select('deviceId deviceName deviceGeneration isOnline isQuarantined lastSeenAt lastHeartbeatAt heartbeatCount lastConfirmedActivationAt createdAt updatedAt')
    .sort({ updatedAt: -1 })
    .lean();

  let session = null;
  if (sessionId) {
    if (!mongoose.Types.ObjectId.isValid(String(sessionId))) {
      throw new SecurityError('INVALID_SESSION_ID: Malformed pairing session ID', 400);
    }
    session = await PairingSession.findOne({ _id: sessionId, userId }).lean();
  } else {
    session = await PairingSession.findOne({ userId, status: 'pending', isClaimed: false })
      .sort({ createdAt: -1 })
      .lean();
  }

  let activeSession = null;
  if (session) {
    const isExpired = session.status === 'pending' && new Date(session.expiresAt) <= new Date();
    activeSession = {
      sessionId: session._id.toString(),
      pairingCode: null, // Never expose stored code hash or re-expose plaintext on poll
      status: isExpired ? 'expired' : session.status,
      isClaimed: Boolean(session.isClaimed),
      claimedDeviceId: session.claimedDeviceId || null,
      claimedAt: session.claimedAt ? new Date(session.claimedAt).toISOString() : null,
      expiresAt: new Date(session.expiresAt).toISOString(),
    };
  }

  const HEARTBEAT_STALE_MS = Number(process.env.DEVICE_HEARTBEAT_STALE_MS) || 90000;
  const nowMs = Date.now();

  return {
    activeSession,
    connectedDevices: devices.map((d) => {
      const lastSeenMs = d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : 0;
      const isFresh = Boolean(d.isOnline && lastSeenMs > 0 && nowMs - lastSeenMs <= HEARTBEAT_STALE_MS);
      const effectiveOnline = Boolean(isFresh && !d.isQuarantined);
      const connectionState = d.isQuarantined
        ? 'QUARANTINED'
        : effectiveOnline
        ? 'ONLINE'
        : 'OFFLINE';

      return {
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        deviceGeneration: d.deviceGeneration,
        isOnline: effectiveOnline,
        isQuarantined: Boolean(d.isQuarantined),
        connectionState,
        pairedAt: (d.lastConfirmedActivationAt || d.updatedAt || d.createdAt)
          ? new Date(d.lastConfirmedActivationAt || d.updatedAt || d.createdAt).toISOString()
          : null,
        lastSeenAt: d.lastSeenAt ? new Date(d.lastSeenAt).toISOString() : null,
        lastHeartbeatAt: d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).toISOString() : null,
        heartbeatCount: d.heartbeatCount || 0,
      };
    }),
  };
}

/**
 * Cancels an active pending pairing session for the authenticated user.
 */
export async function cancelPairingSession({ userId, sessionId = null }) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    throw new SecurityError('INVALID_USER_ID: Valid authenticated user required', 401);
  }

  const filter = { userId, status: 'pending', isClaimed: false };
  if (sessionId) {
    if (!mongoose.Types.ObjectId.isValid(String(sessionId))) {
      throw new SecurityError('INVALID_SESSION_ID: Malformed pairing session ID', 400);
    }
    filter._id = sessionId;
  }

  const updated = await PairingSession.findOneAndUpdate(
    filter,
    { $set: { status: 'cancelled' } },
    { returnDocument: 'after' }
  );

  return {
    cancelled: Boolean(updated),
    sessionId: updated ? updated._id.toString() : sessionId || null,
    status: updated ? updated.status : 'none',
  };
}

/**
 * Atomically claims a pending pairing code for a Desktop Agent device.
 * Enforces single-use atomic CAS (replay protection), expiration check,
 * and issues a fresh device token whose SHA-256 hash is stored on Device.
 */
export async function claimPairingSession({ pairingCode, deviceId, deviceName }) {
  const formattedCode = normalizePairingCode(pairingCode);
  const hashedCode = hashPairingCode(formattedCode);
  const now = new Date();

  const claimedSession = await PairingSession.findOneAndUpdate(
    {
      pairingCode: hashedCode,
      isClaimed: false,
      status: 'pending',
      expiresAt: { $gt: now },
    },
    {
      $set: {
        isClaimed: true,
        claimedAt: now,
        claimedDeviceId: deviceId,
        status: 'completed',
      },
    },
    { returnDocument: 'after' }
  );

  if (!claimedSession) {
    const existing = await PairingSession.findOne({ pairingCode: hashedCode }).lean();
    if (!existing) {
      throw new SecurityError('INVALID_PAIRING_CODE: Pairing code not found', 404);
    }
    if (existing.isClaimed || existing.status === 'completed') {
      throw new SecurityError('PAIRING_CODE_ALREADY_CLAIMED: Pairing code has already been used', 409);
    }
    if (existing.status === 'cancelled') {
      throw new SecurityError('PAIRING_SESSION_CANCELLED: Pairing session was cancelled', 410);
    }
    if (new Date(existing.expiresAt) <= now) {
      throw new SecurityError('PAIRING_CODE_EXPIRED: Pairing code has expired', 410);
    }
    throw new SecurityError('PAIRING_CLAIM_REJECTED: Unable to claim pairing session', 409);
  }

  const existingDevice = await Device.findOne({ deviceId }).lean();
  if (
    existingDevice &&
    existingDevice.userId &&
    existingDevice.userId.toString() !== claimedSession.userId.toString()
  ) {
    throw new SecurityError(
      'DEVICE_IDENTITY_CONFLICT: Device ID is already bound to another account',
      403
    );
  }

  const deviceToken = crypto.randomBytes(32).toString('hex');
  const hashedDeviceToken = crypto.createHash('sha256').update(deviceToken).digest('hex');

  let device;

  if (existingDevice) {
    if (existingDevice.activePairingLock?.state === 'in_pairing') {
      throw new SecurityError('DEVICE_PAIRING_LOCKED: Device has an active pairing lock', 409);
    }
    device = await Device.findOneAndUpdate(
      { deviceId, 'activePairingLock.state': { $ne: 'in_pairing' } },
      {
        $set: {
          userId: claimedSession.userId,
          deviceName,
          hashedDeviceToken,
          stagedDeviceToken: null,
          isRevoked: false,
          isOnline: false,
          lastSeenAt: now,
          lastConfirmedActivationAt: now,
        },
        $inc: { deviceGeneration: 1 },
      },
      { returnDocument: 'after' }
    );
    if (!device) {
      throw new SecurityError('DEVICE_UPDATE_CONFLICT: Unable to bind device', 409);
    }
  } else {
    device = await Device.create({
      userId: claimedSession.userId,
      deviceId,
      deviceName,
      deviceGeneration: 1,
      hashedDeviceToken,
      isRevoked: false,
      isOnline: false,
      lastSeenAt: now,
      lastConfirmedActivationAt: now,
    });
  }

  return {
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    deviceToken,
    userId: claimedSession.userId.toString(),
    deviceGeneration: device.deviceGeneration,
    pairedAt: now.toISOString(),
  };
}
