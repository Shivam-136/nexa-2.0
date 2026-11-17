import { API_ENDPOINTS } from '../utils/constants.js';
import { getAccessToken, refreshSession } from './auth.service.js';

/**
 * Core API Client for NEXA 2.0 Backend Services
 * Configured with automatic Bearer token injection and refresh token rotation.
 */
class ApiClient {
  constructor(baseURL = API_ENDPOINTS.BASE_URL) {
    this.baseURL = baseURL;
    this.isRefreshing = false;
  }

  async request(endpoint, options = {}, isRetry = false) {
    const url = `${this.baseURL}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;
    const token = getAccessToken();

    const headers = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    };

    const config = {
      ...options,
      headers,
      credentials: 'include',
    };

    try {
      const response = await fetch(url, config);

      if (response.status === 401 && !isRetry) {
        // Attempt silent token refresh
        try {
          const refreshRes = await refreshSession();
          if (refreshRes?.accessToken) {
            // Retry request with fresh token
            return this.request(endpoint, options, true);
          }
        } catch {
          // Refresh failed - proceed with reporting 401
        }
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const err = new Error(errorData.error || errorData.message || `Request failed with status ${response.status}`);
        err.status = response.status;
        err.data = errorData;
        throw err;
      }

      return await response.json();
    } catch (error) {
      console.error(`[API Error] ${options.method || 'GET'} ${url}:`, error.message);
      throw error;
    }
  }

  get(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'GET' });
  }

  post(endpoint, body, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  put(endpoint, body, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  patch(endpoint, body, options = {}) {
    return this.request(endpoint, {
      ...options,
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  }

  delete(endpoint, options = {}) {
    return this.request(endpoint, { ...options, method: 'DELETE' });
  }
}

export const apiClient = new ApiClient();
export default apiClient;
