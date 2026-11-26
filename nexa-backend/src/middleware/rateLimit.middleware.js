import rateLimit from 'express-rate-limit';

/**
 * Strict rate limiter for authentication entry points (login, registration).
 * Mitigates credential stuffing, password brute-force, and automated registration attacks.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'test' ? 1000 : 25, // Generous during automated tests
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many authentication attempts. Please try again after 15 minutes.',
  },
  statusCode: 429,
});

/**
 * Standard rate limiter for token refresh and session verification.
 */
export const sessionRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many session requests. Please slow down.',
  },
  statusCode: 429,
});

/**
 * Rate limiter for pairing and recovery endpoints.
 */
export const pairingRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 5000 : 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many recovery or pairing requests. Please slow down.',
  },
  statusCode: 429,
});

/**
 * Strict rate limiter for pairing code claim attempts to mitigate brute-force guessing.
 */
export const pairingClaimRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 5000 : 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many pairing claim attempts. Please wait before trying again.',
  },
  statusCode: 429,
});

/**
 * Rate limiter for device authentication and token rotation endpoints.
 */
export const deviceAuthRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 5000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many device authentication attempts. Please slow down.',
  },
  statusCode: 429,
});
