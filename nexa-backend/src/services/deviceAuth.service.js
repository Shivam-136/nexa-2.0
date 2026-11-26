import mongoose from 'mongoose';
import Device from '../models/device.model.js';
import User from '../models/user.model.js';
import { SecurityError } from '../utils/security.errors.js';
import {
  DEVICE_ACCESS_TTL_SECONDS,
  DEVICE_REFRESH_TTL_MS,
  hashToken,
  signDeviceAccessToken,
  signDeviceRefreshToken,
  verifyDeviceRefreshToken,
  verifyHashedDeviceToken,
} from '../utils/deviceAuth.utils.js';

/**
 * Verifies that a Device document is active, unrevoked, unquarantined, paired,
 * non-expired, and bound to the expected generation and owner userId.
 */
export function assertDeviceActiveAndBound(device, { expectedUserId = null, expectedGeneration = null } = {}) {
  if (!device) {
    throw new SecurityError('DEVICE_NOT_FOUND: Device is not registered', 401);
  }

  if (device.isRevoked) {
    throw new SecurityError('DEVICE_REVOKED: Device access has been revoked', 403);
  }

  if (device.isQuarantined) {
    throw new SecurityError('DEVICE_QUARANTINED: Device is currently quarantined', 403);
  }

  const lockState = device.activePairingLock?.state;
  if (lockState === 'in_pairing' || lockState === 'revocation_committed') {
    throw new SecurityError('DEVICE_QUARANTINED: Device has an active pairing or revocation lock', 403);
  }

  if (
    device.pendingResetAuth &&
    device.pendingResetAuth.ratId &&
    !device.pendingResetAuth.isConsumed
  ) {
    throw new SecurityError('DEVICE_QUARANTINED: Device has an unconsumed recovery authorization', 403);
  }

  if (device.stagedDeviceToken !== null && device.stagedDeviceToken !== undefined) {
    throw new SecurityError('DEVICE_QUARANTINED: Device has an unpromoted staged credential', 403);
  }

  if (!device.hashedDeviceToken) {
    throw new SecurityError('DEVICE_NOT_PAIRED: Device does not have an active credential', 401);
  }

  if (device.deviceTokenExpiresAt && new Date(device.deviceTokenExpiresAt) <= new Date()) {
    throw new SecurityError('DEVICE_CREDENTIAL_EXPIRED: Device credential has expired', 401);
  }

  if (!device.userId) {
    throw new SecurityError('DEVICE_UNOWNED: Device is not bound to an owner account', 403);
  }

  if (
    expectedGeneration !== null &&
    expectedGeneration !== undefined &&
    Number(device.deviceGeneration) !== Number(expectedGeneration)
  ) {
    throw new SecurityError(
      'DEVICE_GENERATION_MISMATCH: Credential generation does not match active device generation',
      401
    );
  }

  if (
    expectedUserId !== null &&
    expectedUserId !== undefined &&
    device.userId.toString() !== String(expectedUserId)
  ) {
    throw new SecurityError(
      'DEVICE_OWNERSHIP_MISMATCH: Device ownership does not match credential',
      403
    );
  }
}

/**
 * Authenticates a paired device using its DPAPI-stored deviceToken, deviceId, and deviceGeneration.
 * Issues a short-lived device access JWT and a rotating device refresh JWT.
 */
export async function authenticateDevice({ deviceId, deviceGeneration, deviceToken }) {
  const device = await Device.findOne({ deviceId });
  assertDeviceActiveAndBound(device, { expectedGeneration: deviceGeneration });

  const owner = await User.findById(device.userId).lean();
  if (!owner) {
    throw new SecurityError('DEVICE_OWNER_NOT_FOUND: Associated user account no longer exists', 401);
  }

  if (!verifyHashedDeviceToken(deviceToken, device.hashedDeviceToken)) {
    throw new SecurityError('INVALID_DEVICE_CREDENTIALS: Device authentication failed', 401);
  }

  const userId = device.userId.toString();
  const activeGeneration = Number(device.deviceGeneration);
  const accessToken = signDeviceAccessToken({
    deviceId: device.deviceId,
    userId,
    deviceGeneration: activeGeneration,
  });
  const refreshToken = signDeviceRefreshToken({
    deviceId: device.deviceId,
    userId,
    deviceGeneration: activeGeneration,
  });

  const now = new Date();
  const pruneCutoff = new Date(now.getTime() - 60000);
  const refreshHash = hashToken(refreshToken);
  const refreshExpiresAt = new Date(now.getTime() + DEVICE_REFRESH_TTL_MS);

  const retainedTokens = (device.deviceRefreshTokens || [])
    .filter((t) => t.expiresAt > now && (!t.rotatedAt || t.rotatedAt > pruneCutoff))
    .slice(-9);

  retainedTokens.push({
    tokenHash: refreshHash,
    deviceGeneration: activeGeneration,
    expiresAt: refreshExpiresAt,
    createdAt: now,
    rotatedAt: null,
    replacedByTokenHash: null,
  });

  await Device.updateOne(
    { _id: device._id, deviceGeneration: activeGeneration },
    {
      $set: {
        deviceRefreshTokens: retainedTokens,
        lastAuthenticatedAt: now,
        lastSeenAt: now,
      },
    }
  );

  return {
    tokenType: 'Bearer',
    accessToken,
    refreshToken,
    expiresIn: DEVICE_ACCESS_TTL_SECONDS,
    expiresAt: new Date(now.getTime() + DEVICE_ACCESS_TTL_SECONDS * 1000).toISOString(),
    deviceId: device.deviceId,
    deviceName: device.deviceName,
    deviceGeneration: activeGeneration,
    userId,
  };
}

/**
 * Atomically rotates a device refresh token and issues a fresh access/refresh token pair.
 * Detects refresh token replay/reuse and immediately invalidates the device's refresh token family.
 */
export async function rotateDeviceRefreshToken({
  refreshToken,
  deviceId = null,
  deviceGeneration = null,
}) {
  if (!refreshToken || typeof refreshToken !== 'string') {
    throw new SecurityError('REFRESH_TOKEN_REQUIRED: Device refresh token is required', 401);
  }

  let payload;
  try {
    payload = verifyDeviceRefreshToken(refreshToken);
  } catch (err) {
    if (err instanceof SecurityError) {
      throw err;
    }
    if (err.name === 'TokenExpiredError') {
      throw new SecurityError('DEVICE_REFRESH_TOKEN_EXPIRED: Device refresh token has expired', 401);
    }
    throw new SecurityError('INVALID_DEVICE_REFRESH_TOKEN: Malformed or invalid refresh token', 401);
  }

  if (!payload?.deviceId || !payload?.userId || !Number.isInteger(payload?.deviceGeneration)) {
    throw new SecurityError('INVALID_DEVICE_REFRESH_TOKEN: Missing required token claims', 401);
  }

  if (deviceId && deviceId !== payload.deviceId) {
    throw new SecurityError('CROSS_DEVICE_TOKEN_MISUSE: Refresh token does not match deviceId', 403);
  }

  if (
    deviceGeneration !== null &&
    deviceGeneration !== undefined &&
    Number(deviceGeneration) !== Number(payload.deviceGeneration)
  ) {
    throw new SecurityError(
      'DEVICE_GENERATION_MISMATCH: Refresh token generation does not match requested generation',
      401
    );
  }

  const device = await Device.findOne({ deviceId: payload.deviceId });
  assertDeviceActiveAndBound(device, {
    expectedUserId: payload.userId,
    expectedGeneration: payload.deviceGeneration,
  });

  const owner = await User.findById(device.userId).lean();
  if (!owner) {
    throw new SecurityError('DEVICE_OWNER_NOT_FOUND: Associated user account no longer exists', 401);
  }

  const now = new Date();
  const incomingHash = hashToken(refreshToken);
  const activeGeneration = Number(device.deviceGeneration);
  const userId = device.userId.toString();

  const newAccessToken = signDeviceAccessToken({
    deviceId: device.deviceId,
    userId,
    deviceGeneration: activeGeneration,
  });
  const newRefreshToken = signDeviceRefreshToken({
    deviceId: device.deviceId,
    userId,
    deviceGeneration: activeGeneration,
  });
  const newHash = hashToken(newRefreshToken);
  const newExpiresAt = new Date(now.getTime() + DEVICE_REFRESH_TTL_MS);

  const query = {
    deviceId: device.deviceId,
    deviceGeneration: activeGeneration,
    isRevoked: false,
    isQuarantined: false,
    deviceRefreshTokens: {
      $elemMatch: {
        tokenHash: incomingHash,
        deviceGeneration: activeGeneration,
        rotatedAt: null,
        expiresAt: { $gt: now },
      },
    },
  };

  const updatePipeline = [
    {
      $set: {
        lastAuthenticatedAt: '$$NOW',
        lastSeenAt: '$$NOW',
        deviceRefreshTokens: {
          $concatArrays: [
            {
              $slice: [
                {
                  $filter: {
                    input: {
                      $map: {
                        input: { $ifNull: ['$deviceRefreshTokens', []] },
                        as: 't',
                        in: {
                          $cond: [
                            { $eq: ['$$t.tokenHash', incomingHash] },
                            {
                              $mergeObjects: [
                                '$$t',
                                {
                                  rotatedAt: '$$NOW',
                                  replacedByTokenHash: newHash,
                                },
                              ],
                            },
                            '$$t',
                          ],
                        },
                      },
                    },
                    as: 'item',
                    cond: {
                      $and: [
                        { $gt: ['$$item.expiresAt', '$$NOW'] },
                        {
                          $or: [
                            { $eq: ['$$item.rotatedAt', null] },
                            { $gt: ['$$item.rotatedAt', { $subtract: ['$$NOW', 60000] }] },
                          ],
                        },
                      ],
                    },
                  },
                },
                -9,
              ],
            },
            [
              {
                tokenHash: newHash,
                deviceGeneration: activeGeneration,
                expiresAt: newExpiresAt,
                createdAt: '$$NOW',
                rotatedAt: null,
                replacedByTokenHash: null,
              },
            ],
          ],
        },
      },
    },
  ];

  const updated = await Device.findOneAndUpdate(query, updatePipeline, {
    returnDocument: 'after',
    updatePipeline: true,
  });

  if (!updated) {
    const freshDevice = await Device.findOne({ deviceId: device.deviceId }).lean();
    const tokens = freshDevice?.deviceRefreshTokens || device.deviceRefreshTokens || [];
    const matchedEntry = tokens.find((t) => t.tokenHash === incomingHash);

    if (matchedEntry && matchedEntry.rotatedAt) {
      // Replay/reuse of an already rotated refresh token -> invalidate entire refresh token family
      await Device.updateOne(
        { deviceId: device.deviceId },
        { $set: { deviceRefreshTokens: [] } }
      );
      throw new SecurityError(
        'DEVICE_TOKEN_REUSE_DETECTED: Refresh token replay detected; device session invalidated',
        401
      );
    }

    if (matchedEntry && new Date(matchedEntry.expiresAt) <= now) {
      throw new SecurityError('DEVICE_REFRESH_TOKEN_EXPIRED: Device refresh token has expired', 401);
    }

    // Unknown or previously invalidated refresh token
    if (tokens.length > 0) {
      await Device.updateOne(
        { deviceId: device.deviceId },
        { $set: { deviceRefreshTokens: [] } }
      );
    }
    throw new SecurityError(
      'INVALID_DEVICE_REFRESH_TOKEN: Refresh token is invalid or has been invalidated',
      401
    );
  }

  return {
    tokenType: 'Bearer',
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresIn: DEVICE_ACCESS_TTL_SECONDS,
    expiresAt: new Date(now.getTime() + DEVICE_ACCESS_TTL_SECONDS * 1000).toISOString(),
    deviceId: updated.deviceId,
    deviceName: updated.deviceName,
    deviceGeneration: updated.deviceGeneration,
    userId,
  };
}

/**
 * Clears active refresh tokens for a device session without unpairing.
 */
export async function logoutDeviceSession({ deviceId }) {
  await Device.updateOne(
    { deviceId },
    { $set: { deviceRefreshTokens: [], isOnline: false } }
  );
  return { success: true, deviceId };
}

/**
 * Records an authenticated device heartbeat, updating lastSeenAt, isOnline,
 * and sanitized heartbeat metadata. Never trusts body-supplied deviceId.
 */
export async function recordDeviceHeartbeat({ authenticatedDevice, body = {} }) {
  if (!authenticatedDevice?.deviceId || !authenticatedDevice?.userId) {
    throw new SecurityError('DEVICE_AUTH_REQUIRED: Authenticated device context is required', 401);
  }

  if (
    typeof body.deviceId === 'string' &&
    body.deviceId.trim() &&
    body.deviceId.trim() !== authenticatedDevice.deviceId
  ) {
    throw new SecurityError(
      'CROSS_DEVICE_TOKEN_MISUSE: Request body deviceId does not match authenticated device',
      403
    );
  }

  if (
    body.deviceGeneration !== undefined &&
    body.deviceGeneration !== null &&
    Number(body.deviceGeneration) !== Number(authenticatedDevice.deviceGeneration)
  ) {
    throw new SecurityError(
      'DEVICE_GENERATION_MISMATCH: Request body deviceGeneration does not match authenticated device',
      401
    );
  }

  const now = new Date();
  const activeGeneration = Number(authenticatedDevice.deviceGeneration);

  const setFields = {
    isOnline: true,
    lastSeenAt: now,
    lastHeartbeatAt: now,
  };

  if (typeof body.agentVersion === 'string') {
    setFields['heartbeatMetadata.agentVersion'] = body.agentVersion.trim();
  }
  if (typeof body.platform === 'string') {
    setFields['heartbeatMetadata.platform'] = body.platform.trim();
  }
  if (typeof body.arch === 'string') {
    setFields['heartbeatMetadata.arch'] = body.arch.trim();
  }
  if (typeof body.uptimeSeconds === 'number' && Number.isFinite(body.uptimeSeconds)) {
    setFields['heartbeatMetadata.uptimeSeconds'] = Math.floor(body.uptimeSeconds);
  }
  if (typeof body.ollamaAvailable === 'boolean') {
    setFields.ollamaAvailable = body.ollamaAvailable;
  }
  if (Array.isArray(body.installedModels)) {
    setFields.installedModels = body.installedModels;
  }

  const updated = await Device.findOneAndUpdate(
    {
      deviceId: authenticatedDevice.deviceId,
      userId: authenticatedDevice.userId,
      deviceGeneration: activeGeneration,
      isRevoked: false,
      isQuarantined: false,
      'activePairingLock.state': { $nin: ['in_pairing', 'revocation_committed'] },
      stagedDeviceToken: null,
    },
    {
      $set: setFields,
      $inc: { heartbeatCount: 1 },
    },
    { returnDocument: 'after' }
  ).lean();

  if (!updated) {
    const freshDevice = await Device.findOne({ deviceId: authenticatedDevice.deviceId }).lean();
    assertDeviceActiveAndBound(freshDevice, {
      expectedUserId: authenticatedDevice.userId,
      expectedGeneration: activeGeneration,
    });
    throw new SecurityError('DEVICE_HEARTBEAT_REJECTED: Unable to record device heartbeat', 403);
  }

  return {
    status: 'ONLINE',
    deviceId: updated.deviceId,
    deviceName: updated.deviceName,
    deviceGeneration: updated.deviceGeneration,
    isOnline: Boolean(updated.isOnline),
    lastSeenAt: updated.lastSeenAt.toISOString(),
    lastHeartbeatAt: updated.lastHeartbeatAt.toISOString(),
    heartbeatCount: updated.heartbeatCount || 1,
    serverTime: now.toISOString(),
  };
}

/**
 * Revokes a paired device on behalf of its owning user.
 * Enforces strict cross-user ownership isolation and bumps deviceGeneration.
 */
export async function revokeDeviceByOwner({ deviceId, userId }) {
  if (!userId || !mongoose.Types.ObjectId.isValid(String(userId))) {
    throw new SecurityError('INVALID_USER_ID: Valid authenticated user required', 401);
  }

  const device = await Device.findOne({ deviceId });
  if (!device) {
    throw new SecurityError('DEVICE_NOT_FOUND: Device not found', 404);
  }

  if (!device.userId || device.userId.toString() !== String(userId)) {
    throw new SecurityError('FORBIDDEN: You do not own this device', 403);
  }

  const updated = await Device.findOneAndUpdate(
    { deviceId, userId },
    {
      $set: {
        isRevoked: true,
        isOnline: false,
        hashedDeviceToken: null,
        stagedDeviceToken: null,
        deviceRefreshTokens: [],
      },
      $inc: { deviceGeneration: 1 },
    },
    { returnDocument: 'after' }
  );

  return {
    revoked: true,
    deviceId: updated.deviceId,
    deviceGeneration: updated.deviceGeneration,
  };
}
