import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { hashToken } from './auth.utils.js';
import { SecurityError } from './security.errors.js';

const TEST_ONLY_DEVICE_ACCESS_SECRET = 'nexa_isolated_test_device_access_secret_not_prod_00001';
const TEST_ONLY_DEVICE_REFRESH_SECRET = 'nexa_isolated_test_device_refresh_secret_not_prod_00002';
const DEV_ONLY_DEVICE_ACCESS_SECRET = 'nexa_isolated_dev_device_access_secret_local_00001';
const DEV_ONLY_DEVICE_REFRESH_SECRET = 'nexa_isolated_dev_device_refresh_secret_local_00002';

const KNOWN_INSECURE_DEFAULTS = new Set([
  'nexa_dev_access_secret_super_secure_key_12345',
  'nexa_dev_refresh_secret_super_secure_key_67890',
  'your_jwt_access_secret_min_32_chars',
  'your_jwt_refresh_secret_min_32_chars',
  'changeme',
  'secret',
]);

export const DEVICE_ACCESS_TTL_SECONDS = 15 * 60; // 15 minutes
export const DEVICE_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function isTestEnvironment() {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'development') {
    return false;
  }
  return process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);
}

/**
 * Validates and returns isolated { accessSecret, refreshSecret } for device JWTs.
 * Fails closed in production if secrets are missing, weak, insecure defaults, or collide
 * with user JWT or RAT secrets.
 */
export function validateDeviceJwtSecretsConfig() {
  const envAccess = (process.env.DEVICE_ACCESS_SECRET || '').trim();
  const envRefresh = (process.env.DEVICE_REFRESH_SECRET || '').trim();

  if (process.env.NODE_ENV === 'production') {
    if (!envAccess || !envRefresh) {
      throw new SecurityError(
        'CONFIGURATION_ERROR: Missing required DEVICE_ACCESS_SECRET or DEVICE_REFRESH_SECRET in production',
        500
      );
    }
    if (envAccess.length < 32 || envRefresh.length < 32) {
      throw new SecurityError(
        'CONFIGURATION_ERROR: DEVICE_ACCESS_SECRET and DEVICE_REFRESH_SECRET must be at least 32 characters in production',
        500
      );
    }
    if (KNOWN_INSECURE_DEFAULTS.has(envAccess) || KNOWN_INSECURE_DEFAULTS.has(envRefresh)) {
      throw new SecurityError(
        'CONFIGURATION_ERROR: Insecure default device JWT secret is prohibited in production',
        500
      );
    }
    if (envAccess === envRefresh) {
      throw new SecurityError(
        'CONFIGURATION_ERROR: DEVICE_ACCESS_SECRET and DEVICE_REFRESH_SECRET must be distinct in production',
        500
      );
    }
    const userAccess = (process.env.JWT_ACCESS_SECRET || '').trim();
    const userRefresh = (process.env.JWT_REFRESH_SECRET || '').trim();
    const ratSecret = (process.env.RAT_SECRET || '').trim();
    if (
      (userAccess && (envAccess === userAccess || envRefresh === userAccess)) ||
      (userRefresh && (envAccess === userRefresh || envRefresh === userRefresh)) ||
      (ratSecret && (envAccess === ratSecret || envRefresh === ratSecret))
    ) {
      throw new SecurityError(
        'CONFIGURATION_ERROR: Device JWT secrets must be distinct from user JWT and RAT secrets in production',
        500
      );
    }
    return { accessSecret: envAccess, refreshSecret: envRefresh };
  }

  if (isTestEnvironment()) {
    return {
      accessSecret: envAccess || TEST_ONLY_DEVICE_ACCESS_SECRET,
      refreshSecret: envRefresh || TEST_ONLY_DEVICE_REFRESH_SECRET,
    };
  }

  return {
    accessSecret: envAccess || DEV_ONLY_DEVICE_ACCESS_SECRET,
    refreshSecret: envRefresh || DEV_ONLY_DEVICE_REFRESH_SECRET,
  };
}

/**
 * Signs a short-lived device access JWT bound to deviceId, userId, and deviceGeneration.
 */
export function signDeviceAccessToken({ deviceId, userId, deviceGeneration }, expiresIn = process.env.DEVICE_ACCESS_EXPIRES_IN || '15m') {
  const { accessSecret } = validateDeviceJwtSecretsConfig();
  return jwt.sign(
    {
      typ: 'nexa_device_access',
      sub: deviceId,
      deviceId,
      userId: String(userId),
      deviceGeneration: Number(deviceGeneration),
      jti: crypto.randomUUID(),
    },
    accessSecret,
    {
      algorithm: 'HS256',
      expiresIn,
    }
  );
}

/**
 * Signs a device refresh JWT bound to deviceId, userId, and deviceGeneration.
 */
export function signDeviceRefreshToken({ deviceId, userId, deviceGeneration }, expiresIn = process.env.DEVICE_REFRESH_EXPIRES_IN || '7d') {
  const { refreshSecret } = validateDeviceJwtSecretsConfig();
  return jwt.sign(
    {
      typ: 'nexa_device_refresh',
      sub: deviceId,
      deviceId,
      userId: String(userId),
      deviceGeneration: Number(deviceGeneration),
      tokenId: crypto.randomUUID(),
    },
    refreshSecret,
    {
      algorithm: 'HS256',
      expiresIn,
    }
  );
}

/**
 * Verifies a device access JWT and enforces its type claim.
 */
export function verifyDeviceAccessToken(token) {
  const { accessSecret } = validateDeviceJwtSecretsConfig();
  const payload = jwt.verify(token, accessSecret, { algorithms: ['HS256'] });
  if (!payload || payload.typ !== 'nexa_device_access') {
    throw new SecurityError('INVALID_DEVICE_TOKEN_TYPE: Expected device access token', 401);
  }
  return payload;
}

/**
 * Verifies a device refresh JWT and enforces its type claim.
 */
export function verifyDeviceRefreshToken(token) {
  const { refreshSecret } = validateDeviceJwtSecretsConfig();
  const payload = jwt.verify(token, refreshSecret, { algorithms: ['HS256'] });
  if (!payload || payload.typ !== 'nexa_device_refresh') {
    throw new SecurityError('INVALID_DEVICE_TOKEN_TYPE: Expected device refresh token', 401);
  }
  return payload;
}

/**
 * Constant-time comparison between a raw token and its stored SHA-256 hex digest.
 */
export function verifyHashedDeviceToken(rawToken, storedHexHash) {
  if (typeof rawToken !== 'string' || typeof storedHexHash !== 'string' || !storedHexHash) {
    return false;
  }
  const calculatedHex = hashToken(rawToken);
  const calcBuf = Buffer.from(calculatedHex, 'hex');
  const storedBuf = Buffer.from(storedHexHash, 'hex');
  if (calcBuf.length === 0 || calcBuf.length !== storedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(calcBuf, storedBuf);
}

export { hashToken };
