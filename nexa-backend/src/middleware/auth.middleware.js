import { verifyAccessToken } from '../utils/auth.utils.js';
import User from '../models/user.model.js';
import mongoose from 'mongoose';

/**
 * Authentication middleware that requires a valid access token in the Authorization header.
 * Attaches verified user information to `req.user`.
 */
export async function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. No Bearer token provided in Authorization header.',
      });
    }

    const token = authHeader.split(' ')[1];
    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Token is empty.',
      });
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch (jwtErr) {
      if (jwtErr.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          code: 'TOKEN_EXPIRED',
          error: 'Access token has expired. Please refresh your session.',
        });
      }
      return res.status(401).json({
        success: false,
        error: 'Invalid or malformed authentication token.',
      });
    }

    if (!payload?.userId) {
      return res.status(401).json({
        success: false,
        error: 'Invalid token payload. Missing user identity.',
      });
    }

    // Verify user exists in database if DB is connected
    if (mongoose.connection.readyState === 1) {
      const user = await User.findById(payload.userId).lean();
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'User account associated with this token no longer exists.',
        });
      }
      req.user = {
        id: user._id.toString(),
        email: user.email,
        displayName: user.displayName || user.email.split('@')[0],
        aiProvider: user.aiProvider || 'ollama',
        ollamaModel: user.ollamaModel || 'llama3.2',
        ollamaBaseUrl: user.ollamaBaseUrl || 'http://127.0.0.1:11434',
        geminiFallback: user.geminiFallback ?? false,
        voiceLanguage: user.voiceLanguage || 'en-US',
        role: user.role || 'user',
        permissions: Array.isArray(user.permissions) ? user.permissions : [],
      };
    } else {
      // In offline / mock test mode, construct req.user from verified JWT payload
      req.user = {
        id: payload.userId,
        email: payload.email,
        displayName: payload.displayName || payload.email?.split('@')[0] || 'Operator',
        aiProvider: 'ollama',
        ollamaModel: 'llama3.2',
        ollamaBaseUrl: 'http://127.0.0.1:11434',
        geminiFallback: false,
        voiceLanguage: 'en-US',
        role: 'user',
        permissions: [],
      };
    }

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Optional authentication middleware.
 * Attaches `req.user` if valid token is provided, but allows unauthenticated requests to proceed.
 */
export async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      if (token) {
        try {
          const payload = verifyAccessToken(token);
          if (payload?.userId) {
            if (mongoose.connection.readyState === 1) {
              const user = await User.findById(payload.userId).lean();
              if (user) {
                req.user = {
                  id: user._id.toString(),
                  email: user.email,
                  displayName: user.displayName || user.email.split('@')[0],
                  aiProvider: user.aiProvider || 'ollama',
                  ollamaModel: user.ollamaModel || 'llama3.2',
                  ollamaBaseUrl: user.ollamaBaseUrl || 'http://127.0.0.1:11434',
                  geminiFallback: user.geminiFallback ?? false,
                  voiceLanguage: user.voiceLanguage || 'en-US',
                };
              }
            } else {
              req.user = {
                id: payload.userId,
                email: payload.email,
              };
            }
          }
        } catch {
          // Token invalid/expired - proceed as unauthenticated
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Administrative authorization middleware.
 * Must be used AFTER `requireAuth`. Verifies `req.user.role === 'admin'`
 * and that `req.user.permissions` includes the required permission (or '*').
 * Never trusts role, permissions, or admin identity from request body.
 * @param {string} requiredPermission
 */
export function requireAdmin(requiredPermission = 'device:admin_reset') {
  return (req, res, next) => {
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required.',
      });
    }

    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN: Administrator role is required for this operation.',
      });
    }

    const permissions = Array.isArray(req.user.permissions) ? req.user.permissions : [];
    if (
      requiredPermission &&
      !permissions.includes(requiredPermission) &&
      !permissions.includes('*')
    ) {
      return res.status(403).json({
        success: false,
        error: `FORBIDDEN: Missing required administrative permission (${requiredPermission}).`,
      });
    }

    next();
  };
}
