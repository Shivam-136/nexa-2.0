import Device from '../models/device.model.js';
import User from '../models/user.model.js';
import { verifyDeviceAccessToken } from '../utils/deviceAuth.utils.js';
import { assertDeviceActiveAndBound } from '../services/deviceAuth.service.js';
import { SecurityError } from '../utils/security.errors.js';

/**
 * Express middleware that authenticates device-to-backend requests using
 * short-lived device access JWTs bound to deviceId, userId, and deviceGeneration.
 * Rejects invalid, expired, cross-device, cross-user, revoked, and quarantined devices.
 */
export async function requireDeviceAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        code: 'DEVICE_AUTH_REQUIRED',
        error: 'Device authentication required. No Bearer token provided.',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        code: 'DEVICE_AUTH_REQUIRED',
        error: 'Device authentication required. Token is empty.',
      });
    }

    let payload;
    try {
      payload = verifyDeviceAccessToken(token);
    } catch (err) {
      if (err instanceof SecurityError) {
        return res.status(err.statusCode).json({
          success: false,
          code: 'INVALID_DEVICE_TOKEN',
          error: err.message,
        });
      }
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          code: 'DEVICE_TOKEN_EXPIRED',
          error: 'Device access token has expired. Please refresh your device session.',
        });
      }
      return res.status(401).json({
        success: false,
        code: 'INVALID_DEVICE_TOKEN',
        error: 'Invalid or malformed device authentication token.',
      });
    }

    if (!payload?.deviceId || !payload?.userId || !Number.isInteger(payload?.deviceGeneration)) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_DEVICE_TOKEN',
        error: 'Invalid device token payload. Missing device identity or generation.',
      });
    }

    // Cross-device header binding check (when X-Device-Id is supplied)
    const headerDeviceId = req.headers['x-device-id'];
    if (typeof headerDeviceId === 'string' && headerDeviceId.trim() && headerDeviceId.trim() !== payload.deviceId) {
      return res.status(403).json({
        success: false,
        code: 'CROSS_DEVICE_TOKEN_MISUSE',
        error: 'Device token does not match X-Device-Id header.',
      });
    }

    // Generation header binding check (when X-Device-Generation is supplied)
    const headerGeneration = req.headers['x-device-generation'];
    if (headerGeneration !== undefined && headerGeneration !== '') {
      if (Number(headerGeneration) !== Number(payload.deviceGeneration)) {
        return res.status(401).json({
          success: false,
          code: 'DEVICE_GENERATION_MISMATCH',
          error: 'Device token generation does not match X-Device-Generation header.',
        });
      }
    }

    const device = await Device.findOne({ deviceId: payload.deviceId }).lean();
    assertDeviceActiveAndBound(device, {
      expectedUserId: payload.userId,
      expectedGeneration: payload.deviceGeneration,
    });

    const owner = await User.findById(device.userId).lean();
    if (!owner) {
      return res.status(401).json({
        success: false,
        code: 'DEVICE_OWNER_NOT_FOUND',
        error: 'User account associated with this device no longer exists.',
      });
    }

    req.device = {
      id: device._id.toString(),
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      deviceGeneration: device.deviceGeneration,
      userId: device.userId.toString(),
      isOnline: Boolean(device.isOnline),
      isRevoked: Boolean(device.isRevoked),
      isQuarantined: Boolean(device.isQuarantined),
      lastSeenAt: device.lastSeenAt,
      lastAuthenticatedAt: device.lastAuthenticatedAt,
    };

    req.deviceOwner = {
      id: owner._id.toString(),
      email: owner.email,
      displayName: owner.displayName || owner.email.split('@')[0],
      role: owner.role || 'user',
    };

    next();
  } catch (err) {
    if (err instanceof SecurityError) {
      const code = err.message.split(':')[0] || 'DEVICE_AUTH_ERROR';
      return res.status(err.statusCode).json({
        success: false,
        code,
        error: err.message,
      });
    }
    next(err);
  }
}

export default requireDeviceAuth;
