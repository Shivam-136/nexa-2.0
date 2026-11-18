import User from '../models/user.model.js';
import Memory from '../models/memory.model.js';
import Conversation from '../models/conversation.model.js';
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
} from '../utils/auth.utils.js';

/**
 * Registers a new user account.
 * Rejects duplicate emails with a clean error.
 */
export async function registerUser({ email, password, displayName }) {
  const normalizedEmail = email.toLowerCase().trim();

  // Check for existing user
  const existing = await User.findOne({ email: normalizedEmail });
  if (existing) {
    const error = new Error('An account with this email address already exists.');
    error.status = 409;
    throw error;
  }

  // Create new user
  const user = new User({
    email: normalizedEmail,
    password, // Handled by User pre-save hook
    displayName: displayName?.trim() || normalizedEmail.split('@')[0],
  });

  // Generate tokens
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  // Store hashed refresh token
  const tokenHash = hashToken(refreshToken);
  user.refreshTokens.push({
    tokenHash,
    expiresAt: getRefreshTokenExpiry(),
    createdAt: new Date(),
    rotatedAt: null,
    replacedByTokenHash: null,
  });

  await user.save();

  return {
    user: user.toSafeObject(),
    accessToken,
    refreshToken,
  };
}

/**
 * Authenticates user credentials and issues tokens.
 * Uses generic error messages to mitigate account enumeration.
 */
export async function loginUser({ email, password }) {
  const normalizedEmail = email.toLowerCase().trim();

  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    const error = new Error('Invalid email or password.');
    error.status = 401;
    throw error;
  }

  const isMatch = await user.comparePassword(password);
  if (!isMatch) {
    const error = new Error('Invalid email or password.');
    error.status = 401;
    throw error;
  }

  // Generate new token pair
  const accessToken = signAccessToken(user);
  const refreshToken = signRefreshToken(user);

  // Clean expired refresh tokens and add new hashed token
  const now = new Date();
  const pruneCutoff = new Date(Date.now() - 60000);
  const validTokens = (user.refreshTokens || []).filter(
    (t) => t.expiresAt > now && (!t.rotatedAt || t.rotatedAt > pruneCutoff)
  );
  validTokens.push({
    tokenHash: hashToken(refreshToken),
    expiresAt: getRefreshTokenExpiry(),
    createdAt: now,
    rotatedAt: null,
    replacedByTokenHash: null,
  });

  user.refreshTokens = validTokens;
  await user.save();

  return {
    user: user.toSafeObject(),
    accessToken,
    refreshToken,
  };
}

/**
 * Rotates the refresh token and generates a new access token.
 * Detects token reuse with a secure grace window for concurrent requests.
 */
export async function rotateRefreshToken(token) {
  if (!token) {
    const error = new Error('Refresh token is required.');
    error.status = 401;
    throw error;
  }

  let payload;
  try {
    payload = verifyRefreshToken(token);
  } catch (err) {
    const error = new Error('Invalid or expired refresh token. Please log in again.');
    error.status = 401;
    throw error;
  }

  const user = await User.findById(payload.userId);
  if (!user) {
    const error = new Error('User account associated with this token not found.');
    error.status = 401;
    throw error;
  }

  const incomingHash = hashToken(token);
  const now = new Date();

  // 1. Check for active (un-rotated) token
  const activeTokenIndex = (user.refreshTokens || []).findIndex(
    (t) => t.tokenHash === incomingHash && !t.rotatedAt && t.expiresAt > now
  );

  if (activeTokenIndex !== -1) {
    const activeToken = user.refreshTokens[activeTokenIndex];

    // Generate new token pair
    const newAccessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user);
    const newHash = hashToken(newRefreshToken);

    // Mark current token as rotated and link to replacement
    activeToken.rotatedAt = now;
    activeToken.replacedByTokenHash = newHash;

    // Prune expired or stale rotated tokens (older than 60s)
    const pruneCutoff = new Date(Date.now() - 60000);
    user.refreshTokens = user.refreshTokens.filter(
      (t) => (!t.rotatedAt || t.rotatedAt > pruneCutoff) && t.expiresAt > now
    );

    // Append new active refresh token
    user.refreshTokens.push({
      tokenHash: newHash,
      expiresAt: getRefreshTokenExpiry(),
      createdAt: now,
      rotatedAt: null,
      replacedByTokenHash: null,
    });

    await user.save();

    return {
      user: user.toSafeObject(),
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  // 2. Token not active. Check if recently rotated within grace window (30 seconds)
  // Handles React StrictMode double mounts, duplicate network requests, or concurrent tabs
  const graceWindowMs = 30000;
  const recentlyRotated = (user.refreshTokens || []).find(
    (t) =>
      t.tokenHash === incomingHash &&
      t.rotatedAt &&
      now.getTime() - new Date(t.rotatedAt).getTime() < graceWindowMs
  );

  if (recentlyRotated) {
    // Generate valid session tokens for this concurrent request without wiping session family
    const newAccessToken = signAccessToken(user);
    const newRefreshToken = signRefreshToken(user);
    const newHash = hashToken(newRefreshToken);

    user.refreshTokens.push({
      tokenHash: newHash,
      expiresAt: getRefreshTokenExpiry(),
      createdAt: now,
      rotatedAt: null,
      replacedByTokenHash: null,
    });

    const pruneCutoff = new Date(Date.now() - 60000);
    user.refreshTokens = user.refreshTokens.filter(
      (t) => (!t.rotatedAt || t.rotatedAt > pruneCutoff) && t.expiresAt > now
    );

    await user.save();

    return {
      user: user.toSafeObject(),
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
    };
  }

  // 3. Stale rotated token or unknown token -> Replay attack or token reuse outside grace window
  user.refreshTokens = [];
  await user.save();
  const error = new Error('Invalid refresh token. Session invalidated for security.');
  error.status = 401;
  throw error;
}

/**
 * Invalidates a refresh token upon logout.
 */
export async function logoutUser(userId, token) {
  if (!userId) return;

  const user = await User.findById(userId);
  if (!user) return;

  if (token) {
    const incomingHash = hashToken(token);
    user.refreshTokens = (user.refreshTokens || []).filter(
      (t) => t.tokenHash !== incomingHash
    );
  } else {
    // If no specific token given, clear all refresh tokens for complete sign-out
    user.refreshTokens = [];
  }

  await user.save();
}

/**
 * Retrieves the authenticated user's profile.
 */
export async function getUserProfile(userId) {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }
  return user.toSafeObject();
}

/**
 * Updates authenticated user's preferences.
 */
export async function updateUserPreferences(userId, updateData) {
  const user = await User.findById(userId);
  if (!user) {
    const error = new Error('User not found.');
    error.status = 404;
    throw error;
  }

  const allowedFields = [
    'displayName',
    'aiProvider',
    'ollamaModel',
    'ollamaBaseUrl',
    'geminiFallback',
    'voiceLanguage',
  ];

  for (const field of allowedFields) {
    if (updateData[field] !== undefined) {
      user[field] = updateData[field];
    }
  }

  await user.save();
  return user.toSafeObject();
}

/**
 * Safe Migration Strategy:
 * Claims legacy data belonging to 'shivam' and assigns it to the authenticated user.
 * Preserves existing data without deleting anything.
 */
export async function claimLegacyData(userId) {
  if (!userId) {
    const error = new Error('User ID required for claiming legacy data.');
    error.status = 400;
    throw error;
  }

  const targetUserId = userId.toString();

  const [memoryResult, convResult] = await Promise.all([
    Memory.updateMany({ userId: 'shivam' }, { $set: { userId: targetUserId } }),
    Conversation.updateMany({ userId: 'shivam' }, { $set: { userId: targetUserId } }),
  ]);

  return {
    claimedMemories: memoryResult.modifiedCount,
    claimedConversations: convResult.modifiedCount,
  };
}
