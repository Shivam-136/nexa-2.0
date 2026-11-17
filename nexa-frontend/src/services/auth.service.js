import { API_ENDPOINTS } from '../utils/constants.js';

let inMemoryAccessToken = null;
let inFlightRefreshPromise = null;
const tokenListeners = new Set();

export function getAccessToken() {
  return inMemoryAccessToken;
}

export function setAccessToken(token) {
  inMemoryAccessToken = token;
  tokenListeners.forEach((listener) => {
    try {
      listener(token);
    } catch (err) {
      console.error('[AuthService] Error in token listener:', err);
    }
  });
}

export function subscribeAccessToken(listener) {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

/**
 * Common request wrapper with credentials: 'include' for secure HTTP-only cookies.
 */
async function authFetch(endpoint, options = {}) {
  const url = `${API_ENDPOINTS.AUTH_BASE_URL}${endpoint}`;
  const token = getAccessToken();

  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Ensures HTTP-only refresh cookies are transmitted
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(data.error || data.message || `Auth request failed (${response.status})`);
    error.status = response.status;
    error.code = data.code;
    error.details = data.errors;
    throw error;
  }

  return data;
}

/**
 * Registers a new user account.
 */
export async function register({ email, password, displayName }) {
  const data = await authFetch('/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, displayName }),
  });

  if (data.accessToken) {
    setAccessToken(data.accessToken);
  }

  return data;
}

/**
 * Authenticates user credentials.
 */
export async function login({ email, password }) {
  const data = await authFetch('/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

  if (data.accessToken) {
    setAccessToken(data.accessToken);
  }

  return data;
}

/**
 * Refreshes access token using secure HTTP-only refresh cookie.
 * Deduplicates concurrent in-flight requests (preventing race conditions
 * caused by React StrictMode double mounts or simultaneous API retries).
 */
export async function refreshSession() {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = (async () => {
    try {
      const data = await authFetch('/refresh', {
        method: 'POST',
      });

      if (data.accessToken) {
        setAccessToken(data.accessToken);
      }

      return data;
    } catch (err) {
      setAccessToken(null);
      throw err;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

/**
 * Logs out user and invalidates session.
 */
export async function logout() {
  try {
    await authFetch('/logout', {
      method: 'POST',
    });
  } finally {
    setAccessToken(null);
  }
}

/**
 * Retrieves the current authenticated user profile.
 */
export async function getMe() {
  return await authFetch('/me', {
    method: 'GET',
  });
}

/**
 * Updates authenticated user preferences.
 */
export async function updatePreferences(preferences) {
  return await authFetch('/preferences', {
    method: 'PATCH',
    body: JSON.stringify(preferences),
  });
}

/**
 * Claims legacy 'shivam' records for the authenticated user.
 */
export async function claimLegacyData() {
  return await authFetch('/claim-legacy', {
    method: 'POST',
  });
}
