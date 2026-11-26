import { Router } from 'express';
import {
  handleDeviceAuthenticate,
  handleDeviceRefresh,
  handleDeviceLogout,
  handleGetDeviceMe,
  handleVerifyDeviceAuth,
  handleDeviceHeartbeat,
  handleOwnerRevokeDevice,
} from '../controllers/deviceAuth.controller.js';
import { requireDeviceAuth } from '../middleware/deviceAuth.middleware.js';
import { requireAuth } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import { deviceAuthRateLimiter } from '../middleware/rateLimit.middleware.js';
import {
  deviceTokenAuthSchema,
  deviceRefreshSchema,
  deviceHeartbeatSchema,
} from '../validators/deviceAuth.validator.js';

const router = Router();

// Public device authentication & token rotation endpoints (rate-limited + Zod-validated)
router.post(
  '/auth/token',
  deviceAuthRateLimiter,
  validateBody(deviceTokenAuthSchema),
  handleDeviceAuthenticate
);

router.post(
  '/auth/refresh',
  deviceAuthRateLimiter,
  validateBody(deviceRefreshSchema),
  handleDeviceRefresh
);

// Protected device endpoints (requireDeviceAuth)
router.post(
  '/auth/logout',
  deviceAuthRateLimiter,
  requireDeviceAuth,
  handleDeviceLogout
);

router.get(
  '/me',
  deviceAuthRateLimiter,
  requireDeviceAuth,
  handleGetDeviceMe
);

router.get(
  '/verify',
  deviceAuthRateLimiter,
  requireDeviceAuth,
  handleVerifyDeviceAuth
);

router.post(
  '/heartbeat',
  deviceAuthRateLimiter,
  requireDeviceAuth,
  validateBody(deviceHeartbeatSchema),
  handleDeviceHeartbeat
);

// User-authenticated device revocation (cross-user isolated)
router.post(
  '/:deviceId/revoke',
  deviceAuthRateLimiter,
  requireAuth,
  handleOwnerRevokeDevice
);

export default router;
