import { Router } from 'express';
import {
  handleRecoverMrc,
  handleRecoverRetry,
  handleDeliveryKeepalive,
  handleConfirmActivation,
  handleReleaseFence,
  handleAdminReset,
  handleInitiatePairing,
  handleGetPairingStatus,
  handleCancelPairing,
  handleClaimPairing,
} from '../controllers/pairing.controller.js';
import { validateBody } from '../middleware/validate.middleware.js';
import {
  recoverMrcSchema,
  recoverRetrySchema,
  deliveryKeepaliveSchema,
  confirmActivationSchema,
  releaseFenceSchema,
  adminResetSchema,
  initiatePairingSchema,
  cancelPairingSchema,
  claimPairingSchema,
} from '../validators/pairing.validator.js';
import { pairingRateLimiter, pairingClaimRateLimiter } from '../middleware/rateLimit.middleware.js';
import { requireAuth, requireAdmin } from '../middleware/auth.middleware.js';

const router = Router();

// Device Pairing Endpoints (Milestone 3.4.1)
router.post(
  '/initiate',
  pairingRateLimiter,
  requireAuth,
  validateBody(initiatePairingSchema),
  handleInitiatePairing
);

router.get(
  '/status',
  pairingRateLimiter,
  requireAuth,
  handleGetPairingStatus
);

router.post(
  '/cancel',
  pairingRateLimiter,
  requireAuth,
  validateBody(cancelPairingSchema),
  handleCancelPairing
);

router.post(
  '/claim',
  pairingClaimRateLimiter,
  validateBody(claimPairingSchema),
  handleClaimPairing
);

// Recovery Endpoints (Milestone 3.3 Domain 1)
router.post(
  '/recover-mrc',
  pairingRateLimiter,
  validateBody(recoverMrcSchema),
  handleRecoverMrc
);

router.post(
  '/recover-retry',
  pairingRateLimiter,
  validateBody(recoverRetrySchema),
  handleRecoverRetry
);

// Delivery Fence Endpoints (Milestone 3.3 Domain 2)
router.post(
  '/delivery-keepalive',
  pairingRateLimiter,
  validateBody(deliveryKeepaliveSchema),
  handleDeliveryKeepalive
);

router.post(
  '/confirm-activation',
  pairingRateLimiter,
  validateBody(confirmActivationSchema),
  handleConfirmActivation
);

router.post(
  '/release-fence',
  pairingRateLimiter,
  validateBody(releaseFenceSchema),
  handleReleaseFence
);

router.post(
  '/admin-reset/:deviceId',
  pairingRateLimiter,
  requireAuth,
  requireAdmin('device:admin_reset'),
  validateBody(adminResetSchema),
  handleAdminReset
);

export default router;
