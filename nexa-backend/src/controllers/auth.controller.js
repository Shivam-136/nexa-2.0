import {
  registerUser,
  loginUser,
  rotateRefreshToken,
  logoutUser,
  getUserProfile,
  updateUserPreferences,
  claimLegacyData,
} from '../services/auth.service.js';
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  REFRESH_COOKIE_NAME,
} from '../utils/auth.utils.js';

/**
 * POST /api/v1/auth/register
 */
export async function handleRegister(req, res, next) {
  try {
    const { email, password, displayName } = req.body;
    const { user, accessToken, refreshToken } = await registerUser({
      email,
      password,
      displayName,
    });

    setRefreshTokenCookie(res, refreshToken);

    return res.status(201).json({
      success: true,
      user,
      accessToken,
      message: 'Account registered successfully.',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/auth/login
 */
export async function handleLogin(req, res, next) {
  try {
    const { email, password } = req.body;
    const { user, accessToken, refreshToken } = await loginUser({
      email,
      password,
    });

    setRefreshTokenCookie(res, refreshToken);

    return res.status(200).json({
      success: true,
      user,
      accessToken,
      message: 'Signed in successfully.',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/auth/refresh
 */
export async function handleRefresh(req, res, next) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Refresh token is missing. Please log in again.',
      });
    }

    const { user, accessToken, refreshToken: newRefreshToken } =
      await rotateRefreshToken(token);

    setRefreshTokenCookie(res, newRefreshToken);

    return res.status(200).json({
      success: true,
      user,
      accessToken,
    });
  } catch (error) {
    clearRefreshTokenCookie(res);
    next(error);
  }
}

/**
 * POST /api/v1/auth/logout
 */
export async function handleLogout(req, res, next) {
  try {
    const token = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    const userId = req.user?.id;

    if (userId) {
      await logoutUser(userId, token).catch(() => {});
    }

    clearRefreshTokenCookie(res);

    return res.status(200).json({
      success: true,
      message: 'Logged out successfully.',
    });
  } catch (error) {
    clearRefreshTokenCookie(res);
    next(error);
  }
}

/**
 * GET /api/v1/auth/me
 */
export async function handleGetMe(req, res, next) {
  try {
    const userId = req.user.id;
    const user = await getUserProfile(userId);

    return res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/v1/auth/preferences
 */
export async function handleUpdatePreferences(req, res, next) {
  try {
    const userId = req.user.id;
    const updatedUser = await updateUserPreferences(userId, req.body);

    return res.status(200).json({
      success: true,
      user: updatedUser,
      message: 'Preferences updated successfully.',
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/v1/auth/claim-legacy
 * Claims legacy data belonging to 'shivam' for the authenticated user.
 */
export async function handleClaimLegacy(req, res, next) {
  try {
    const userId = req.user.id;
    const result = await claimLegacyData(userId);

    return res.status(200).json({
      success: true,
      ...result,
      message: `Successfully migrated ${result.claimedMemories} memories and ${result.claimedConversations} conversations to your account.`,
    });
  } catch (error) {
    next(error);
  }
}
