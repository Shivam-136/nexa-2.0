/**
 * NEXA 2.0 Desktop Agent - Authenticated Heartbeat Client (Main Process Only)
 * Phase 6 — Milestone 3.4.3: Device Heartbeat & Connection State Management
 *
 * Security Invariants:
 * - Executes strictly in Electron Main Process.
 * - Reuses DeviceAuthClient for authenticated requests & refresh-token rotation.
 * - NEVER exposes accessToken, refreshToken, or deviceToken to renderer or IPC.
 * - Stops permanently on DEVICE_REVOKED or DEVICE_QUARANTINED.
 * - Prevents overlapping heartbeat requests via single-flight deduplication.
 */

const CONNECTION_STATES = Object.freeze({
  CONNECTING: 'CONNECTING',
  ONLINE: 'ONLINE',
  OFFLINE: 'OFFLINE',
  RECONNECTING: 'RECONNECTING',
  AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED',
  REVOKED: 'REVOKED',
  ERROR: 'ERROR',
});

const DEFAULT_HEARTBEAT_INTERVAL_MS = Number(process.env.NEXA_HEARTBEAT_INTERVAL_MS) || 30000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = Number(process.env.NEXA_HEARTBEAT_TIMEOUT_MS) || 10000;
const DEFAULT_INITIAL_RECONNECT_DELAY_MS = Number(process.env.NEXA_HEARTBEAT_RECONNECT_MS) || 1000;
const DEFAULT_BACKOFF_MULTIPLIER = 2;
const DEFAULT_MAX_RECONNECT_DELAY_MS = Number(process.env.NEXA_HEARTBEAT_MAX_RECONNECT_MS) || 60000;
const DEFAULT_JITTER_FACTOR = 0.2;

function sanitizeErrorMessage(rawMessage) {
  if (!rawMessage || typeof rawMessage !== 'string') {
    return 'Heartbeat failed';
  }
  return rawMessage
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer [REDACTED]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED_JWT]')
    .slice(0, 300);
}

class HeartbeatClient {
  /**
   * @param {Object} options
   * @param {Object} options.deviceAuthClient - DeviceAuthClient instance
   * @param {number} [options.intervalMs] - Heartbeat interval in ms
   * @param {number} [options.timeoutMs] - Request timeout in ms
   * @param {number} [options.reconnectDelayMs] - Base reconnect delay in ms
   * @param {Function} [options.onStateChange] - Callback invoked with sanitized connection status
   * @param {Function} [options.getMetadata] - Optional function returning sanitized telemetry metadata
   */
  constructor({
    deviceAuthClient,
    intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    timeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
    reconnectDelayMs = null,
    initialReconnectDelayMs = null,
    backoffMultiplier = DEFAULT_BACKOFF_MULTIPLIER,
    maxReconnectDelayMs = DEFAULT_MAX_RECONNECT_DELAY_MS,
    jitterFactor = DEFAULT_JITTER_FACTOR,
    randomFn = Math.random,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    onStateChange = null,
    getMetadata = null,
  } = {}) {
    if (!deviceAuthClient || typeof deviceAuthClient.authenticatedFetch !== 'function') {
      throw new Error('HeartbeatClient requires a valid DeviceAuthClient instance');
    }

    this._deviceAuthClient = deviceAuthClient;
    this._intervalMs = Math.max(50, Number(intervalMs) || DEFAULT_HEARTBEAT_INTERVAL_MS);
    this._timeoutMs = Math.max(20, Number(timeoutMs) || DEFAULT_HEARTBEAT_TIMEOUT_MS);
    const baseDelay = initialReconnectDelayMs ?? reconnectDelayMs ?? DEFAULT_INITIAL_RECONNECT_DELAY_MS;
    this._initialReconnectDelayMs = Math.max(10, Number(baseDelay) || DEFAULT_INITIAL_RECONNECT_DELAY_MS);
    this._backoffMultiplier = Math.max(1, Number(backoffMultiplier) || DEFAULT_BACKOFF_MULTIPLIER);
    this._maxReconnectDelayMs = Math.max(
      this._initialReconnectDelayMs,
      Number(maxReconnectDelayMs) || DEFAULT_MAX_RECONNECT_DELAY_MS
    );
    this._jitterFactor = Math.min(1, Math.max(0, Number(jitterFactor ?? DEFAULT_JITTER_FACTOR)));
    this._randomFn = typeof randomFn === 'function' ? randomFn : Math.random;
    this._setTimeout = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout;
    this._clearTimeout = typeof clearTimeoutFn === 'function' ? clearTimeoutFn : clearTimeout;
    this._onStateChange = typeof onStateChange === 'function' ? onStateChange : () => {};
    this._getMetadata = typeof getMetadata === 'function' ? getMetadata : () => ({});

    this._state = CONNECTION_STATES.OFFLINE;
    this._lastSuccessfulHeartbeatAt = null;
    this._lastAttemptAt = null;
    this._lastError = null;
    this._consecutiveFailures = 0;
    this._heartbeatCount = 0;
    this._nextRetryDelayMs = null;

    this._running = false;
    this._permanentlyStopped = false;
    this._timer = null;
    this._inFlightPromise = null;
    this._activeAbortController = null;
  }

  _emitState() {
    try {
      this._onStateChange(this.getStatus());
    } catch (_) {
      // Ignore listener errors
    }
  }

  _transitionTo(nextState, errorMessage = null) {
    const sanitizedErr = errorMessage ? sanitizeErrorMessage(errorMessage) : null;
    const changed = this._state !== nextState || this._lastError !== sanitizedErr;
    this._state = nextState;
    this._lastError = sanitizedErr;
    if (changed) {
      this._emitState();
    }
  }

  /**
   * Returns strictly sanitized connection & heartbeat metadata.
   * GUARANTEE: Never includes tokens or secrets.
   */
  getStatus() {
    const authStatus = typeof this._deviceAuthClient.getAuthStatus === 'function'
      ? this._deviceAuthClient.getAuthStatus()
      : {};

    return {
      state: this._state,
      isOnline: this._state === CONNECTION_STATES.ONLINE,
      isRunning: this._running,
      permanentlyStopped: this._permanentlyStopped,
      isPaired: Boolean(authStatus.isPaired),
      deviceId: authStatus.deviceId || null,
      deviceGeneration: authStatus.deviceGeneration || null,
      lastSuccessfulHeartbeatAt: this._lastSuccessfulHeartbeatAt,
      lastAttemptAt: this._lastAttemptAt,
      heartbeatCount: this._heartbeatCount,
      consecutiveFailures: this._consecutiveFailures,
      intervalMs: this._intervalMs,
      nextRetryDelayMs: this._nextRetryDelayMs,
      lastError: this._lastError,
    };
  }

  /**
   * Computes bounded exponential backoff delay with randomized jitter.
   * @param {number} failureCount - 1-based consecutive failure count
   * @returns {number} Delay in milliseconds
   */
  calculateBackoffDelay(failureCount) {
    const attempt = Math.max(1, Number(failureCount) || 1);
    const rawExponential = this._initialReconnectDelayMs * Math.pow(this._backoffMultiplier, attempt - 1);
    const capped = Math.min(rawExponential, this._maxReconnectDelayMs);
    if (this._jitterFactor <= 0) {
      return Math.floor(capped);
    }
    const jitterSpan = capped * this._jitterFactor;
    const rand = Math.min(1, Math.max(0, Number(this._randomFn())));
    const offset = (rand * 2 - 1) * jitterSpan;
    return Math.max(10, Math.min(this._maxReconnectDelayMs, Math.floor(capped + offset)));
  }

  /**
   * Resets permanent stop flag (e.g. only after explicit re-pairing).
   */
  reset() {
    this.stop();
    this._permanentlyStopped = false;
    this._consecutiveFailures = 0;
    this._lastError = null;
    this._transitionTo(CONNECTION_STATES.OFFLINE, null);
  }

  /**
   * Starts the periodic heartbeat loop after authentication.
   * Returns false if permanently stopped (revoked/quarantined).
   */
  start() {
    if (this._permanentlyStopped) {
      return false;
    }
    if (this._running) {
      return true;
    }

    this._running = true;
    if (this._state !== CONNECTION_STATES.ONLINE) {
      this._transitionTo(CONNECTION_STATES.CONNECTING, null);
    }

    // Trigger immediate heartbeat; next cycle is scheduled upon completion
    this.sendHeartbeat().catch(() => {});
    return true;
  }

  /**
   * Stops the heartbeat loop and aborts any in-flight request (e.g. on shutdown).
   */
  stop({ nextState = null } = {}) {
    this._running = false;
    this._nextRetryDelayMs = null;
    if (this._timer) {
      this._clearTimeout(this._timer);
      this._timer = null;
    }
    if (this._activeAbortController) {
      try {
        this._activeAbortController.abort(new Error('HEARTBEAT_STOPPED'));
      } catch (_) {
        // Ignore abort errors
      }
      this._activeAbortController = null;
    }
    if (nextState) {
      this._transitionTo(nextState, this._lastError);
    }
  }

  _scheduleNext() {
    if (!this._running || this._permanentlyStopped) {
      return;
    }
    if (this._timer) {
      this._clearTimeout(this._timer);
      this._timer = null;
    }

    const isRecovering =
      this._state === CONNECTION_STATES.RECONNECTING ||
      this._state === CONNECTION_STATES.OFFLINE;

    const delay = isRecovering
      ? this.calculateBackoffDelay(this._consecutiveFailures)
      : this._intervalMs;

    this._nextRetryDelayMs = isRecovering ? delay : null;

    this._timer = this._setTimeout(() => {
      this._timer = null;
      if (this._running && !this._permanentlyStopped) {
        this.sendHeartbeat().catch(() => {});
      }
    }, Math.floor(delay));
  }

  /**
   * Sends a single authenticated heartbeat with overlap prevention.
   * @returns {Promise<Object>} Sanitized heartbeat status
   */
  async sendHeartbeat() {
    if (this._permanentlyStopped) {
      return this.getStatus();
    }

    // Prevent overlapping heartbeat requests
    if (this._inFlightPromise) {
      return await this._inFlightPromise;
    }

    this._inFlightPromise = (async () => {
      this._lastAttemptAt = new Date().toISOString();
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      this._activeAbortController = controller;

      let timeoutHandle = null;
      let timedOut = false;

      if (controller) {
        timeoutHandle = setTimeout(() => {
          timedOut = true;
          try {
            controller.abort(new Error('HEARTBEAT_TIMEOUT'));
          } catch (_) {
            // Ignore
          }
        }, this._timeoutMs);
      }

      try {
        const meta = this._getMetadata() || {};
        const bodyPayload = {
          agentVersion: typeof meta.agentVersion === 'string' ? meta.agentVersion : '2.0.0',
          platform: typeof meta.platform === 'string' ? meta.platform : process.platform,
          arch: typeof meta.arch === 'string' ? meta.arch : process.arch,
          uptimeSeconds: typeof meta.uptimeSeconds === 'number'
            ? meta.uptimeSeconds
            : Math.floor(process.uptime()),
        };

        const response = await this._deviceAuthClient.authenticatedFetch('/api/v1/device/heartbeat', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
          ...(controller ? { signal: controller.signal } : {}),
        });

        const payload = await response.json().catch(() => ({}));

        if (!response.ok || !payload.success) {
          const code = payload.code || '';
          const errMsg = payload.error || payload.message || `Heartbeat rejected with HTTP ${response.status}`;

          if (code === 'DEVICE_REVOKED' || code === 'DEVICE_QUARANTINED') {
            this._consecutiveFailures += 1;
            this._permanentlyStopped = true;
            if (typeof this._deviceAuthClient.clearSession === 'function') {
              this._deviceAuthClient.clearSession({ nextState: 'revoked', lastError: sanitizeErrorMessage(errMsg) });
            }
            this._transitionTo(CONNECTION_STATES.REVOKED, errMsg);
            this.stop();
            return this.getStatus();
          }

          if (
            response.status === 401 ||
            code === 'DEVICE_AUTH_REQUIRED' ||
            code === 'DEVICE_NOT_PAIRED' ||
            code === 'DEVICE_TOKEN_EXPIRED' ||
            code === 'DEVICE_REFRESH_TOKEN_EXPIRED' ||
            code === 'INVALID_DEVICE_REFRESH_TOKEN' ||
            code === 'DEVICE_TOKEN_REUSE_DETECTED' ||
            code === 'DEVICE_GENERATION_MISMATCH' ||
            code === 'DEVICE_NOT_FOUND' ||
            code === 'DEVICE_OWNER_NOT_FOUND'
          ) {
            this._consecutiveFailures += 1;
            this._transitionTo(CONNECTION_STATES.AUTHENTICATION_REQUIRED, errMsg);
            this.stop();
            return this.getStatus();
          }

          if (response.status >= 500) {
            this._consecutiveFailures += 1;
            this._transitionTo(CONNECTION_STATES.RECONNECTING, errMsg);
            return this.getStatus();
          }

          this._consecutiveFailures += 1;
          this._transitionTo(CONNECTION_STATES.ERROR, errMsg);
          return this.getStatus();
        }

        // Success: ONLINE only after successful authenticated heartbeat; reset backoff
        this._consecutiveFailures = 0;
        this._nextRetryDelayMs = null;
        this._heartbeatCount = Number(payload.heartbeatCount) || (this._heartbeatCount + 1);
        this._lastSuccessfulHeartbeatAt = payload.lastHeartbeatAt || payload.lastSeenAt || new Date().toISOString();
        this._state = CONNECTION_STATES.ONLINE;
        this._lastError = null;
        this._emitState();

        return this.getStatus();
      } catch (err) {
        const code = err?.code || '';
        const msg = err?.message || 'Network error during heartbeat';

        // Revoked / quarantined thrown from DeviceAuthClient.authenticate()/refreshSession()
        if (code === 'DEVICE_REVOKED' || code === 'DEVICE_QUARANTINED') {
          this._consecutiveFailures += 1;
          this._permanentlyStopped = true;
          this._transitionTo(CONNECTION_STATES.REVOKED, msg);
          this.stop();
          return this.getStatus();
        }

        // Auth-required errors thrown from DeviceAuthClient
        if (
          code === 'DEVICE_NOT_PAIRED' ||
          code === 'DEVICE_AUTH_REQUIRED' ||
          code === 'DEVICE_REFRESH_TOKEN_EXPIRED' ||
          code === 'INVALID_DEVICE_REFRESH_TOKEN' ||
          code === 'DEVICE_TOKEN_REUSE_DETECTED' ||
          code === 'DEVICE_GENERATION_MISMATCH' ||
          code === 'DEVICE_NOT_FOUND' ||
          code === 'DEVICE_OWNER_NOT_FOUND' ||
          code === 'INVALID_DEVICE_CREDENTIALS' ||
          String(msg).startsWith('DEVICE_NOT_PAIRED')
        ) {
          this._consecutiveFailures += 1;
          this._transitionTo(CONNECTION_STATES.AUTHENTICATION_REQUIRED, msg);
          this.stop();
          return this.getStatus();
        }

        // Intentional stop during shutdown
        if (!this._running && !timedOut && (err?.name === 'AbortError' || msg === 'HEARTBEAT_STOPPED')) {
          return this.getStatus();
        }

        // Timeout -> OFFLINE
        if (timedOut || err?.name === 'AbortError' || code === 'ETIMEDOUT' || msg === 'HEARTBEAT_TIMEOUT') {
          this._consecutiveFailures += 1;
          this._transitionTo(CONNECTION_STATES.OFFLINE, 'Heartbeat request timed out');
          return this.getStatus();
        }

        // Non-5xx HTTP error thrown from DeviceAuthClient
        if (err?.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
          this._consecutiveFailures += 1;
          this._transitionTo(CONNECTION_STATES.ERROR, msg);
          return this.getStatus();
        }

        // Network failure or 5xx -> RECONNECTING
        this._consecutiveFailures += 1;
        this._transitionTo(CONNECTION_STATES.RECONNECTING, msg);
        return this.getStatus();
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        this._activeAbortController = null;
        this._inFlightPromise = null;
        if (this._running && !this._permanentlyStopped) {
          this._scheduleNext();
        }
      }
    })();

    return await this._inFlightPromise;
  }
}

module.exports = {
  HeartbeatClient,
  CONNECTION_STATES,
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  DEFAULT_INITIAL_RECONNECT_DELAY_MS,
  DEFAULT_BACKOFF_MULTIPLIER,
  DEFAULT_MAX_RECONNECT_DELAY_MS,
  DEFAULT_JITTER_FACTOR,
  sanitizeErrorMessage,
};
