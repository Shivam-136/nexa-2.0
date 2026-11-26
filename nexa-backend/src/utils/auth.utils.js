import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const TEST_ONLY_ACCESS_SECRET = 'nexa_isolated_test_jwt_access_secret_not_for_prod_00001';
const TEST_ONLY_REFRESH_SECRET = 'nexa_isolated_test_jwt_refresh_secret_not_for_prod_00002';
const DEV_ONLY_ACCESS_SECRET = 'nexa_isolated_dev_jwt_access_secret_local_only_00001';
const DEV_ONLY_REFRESH_SECRET = 'nexa_isolated_dev_jwt_refresh_secret_local_only_00002';

const KNOWN_INSECURE_JWT_DEFAULTS = new Set([
  'nexa_dev_access_secret_super_secure_key_12345',
  'nexa_dev_refresh_secret_super_secure_key_67890',
  'your_jwt_access_secret_min_32_chars',
  'your_jwt_refresh_secret_min_32_chars',
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
 * Validates and returns { accessSecret, refreshSecret }.
 * Fails closed in production if secrets are missing, weak (< 32 chars),
 * insecure defaults, or identical. Keeps dev and test environments isolated.
 * Never logs secret values.
 */
export function validateJwtSecretsConfig() {
  const envAccess = (process.env.JWT_ACCESS_SECRET || '').trim();
  const envRefresh = (process.env.JWT_REFRESH_SECRET || '').trim();

  if (process.env.NODE_ENV === 'production') {
    if (!envAccess || !envRefresh) {
      throw new Error(
        'CONFIGURATION_ERROR: Missing required JWT_ACCESS_SECRET or JWT_REFRESH_SECRET in production'
      );
    }
    if (envAccess.length < 32 || envRefresh.length < 32) {
      throw new Error(
        'CONFIGURATION_ERROR: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be at least 32 characters in production'
      );
    }
    if (
      KNOWN_INSECURE_JWT_DEFAULTS.has(envAccess) ||
      KNOWN_INSECURE_JWT_DEFAULTS.has(envRefresh)
    ) {
      throw new Error(
        'CONFIGURATION_ERROR: Insecure default JWT secret is prohibited in production'
      );
    }
    if (envAccess === envRefresh) {
      throw new Error(
        'CONFIGURATION_ERROR: JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be distinct in production'
      );
    }
    return { accessSecret: envAccess, refreshSecret: envRefresh };
  }

  if (isTestEnvironment()) {
    return {
      accessSecret: envAccess || TEST_ONLY_ACCESS_SECRET,
      refreshSecret: envRefresh || TEST_ONLY_REFRESH_SECRET,
    };
  }

  return {
    accessSecret: envAccess || DEV_ONLY_ACCESS_SECRET,
    refreshSecret: envRefresh || DEV_ONLY_REFRESH_SECRET,
  };
}

export function getAccessSecret() {
  return validateJwtSecretsConfig().accessSecret;
}

export function getRefreshSecret() {
  return validateJwtSecretsConfig().refreshSecret;
}

const ACCESS_EXPIRES_IN = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
const REFRESH_EXPIRES_IN = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

export const REFRESH_COOKIE_NAME = 'nexa_refresh_token';

/**
 * Signs an access JWT for the authenticated user (15m expiry).
 * @param {Object} user
 * @returns {string}
 */
export function signAccessToken(user) {
  const userId = user._id ? user._id.toString() : user.id;
  return jwt.sign(
    {
      userId,
      email: user.email,
    },
    getAccessSecret(),
    { expiresIn: ACCESS_EXPIRES_IN }
  );
}

/**
 * Signs a refresh JWT with unique token identifier (7d expiry).
 * @param {Object} user
 * @returns {string}
 */
export function signRefreshToken(user) {
  const userId = user._id ? user._id.toString() : user.id;
  const tokenId = crypto.randomUUID();
  return jwt.sign(
    {
      userId,
      tokenId,
    },
    getRefreshSecret(),
    { expiresIn: REFRESH_EXPIRES_IN }
  );
}

/**
 * Verifies an access token.
 * @param {string} token
 * @returns {Object} Decoded payload
 */
export function verifyAccessToken(token) {
  return jwt.verify(token, getAccessSecret());
}

/**
 * Verifies a refresh token.
 * @param {string} token
 * @returns {Object} Decoded payload
 */
export function verifyRefreshToken(token) {
  return jwt.verify(token, getRefreshSecret());
}

/**
 * Hashes a token using SHA-256 before database storage.
 * Prevents storage of plain-text refresh tokens.
 * @param {string} token
 * @returns {string}
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Calculates expiration Date for refresh token (7 days from now).
 * @returns {Date}
 */
export function getRefreshTokenExpiry() {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + 7);
  return expiry;
}

/**
 * Attaches a secure HTTP-only refresh cookie to the response.
 * @param {import('express').Response} res
 * @param {string} token
 */
export function setRefreshTokenCookie(res, token) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  });
}

/**
 * Clears the refresh token cookie.
 * @param {import('express').Response} res
 */
export function clearRefreshTokenCookie(res) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}
