import {
  authenticateDevice,
  rotateDeviceRefreshToken,
  logoutDeviceSession,
  revokeDeviceByOwner,
  unpairDeviceByOwner,
  unpairDeviceBySelf,
  recordDeviceHeartbeat,
} from '../services/deviceAuth.service.js';
import { SecurityError } from '../utils/security.errors.js';

function handleSecurityOrNext(err, res, next) {
  if (err instanceof SecurityError) {
    const code = err.message.split(':')[0] || 'DEVICE_AUTH_ERROR';
    return res.status(err.statusCode).json({
      success: false,
      code,
      error: err.message,
    });
  }
  return next(err);
}

/**
 * Exchanges paired device credentials for short-lived access + rotating refresh tokens.
 * POST /api/v1/device/auth/token
 */
export async function handleDeviceAuthenticate(req, res, next) {
  try {
    const { deviceId, deviceGeneration, deviceToken } = req.body;
    const result = await authenticateDevice({
      deviceId,
      deviceGeneration,
      deviceToken,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return handleSecurityOrNext(err, res, next);
  }
}

/**
 * Rotates a device refresh token and issues a fresh access/refresh token pair.
 * POST /api/v1/device/auth/refresh
 */
export async function handleDeviceRefresh(req, res, next) {
  try {
    const { refreshToken, deviceId, deviceGeneration } = req.body;
    const result = await rotateDeviceRefreshToken({
      refreshToken,
      deviceId: deviceId || null,
      deviceGeneration: deviceGeneration ?? null,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return handleSecurityOrNext(err, res, next);
  }
}

/**
 * Logs out the current device session by clearing active refresh tokens.
 * POST /api/v1/device/auth/logout
 */
export async function handleDeviceLogout(req, res, next) {
  try {
    const result = await logoutDeviceSession({ deviceId: req.device.deviceId });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return handleSecurityOrNext(err, res, next);
  }
}

/**
 * Returns authenticated device identity & status (never returns secrets/hashes).
 * GET /api/v1/device/me
 */
export async function handleGetDeviceMe(req, res) {
  return res.status(200).json({
    success: true,
    device: req.device,
    owner: {
      id: req.deviceOwner.id,
      email: req.deviceOwner.email,
      displayName: req.deviceOwner.displayName,
    },
  });
}

/**
 * Verifies device authentication status.
 * GET /api/v1/device/verify
 */
export async function handleVerifyDeviceAuth(req, res) {
  return res.status(200).json({
    success: true,
    authenticated: true,
    device: req.device,
  });
}

/**
 * Records an authenticated device heartbeat.
 * POST /api/v1/device/heartbeat
 */
export async function handleDeviceHeartbeat(req, res, next) {
  try {
    const result = await recordDeviceHeartbeat({
      authenticatedDevice: req.device,
      body: req.body || {},
    });
    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return handleSecurityOrNext(err, res, next);
  }
}

/**
 * Revokes a paired device on behalf of its owning user.
 * POST /api/v1/device/:deviceId/revoke
 */
export async function handleOwnerRevokeDevice(req, res, next) {
  try {
    const deviceId = typeof req.params.deviceId === 'string' ? req.params.deviceId.trim() : '';
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DEVICE_ID',
        error: 'Device ID parameter is required',
      });
    }

    const result = await revokeDeviceByOwner({
      deviceId,
      userId: req.user.id,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return handleSecurityOrNext(err, res, next);
  }
}

/**
 * Unpairs and revokes a paired device on behalf of its owning user.
 * DELETE /api/v1/device/:deviceId/unpair
 */
export async function handleOwnerUnpairDevice(req, res, next) {
  try {
    const deviceId = typeof req.params.deviceId === 'string' ? req.params.deviceId.trim() : '';
    if (!deviceId) {
      return res.status(400).json({
        success: false,
        code: 'INVALID_DEVICE_ID',
        error: 'Device ID parameter is required',
      });
    }

    const result = await unpairDeviceByOwner({
      deviceId,
      userId: req.user.id,
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return handleSecurityOrNext(err, res, next);
  }
}

/**
 * Unpairs the currently authenticated device session (Desktop self-unpair).
 * POST /api/v1/device/unpair | DELETE /api/v1/device/unpair
 */
export async function handleDeviceSelfUnpair(req, res, next) {
  try {
    const result = await unpairDeviceBySelf({
      authenticatedDevice: req.device,
      body: req.body || {},
    });

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (err) {
    return handleSecurityOrNext(err, res, next);
  }
}
