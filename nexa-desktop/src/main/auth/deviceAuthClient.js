/**
 * NEXA 2.0 Desktop Agent - Device Authentication Client (Main Process Only)
 * Phase 6 — Milestone 3.4.2: Secure Device-to-Backend Authentication
 *
 * Security Invariants:
 * - Executes strictly in the Main Process.
 * - Retrieves deviceToken strictly from DPAPI SecureStorageService.
 * - Keeps short-lived accessToken and rotating refreshToken in Main Process memory ONLY.
 * - NEVER exposes deviceToken, accessToken, or refreshToken through IPC or to the renderer.
 * - Handles revoked, expired, quarantined, and replay errors safely.
 */

const DEFAULT_BACKEND_URL = process.env.NEXA_BACKEND_URL || 'http://127.0.0.1:5000';
const REFRESH_LEEWAY_MS = 30 * 1000;

class DeviceAuthClient {
  /**
   * @param {Object} options
   * @param {Object} options.storageService - SecureStorageService instance
   * @param {Function} [options.fetchImpl] - Fetch implementation (injectable for tests)
   * @param {Function} [options.onStatusChange] - Callback invoked with sanitized auth status
   */
  constructor({ storageService, fetchImpl = null, onStatusChange = null } = {}) {
    if (!storageService) {
      throw new Error('DeviceAuthClient requires a SecureStorageService instance');
    }
    this._storageService = storageService;
    this._fetch = fetchImpl || globalThis.fetch;
    this._onStatusChange = typeof onStatusChange === 'function' ? onStatusChange : () => {};

    // Strictly Main Process in-memory session state (NEVER exposed via IPC)
    this._accessToken = null;
    this._refreshToken = null;
    this._accessTokenExpiresAt = null;
    this._deviceId = null;
    this._deviceGeneration = null;
    this._userId = null;
    this._backendUrl = null;

    this._state = storageService.hasCredentials() ? 'unauthenticated' : 'unpaired';
    this._lastError = null;
    this._authPromise = null;
    this._refreshPromise = null;
    this._unpairPromise = null;
  }

  /**
   * Validates and normalizes backend URL.
   * @param {string} [rawUrl]
   * @returns {string}
   */
  validateBackendUrl(rawUrl) {
    const candidate = (typeof rawUrl === 'string' && rawUrl.trim()) ? rawUrl.trim() : DEFAULT_BACKEND_URL;
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch (err) {
      throw new Error(`INVALID_BACKEND_URL: ${err.message}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('INVALID_BACKEND_URL: Protocol must be http: or https:');
    }
    if (parsed.username || parsed.password) {
      throw new Error('INVALID_BACKEND_URL: Embedded credentials are not permitted');
    }
    return parsed.origin;
  }

  /**
   * Emits sanitized auth status to listeners (ZERO secrets).
   */
  _emitStatus() {
    try {
      this._onStatusChange(this.getAuthStatus());
    } catch (_) {
      // Ignore listener errors
    }
  }

  /**
   * Clears in-memory short-lived access and refresh tokens without deleting DPAPI vault.
   */
  clearSession({ nextState = null, lastError = null } = {}) {
    this._accessToken = null;
    this._refreshToken = null;
    this._accessTokenExpiresAt = null;

    if (nextState) {
      this._state = nextState;
    } else {
      this._state = this._storageService.hasCredentials() ? 'unauthenticated' : 'unpaired';
    }
    this._lastError = lastError;
    this._emitStatus();
  }

  /**
   * Returns strictly sanitized authentication metadata for IPC/UI consumption.
   * GUARANTEE: Never includes deviceToken, accessToken, or refreshToken.
   */
  getAuthStatus() {
    const deviceInfo = typeof this._storageService.getDeviceInfo === 'function'
      ? this._storageService.getDeviceInfo()
      : { isPaired: false, deviceId: null, userId: null };

    const isPaired = Boolean(deviceInfo.isPaired);
    const authenticated = Boolean(
      isPaired &&
      this._accessToken &&
      this._accessTokenExpiresAt &&
      Date.now() < this._accessTokenExpiresAt
    );

    return {
      state: isPaired ? this._state : 'unpaired',
      isPaired,
      authenticated,
      deviceId: this._deviceId || deviceInfo.deviceId || null,
      deviceGeneration: this._deviceGeneration || null,
      userId: this._userId || deviceInfo.userId || null,
      expiresAt: this._accessTokenExpiresAt ? new Date(this._accessTokenExpiresAt).toISOString() : null,
      lastError: this._lastError,
    };
  }

  /**
   * Reads DPAPI-backed credentials in the Main Process and authenticates with the backend.
   * Uses single-flight deduplication for concurrent callers.
   * @returns {Promise<Object>} Sanitized auth status
   */
  async authenticate() {
    if (this._authPromise) {
      return await this._authPromise;
    }

    this._authPromise = (async () => {
      if (typeof this._storageService.isEncryptionAvailable === 'function' && !this._storageService.isEncryptionAvailable()) {
        const msg = 'NEXA_ERR_ENCRYPTION_UNAVAILABLE: OS DPAPI encryption is unavailable';
        this.clearSession({ nextState: 'error', lastError: msg });
        throw new Error(msg);
      }

      const credentials = this._storageService.getCredentials();
      if (!credentials || !credentials.deviceId || !credentials.deviceToken) {
        const msg = 'DEVICE_NOT_PAIRED: No paired device credentials found in DPAPI storage';
        this.clearSession({ nextState: 'unpaired', lastError: msg });
        throw new Error(msg);
      }

      if (typeof this._fetch !== 'function') {
        throw new Error('FETCH_UNAVAILABLE: HTTP client is not available in Main Process');
      }

      const backendUrl = this.validateBackendUrl(credentials.backendUrl);
      const deviceGeneration = Number.isInteger(credentials.deviceGeneration) && credentials.deviceGeneration >= 1
        ? credentials.deviceGeneration
        : 1;

      this._state = 'authenticating';
      this._lastError = null;
      this._emitStatus();

      try {
        const response = await this._fetch(`${backendUrl}/api/v1/device/auth/token`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            deviceId: credentials.deviceId,
            deviceGeneration,
            deviceToken: credentials.deviceToken,
          }),
        });

        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.success) {
          const code = payload.code || '';
          const errMsg = payload.error || payload.message || `Device authentication failed with HTTP ${response.status}`;
          const nextState = (code === 'DEVICE_REVOKED' || code === 'DEVICE_QUARANTINED') ? 'revoked' : 'error';
          this.clearSession({ nextState, lastError: errMsg });
          const err = new Error(errMsg);
          err.code = code || 'DEVICE_AUTH_FAILED';
          err.statusCode = response.status;
          throw err;
        }

        if (!payload.accessToken || !payload.refreshToken) {
          const msg = 'INVALID_AUTH_RESPONSE: Backend did not return required session tokens';
          this.clearSession({ nextState: 'error', lastError: msg });
          throw new Error(msg);
        }

        const expiresInMs = (Number(payload.expiresIn) || 900) * 1000;
        this._accessToken = payload.accessToken;
        this._refreshToken = payload.refreshToken;
        this._accessTokenExpiresAt = payload.expiresAt ? Date.parse(payload.expiresAt) : Date.now() + expiresInMs;
        this._deviceId = payload.deviceId || credentials.deviceId;
        this._deviceGeneration = payload.deviceGeneration || deviceGeneration;
        this._userId = payload.userId || credentials.userId;
        this._backendUrl = backendUrl;
        this._state = 'authenticated';
        this._lastError = null;
        this._emitStatus();

        return {
          success: true,
          ...this.getAuthStatus(),
        };
      } catch (err) {
        if (this._state === 'authenticating') {
          this.clearSession({ nextState: 'error', lastError: err.message });
        }
        throw err;
      }
    })();

    try {
      return await this._authPromise;
    } finally {
      this._authPromise = null;
    }
  }

  /**
   * Rotates the current device refresh token using single-flight deduplication.
   * @returns {Promise<Object>} Sanitized auth status
   */
  async refreshSession() {
    if (this._refreshPromise) {
      return await this._refreshPromise;
    }

    this._refreshPromise = (async () => {
      if (!this._refreshToken) {
        return await this.authenticate();
      }

      if (typeof this._fetch !== 'function') {
        throw new Error('FETCH_UNAVAILABLE: HTTP client is not available in Main Process');
      }

      const credentials = this._storageService.getCredentials();
      const backendUrl = this.validateBackendUrl(this._backendUrl || credentials?.backendUrl);
      const deviceId = this._deviceId || credentials?.deviceId;
      const deviceGeneration = this._deviceGeneration || credentials?.deviceGeneration || 1;

      const response = await this._fetch(`${backendUrl}/api/v1/device/auth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          refreshToken: this._refreshToken,
          deviceId,
          deviceGeneration,
        }),
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        const code = payload.code || '';
        const errMsg = payload.error || payload.message || `Device token refresh failed with HTTP ${response.status}`;
        // Preserve refresh token on transient 5xx server errors so safe retry remains possible
        if (response.status < 500) {
          const nextState = (code === 'DEVICE_REVOKED' || code === 'DEVICE_QUARANTINED') ? 'revoked' : 'error';
          this.clearSession({ nextState, lastError: errMsg });
        } else {
          this._lastError = errMsg;
          this._emitStatus();
        }
        const err = new Error(errMsg);
        err.code = code || 'DEVICE_REFRESH_FAILED';
        err.statusCode = response.status;
        throw err;
      }

      const expiresInMs = (Number(payload.expiresIn) || 900) * 1000;
      this._accessToken = payload.accessToken;
      this._refreshToken = payload.refreshToken;
      this._accessTokenExpiresAt = payload.expiresAt ? Date.parse(payload.expiresAt) : Date.now() + expiresInMs;
      this._deviceId = payload.deviceId || deviceId;
      this._deviceGeneration = payload.deviceGeneration || deviceGeneration;
      this._userId = payload.userId || this._userId;
      this._backendUrl = backendUrl;
      this._state = 'authenticated';
      this._lastError = null;
      this._emitStatus();

      return {
        success: true,
        ...this.getAuthStatus(),
      };
    })();

    try {
      return await this._refreshPromise;
    } finally {
      this._refreshPromise = null;
    }
  }

  /**
   * Executes an authenticated device-to-backend HTTP request from the Main Process.
   * Automatically attaches Bearer access token and device binding headers.
   * Refreshes once on DEVICE_TOKEN_EXPIRED.
   */
  async authenticatedFetch(pathname, options = {}) {
    if (!this._accessToken || !this._accessTokenExpiresAt) {
      await this.authenticate();
    } else if (Date.now() >= this._accessTokenExpiresAt - REFRESH_LEEWAY_MS) {
      await this.refreshSession();
    }

    const backendUrl = this.validateBackendUrl(this._backendUrl);
    const targetUrl = `${backendUrl}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;

    const makeHeaders = () => ({
      Accept: 'application/json',
      ...(options.headers || {}),
      Authorization: `Bearer ${this._accessToken}`,
      'X-Device-Id': this._deviceId,
      'X-Device-Generation': String(this._deviceGeneration),
    });

    const usedToken = this._accessToken;
    let response = await this._fetch(targetUrl, {
      ...options,
      headers: makeHeaders(),
    });

    if (response.status === 401) {
      const cloned = typeof response.clone === 'function' ? response.clone() : null;
      const errBody = cloned ? await cloned.json().catch(() => ({})) : {};
      if (errBody.code === 'DEVICE_TOKEN_EXPIRED') {
        if (!this._accessToken || this._accessToken === usedToken) {
          await this.refreshSession();
        }
        response = await this._fetch(targetUrl, {
          ...options,
          headers: makeHeaders(),
        });
      }
    }

    return response;
  }

  /**
   * Verifies device authentication against the protected backend endpoint.
   * Returns strictly sanitized device metadata.
   */
  async verifyDeviceSession() {
    const response = await this.authenticatedFetch('/api/v1/device/verify', { method: 'GET' });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.success) {
      const code = payload.code || 'DEVICE_VERIFY_FAILED';
      const errMsg = payload.error || `Device verification failed with HTTP ${response.status}`;
      if (code === 'DEVICE_REVOKED' || code === 'DEVICE_QUARANTINED') {
        this.clearSession({ nextState: 'revoked', lastError: errMsg });
      }
      const err = new Error(errMsg);
      err.code = code;
      err.statusCode = response.status;
      throw err;
    }

    return {
      success: true,
      authenticated: true,
      device: payload.device,
    };
  }

  /**
   * Logs out the current device session and clears in-memory tokens.
   */
  async logout() {
    if (this._accessToken && this._backendUrl && typeof this._fetch === 'function') {
      try {
        await this._fetch(`${this._backendUrl}/api/v1/device/auth/logout`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this._accessToken}`,
            'X-Device-Id': this._deviceId || '',
            'X-Device-Generation': String(this._deviceGeneration || 1),
          },
        });
      } catch (_) {
        // Best-effort server logout
      }
    }
    this.clearSession();
    return { success: true };
  }

  /**
   * Securely unpairs the device from the backend, then stops HeartbeatClient / Auto Reconnect,
   * clears in-memory session tokens, and deletes DPAPI-backed credentials.
   * If backend is unreachable, preserves local credentials and returns a retryable pending state.
   */
  async unpairDevice({ heartbeatClient = null } = {}) {
    if (this._unpairPromise) {
      return await this._unpairPromise;
    }

    this._unpairPromise = (async () => {
      const hasCreds = typeof this._storageService.hasCredentials === 'function'
        ? this._storageService.hasCredentials()
        : Boolean(this._storageService.getCredentials?.());

      if (!hasCreds && !this._accessToken && !this._refreshToken) {
        if (heartbeatClient && typeof heartbeatClient.reset === 'function') {
          heartbeatClient.reset();
        }
        this.clearSession({ nextState: 'unpaired', lastError: null });
        return {
          success: true,
          unpaired: true,
          alreadyUnpaired: true,
          remoteRevocationPending: false,
        };
      }

      const cleanupLocalState = () => {
        if (heartbeatClient && typeof heartbeatClient.reset === 'function') {
          heartbeatClient.reset();
        } else if (heartbeatClient && typeof heartbeatClient.stop === 'function') {
          heartbeatClient.stop();
        }
        this._deviceId = null;
        this._deviceGeneration = null;
        this._userId = null;
        this._backendUrl = null;
        if (typeof this._storageService.clearCredentials === 'function') {
          this._storageService.clearCredentials();
        }
        this.clearSession({ nextState: 'unpaired', lastError: null });
      };

      try {
        const response = await this.authenticatedFetch('/api/v1/device/unpair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        const payload = await response.json().catch(() => ({}));

        if (response.ok && payload.success) {
          cleanupLocalState();
          return {
            success: true,
            unpaired: true,
            alreadyUnpaired: Boolean(payload.alreadyUnpaired),
            remoteRevocationPending: false,
            unpairedAt: payload.unpairedAt || new Date().toISOString(),
          };
        }

        const code = payload.code || '';
        if (code === 'DEVICE_REVOKED' || code === 'DEVICE_NOT_FOUND' || code === 'DEVICE_NOT_PAIRED') {
          cleanupLocalState();
          return {
            success: true,
            unpaired: true,
            alreadyUnpaired: true,
            remoteRevocationPending: false,
          };
        }

        const errMsg = payload.error || payload.message || `Unpair failed with HTTP ${response.status}`;
        return {
          success: false,
          unpaired: false,
          remoteRevocationPending: response.status >= 500,
          retryable: response.status >= 500,
          code: code || 'DEVICE_UNPAIR_FAILED',
          error: errMsg,
        };
      } catch (err) {
        const code = err?.code || '';
        if (code === 'DEVICE_REVOKED' || code === 'DEVICE_NOT_FOUND' || code === 'DEVICE_NOT_PAIRED') {
          cleanupLocalState();
          return {
            success: true,
            unpaired: true,
            alreadyUnpaired: true,
            remoteRevocationPending: false,
          };
        }

        // Network outage / backend unreachable: do NOT clear DPAPI creds or claim remote unpair
        return {
          success: false,
          unpaired: false,
          remoteRevocationPending: true,
          retryable: true,
          code: code || 'REMOTE_REVOCATION_PENDING',
          error: `Backend unreachable; remote revocation is still pending. (${err.message})`,
        };
      }
    })();

    try {
      return await this._unpairPromise;
    } finally {
      this._unpairPromise = null;
    }
  }
}

module.exports = {
  DeviceAuthClient,
  DEFAULT_BACKEND_URL,
  REFRESH_LEEWAY_MS,
};
