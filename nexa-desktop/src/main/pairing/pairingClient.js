/**
 * NEXA 2.0 Desktop Agent - Device Pairing Client (Main Process Only)
 * Phase 6 — Milestone 3.4.1: Device Pairing Initiation & Claim Lifecycle
 *
 * Security Invariants:
 * - Executes strictly in the Main Process.
 * - Fails closed if OS DPAPI/safeStorage encryption is unavailable.
 * - Stores issued deviceToken strictly in SecureStorageService (DPAPI).
 * - NEVER returns raw deviceToken to the renderer process.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const DEFAULT_BACKEND_URL = process.env.NEXA_BACKEND_URL || 'http://127.0.0.1:5000';
const DEVICE_IDENTITY_FILE = 'device-identity.json';
const PAIRING_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class PairingClient {
  /**
   * @param {Object} options
   * @param {Object} options.storageService - SecureStorageService instance
   * @param {Function} [options.fetchImpl] - Fetch implementation (injectable for tests)
   * @param {Function} [options.onStatusChange] - Callback invoked when pairing state changes
   */
  constructor({ storageService, fetchImpl = null, onStatusChange = null } = {}) {
    if (!storageService) {
      throw new Error('PairingClient requires a SecureStorageService instance');
    }
    this._storageService = storageService;
    this._fetch = fetchImpl || globalThis.fetch;
    this._onStatusChange = typeof onStatusChange === 'function' ? onStatusChange : () => {};
    this._state = storageService.hasCredentials() ? 'paired' : 'idle';
    this._lastError = null;
    this._inFlightController = null;
    this._cachedDeviceId = null;
  }

  /**
   * Validates and normalizes the backend base URL.
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
   * Validates and normalizes an 8-character pairing code into XXXX-XXXX format.
   * @param {string} rawCode
   * @returns {string}
   */
  normalizePairingCode(rawCode) {
    if (typeof rawCode !== 'string') {
      throw new Error('INVALID_PAIRING_CODE: Pairing code must be a string');
    }
    const cleaned = rawCode.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    if (cleaned.length !== 8) {
      throw new Error('INVALID_PAIRING_CODE: Pairing code must be 8 characters');
    }
    for (const ch of cleaned) {
      if (!PAIRING_CODE_ALPHABET.includes(ch)) {
        throw new Error('INVALID_PAIRING_CODE: Pairing code contains invalid characters');
      }
    }
    return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`;
  }

  /**
   * Returns a persistent non-secret device UUID for this installation.
   * @returns {string}
   */
  getOrCreateDeviceId() {
    if (this._cachedDeviceId) {
      return this._cachedDeviceId;
    }

    const existingInfo = this._storageService.getDeviceInfo();
    if (existingInfo && existingInfo.deviceId) {
      this._cachedDeviceId = existingInfo.deviceId;
      return this._cachedDeviceId;
    }

    const storageDir = typeof this._storageService.getStorageDir === 'function'
      ? this._storageService.getStorageDir()
      : null;

    if (storageDir) {
      const idPath = path.join(storageDir, DEVICE_IDENTITY_FILE);
      if (fs.existsSync(idPath)) {
        try {
          const parsed = JSON.parse(fs.readFileSync(idPath, 'utf8'));
          if (parsed && typeof parsed.deviceId === 'string' && parsed.deviceId.trim().length >= 8) {
            this._cachedDeviceId = parsed.deviceId.trim();
            return this._cachedDeviceId;
          }
        } catch (_) {
          // Regenerate if unreadable
        }
      }

      const newId = crypto.randomUUID();
      try {
        if (!fs.existsSync(storageDir)) {
          fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });
        }
        fs.writeFileSync(idPath, JSON.stringify({ deviceId: newId }, null, 2), { encoding: 'utf8', mode: 0o600 });
      } catch (_) {
        // Non-fatal if directory is read-only
      }
      this._cachedDeviceId = newId;
      return newId;
    }

    this._cachedDeviceId = crypto.randomUUID();
    return this._cachedDeviceId;
  }

  /**
   * Emits a sanitized pairing status update to listeners (no secrets).
   */
  _emitStatus() {
    try {
      this._onStatusChange(this.getStatus());
    } catch (_) {
      // Ignore listener errors
    }
  }

  /**
   * Returns sanitized pairing status and redacted device info.
   * NEVER exposes deviceToken.
   */
  getStatus() {
    const storageStatus = this._storageService.getStatus();
    const deviceInfo = this._storageService.getDeviceInfo();
    const effectiveState = deviceInfo.isPaired ? 'paired' : this._state;

    return {
      state: effectiveState,
      isPaired: Boolean(deviceInfo.isPaired),
      encryptionAvailable: Boolean(storageStatus.encryptionAvailable),
      deviceInfo,
      lastError: this._lastError,
    };
  }

  /**
   * Claims a pairing code with the backend and persists credentials in DPAPI storage.
   * @param {Object} params
   * @param {string} params.pairingCode
   * @param {string} [params.deviceName]
   * @param {string} [params.backendUrl]
   * @returns {Promise<{ success: boolean, status: string, deviceInfo: Object }>}
   */
  async claimPairing({ pairingCode, deviceName, backendUrl } = {}) {
    if (this._inFlightController) {
      throw new Error('PAIRING_ALREADY_IN_PROGRESS: A pairing claim is already in flight');
    }

    if (!this._storageService.isEncryptionAvailable()) {
      const msg = 'NEXA_ERR_ENCRYPTION_UNAVAILABLE: OS DPAPI encryption is required before pairing';
      this._state = 'error';
      this._lastError = msg;
      this._emitStatus();
      throw new Error(msg);
    }

    const normalizedCode = this.normalizePairingCode(pairingCode);
    const validatedBackendUrl = this.validateBackendUrl(backendUrl);
    const sanitizedName = (typeof deviceName === 'string' && deviceName.trim())
      ? deviceName.trim().slice(0, 100)
      : (os.hostname() || 'NEXA Desktop Agent').slice(0, 100);
    const deviceId = this.getOrCreateDeviceId();

    if (typeof this._fetch !== 'function') {
      throw new Error('FETCH_UNAVAILABLE: HTTP client is not available in Main Process');
    }

    const controller = new AbortController();
    this._inFlightController = controller;
    this._state = 'claiming';
    this._lastError = null;
    this._emitStatus();

    try {
      const response = await this._fetch(`${validatedBackendUrl}/api/v1/pairing/claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          pairingCode: normalizedCode,
          deviceId,
          deviceName: sanitizedName,
        }),
        signal: controller.signal,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.success) {
        const errMsg = payload.error || payload.message || `Pairing failed with HTTP ${response.status}`;
        this._state = 'error';
        this._lastError = errMsg;
        this._emitStatus();
        throw new Error(errMsg);
      }

      if (!payload.deviceToken || !payload.deviceId || !payload.userId) {
        const errMsg = 'INVALID_PAIRING_RESPONSE: Missing required device credentials from backend';
        this._state = 'error';
        this._lastError = errMsg;
        this._emitStatus();
        throw new Error(errMsg);
      }

      // Persist strictly in Main Process DPAPI secure storage; never return token to renderer
      this._storageService.saveCredentials(
        {
          deviceId: payload.deviceId,
          deviceName: payload.deviceName || sanitizedName,
          deviceToken: payload.deviceToken,
          userId: payload.userId,
          backendUrl: validatedBackendUrl,
          pairedAt: payload.pairedAt || new Date().toISOString(),
          deviceGeneration: Number.isInteger(payload.deviceGeneration) && payload.deviceGeneration >= 1
            ? payload.deviceGeneration
            : 1,
        },
        { allowOverwrite: true }
      );

      this._state = 'paired';
      this._lastError = null;
      this._emitStatus();

      return {
        success: true,
        status: 'paired',
        deviceInfo: this._storageService.getDeviceInfo(),
      };
    } catch (err) {
      if (err.name === 'AbortError') {
        this._state = this._storageService.hasCredentials() ? 'paired' : 'cancelled';
        this._lastError = null;
        this._emitStatus();
        throw new Error('PAIRING_CANCELLED: Pairing request was cancelled');
      }
      if (this._state !== 'error') {
        this._state = 'error';
        this._lastError = err.message;
        this._emitStatus();
      }
      throw err;
    } finally {
      this._inFlightController = null;
    }
  }

  /**
   * Cancels an in-flight pairing attempt or resets transient pairing state.
   */
  cancelPairing() {
    const hadInFlight = Boolean(this._inFlightController);
    if (this._inFlightController) {
      this._inFlightController.abort();
      this._inFlightController = null;
    }

    const isPaired = this._storageService.hasCredentials();
    this._state = isPaired ? 'paired' : (hadInFlight ? 'cancelled' : 'idle');
    this._lastError = null;
    this._emitStatus();

    return {
      success: true,
      cancelled: hadInFlight,
      status: this._state,
    };
  }
}

module.exports = {
  PairingClient,
  DEFAULT_BACKEND_URL,
};
