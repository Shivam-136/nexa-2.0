import { Router } from 'express';
import {
  handleRegister,
  handleLogin,
  handleRefresh,
  handleLogout,
  handleGetMe,
  handleUpdatePreferences,
  handleClaimLegacy,
} from '../controllers/auth.controller.js';
import { requireAuth, optionalAuth } from '../middleware/auth.middleware.js';
import { validateBody } from '../middleware/validate.middleware.js';
import {
  registerSchema,
  loginSchema,
  updatePreferencesSchema,
} from '../validators/auth.validator.js';
import {
  authRateLimiter,
  sessionRateLimiter,
} from '../middleware/rateLimit.middleware.js';

const router = Router();

// Public Authentication Endpoints (Rate limited + Zod validated)
router.post('/register', authRateLimiter, validateBody(registerSchema), handleRegister);
router.post('/login', authRateLimiter, validateBody(loginSchema), handleLogin);
router.post('/refresh', sessionRateLimiter, handleRefresh);
router.post('/logout', optionalAuth, handleLogout);

// Protected User Endpoints (Requires verified JWT)
router.get('/me', requireAuth, handleGetMe);
router.patch('/preferences', requireAuth, validateBody(updatePreferencesSchema), handleUpdatePreferences);
router.post('/claim-legacy', requireAuth, handleClaimLegacy);

export default router;
