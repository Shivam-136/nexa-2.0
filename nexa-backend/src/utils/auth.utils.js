import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function getAccessSecret() {
  return process.env.JWT_ACCESS_SECRET || 'nexa_dev_access_secret_super_secure_key_12345';
}

function getRefreshSecret() {
  return process.env.JWT_REFRESH_SECRET || 'nexa_dev_refresh_secret_super_secure_key_67890';
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
