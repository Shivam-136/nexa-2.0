import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import * as authService from '../services/auth.service.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [accessToken, setAccessTokenState] = useState(authService.getAccessToken());
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState(null);

  // Synchronize state whenever access token is updated/refreshed by background services
  useEffect(() => {
    const unsubscribe = authService.subscribeAccessToken((token) => {
      setAccessTokenState(token);
    });
    return unsubscribe;
  }, []);

  // Initialize and silently restore session from HTTP-only refresh cookie
  useEffect(() => {
    let mounted = true;

    async function initSession() {
      try {
        const res = await authService.refreshSession();
        if (mounted && res?.user && res?.accessToken) {
          setUser(res.user);
          setAccessTokenState(res.accessToken);
        }
      } catch (err) {
        // No active session or expired cookie - normal for unauthenticated visits
        if (mounted) {
          setUser(null);
          setAccessTokenState(null);
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    initSession();

    return () => {
      mounted = false;
    };
  }, []);

  const login = useCallback(async ({ email, password }) => {
    setAuthError(null);
    try {
      const res = await authService.login({ email, password });
      setUser(res.user);
      setAccessTokenState(res.accessToken);
      return res;
    } catch (err) {
      setAuthError(err.message || 'Login failed');
      throw err;
    }
  }, []);

  const register = useCallback(async ({ email, password, displayName }) => {
    setAuthError(null);
    try {
      const res = await authService.register({ email, password, displayName });
      setUser(res.user);
      setAccessTokenState(res.accessToken);
      return res;
    } catch (err) {
      setAuthError(err.message || 'Registration failed');
      throw err;
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authService.logout();
    } catch {
      // Ignore logout errors
    } finally {
      setUser(null);
      setAccessTokenState(null);
      setAuthError(null);
    }
  }, []);

  const updatePreferences = useCallback(async (newPreferences) => {
    const res = await authService.updatePreferences(newPreferences);
    if (res?.user) {
      setUser(res.user);
    }
    return res;
  }, []);

  const claimLegacy = useCallback(async () => {
    return await authService.claimLegacyData();
  }, []);

  const value = {
    user,
    accessToken,
    isAuthenticated: Boolean(user && accessToken),
    isLoading,
    authError,
    setAuthError,
    login,
    register,
    logout,
    updatePreferences,
    claimLegacy,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export default AuthContext;
