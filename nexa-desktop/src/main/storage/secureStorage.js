/**
 * NEXA 2.0 Desktop Agent - Secure Storage Service
 * Phase 6 — Milestone 3.2: Secure Device Storage
 *
 * Implements hardware/OS-backed encrypted credential storage using
 * Electron safeStorage and Windows DPAPI.
 *
 * Security Principles:
 * - Encryption/decryption executes strictly in the Main Process.
 * - Raw device tokens are NEVER persisted as plaintext to disk.
 * - Atomic file writes (write-to-tmp then atomic rename) prevent partial writes.
 * - Strict fail-closed policy: unencrypted plaintext fallback is strictly forbidden.
 * - Corrupted vaults are safely quarantined without leaking secrets.
 * - Sensitive in-memory credentials are zeroed/cleared on shutdown.
 */

const fs = require('fs');
const path = require('path');
const electron = require('electron');
const { validateCredentialPayload, redactDeviceCredentials } = require('./storageSchema');

const VAULT_FILE_NAME = 'secure-vault.json';
const VAULT_FORMAT_HEADER = 'nexa-secure-vault';
const VAULT_VERSION = 1;

class SecureStorageService {
  /**
   * @param {Object} [options]
   * @param {Object} [options.appInstance] - Electron app instance or mock
   * @param {Object} [options.safeStorageInstance] - Electron safeStorage instance or mock
   * @param {string} [options.storageDir] - Custom directory for vault storage
   * @param {string} [options.vaultFileName = 'secure-vault.json']
   */
  constructor(options = {}) {
    this._app = options.appInstance || (typeof electron === 'object' && electron ? electron.app : null);
    this._safeStorage = options.safeStorageInstance || (typeof electron === 'object' && electron ? electron.safeStorage : null);
    this._customStorageDir = options.storageDir || null;
    this._vaultFileName = options.vaultFileName || VAULT_FILE_NAME;
    this._memoryCache = null;
    this._initialized = false;
  }

  /**
   * Resolves the storage directory for the vault file.
   * @returns {string}
   */
  getStorageDir() {
    if (this._customStorageDir) {
      return this._customStorageDir;
    }
    if (this._app && typeof this._app.getPath === 'function') {
      try {
        return this._app.getPath('userData');
      } catch (_) {
        // Fallback if called before app paths are ready
      }
    }
    return path.join(process.cwd(), '.nexa-data');
  }

  /**
   * Resolves the absolute path to the encrypted vault file.
   * @returns {string}
   */
  getVaultPath() {
    return path.join(this.getStorageDir(), this._vaultFileName);
  }

  /**
   * Checks whether OS-backed encryption (Windows DPAPI) is available.
   * @returns {boolean}
   */
  isEncryptionAvailable() {
    if (!this._safeStorage) {
      return false;
    }
    try {
      if (typeof this._safeStorage.isEncryptionAvailable === 'function') {
        return Boolean(this._safeStorage.isEncryptionAvailable());
      }
      return false;
    } catch (_) {
      return false;
    }
  }

  /**
   * Initializes the secure storage service.
   * Must be called during or after app.whenReady().
   * Reads existing vault if present or isolates corrupted vault.
   * @returns {boolean} Whether storage is ready and operational
   */
  init() {
    const encAvailable = this.isEncryptionAvailable();
    if (!encAvailable) {
      console.warn('[NEXA SecureStorage] WARNING: OS safeStorage encryption is currently unavailable.');
    }

    try {
      // Attempt to load existing credentials into memory
      this.getCredentials();
      this._initialized = true;
      return true;
    } catch (err) {
      console.error('[NEXA SecureStorage] Initialization error loading vault:', err.message);
      this._initialized = true;
      return false;
    }
  }

  /**
   * Returns high-level security status of the storage service.
   * @returns {{ encryptionAvailable: boolean, hasVault: boolean, isPaired: boolean }}
   */
  getStatus() {
    const vaultPath = this.getVaultPath();
    const hasVault = fs.existsSync(vaultPath);
    const isPaired = Boolean(this.getCredentials());

    return {
      encryptionAvailable: this.isEncryptionAvailable(),
      hasVault,
      isPaired,
    };
  }

  /**
   * Checks if valid device credentials currently exist.
   * @returns {boolean}
   */
  hasCredentials() {
    return Boolean(this.getCredentials());
  }

  /**
   * Retrieves sanitized, public device metadata.
   * GUARANTEE: deviceToken is strictly redacted and NEVER returned.
   * @returns {{ isPaired: boolean, deviceId: string|null, deviceName: string|null, userId: string|null, backendUrl: string|null, pairedAt: string|null }}
   */
  getDeviceInfo() {
    const credentials = this.getCredentials();
    return redactDeviceCredentials(credentials);
  }

  /**
   * Internal Main Process method: retrieves full credentials including raw deviceToken.
   * Strictly for internal daemon/WebSocket/networking usage.
   * NEVER expose this method to the renderer process via IPC.
   * @returns {Object|null} Full credentials object or null
   */
  getCredentials() {
    // 1. Return from in-memory cache if available
    if (this._memoryCache) {
      return { ...this._memoryCache };
    }

    const vaultPath = this.getVaultPath();
    if (!fs.existsSync(vaultPath)) {
      return null;
    }

    // 2. Read encrypted envelope from disk
    let rawEnvelope;
    try {
      rawEnvelope = fs.readFileSync(vaultPath, 'utf8');
    } catch (readErr) {
      console.error('[NEXA SecureStorage] Failed to read vault file:', readErr.message);
      return null;
    }

    let envelope;
    try {
      envelope = JSON.parse(rawEnvelope);
    } catch (_) {
      this._quarantineCorruptedVault(vaultPath, 'Invalid envelope JSON');
      return null;
    }

    if (!envelope || envelope.format !== VAULT_FORMAT_HEADER || typeof envelope.ciphertext !== 'string') {
      this._quarantineCorruptedVault(vaultPath, 'Malformed vault envelope format');
      return null;
    }

    // 3. Decrypt ciphertext using safeStorage (Windows DPAPI)
    if (!this.isEncryptionAvailable()) {
      console.error('[NEXA SecureStorage] Cannot decrypt vault: safeStorage encryption is unavailable.');
      return null;
    }

    try {
      const encryptedBuffer = Buffer.from(envelope.ciphertext, 'base64');
      const decryptedJson = this._safeStorage.decryptString(encryptedBuffer);
      const parsedData = JSON.parse(decryptedJson);

      const validated = validateCredentialPayload(parsedData);
      this._memoryCache = { ...validated };
      return { ...this._memoryCache };
    } catch (decryptErr) {
      console.error('[NEXA SecureStorage] Cryptographic decryption failed:', decryptErr.message);
      this._quarantineCorruptedVault(vaultPath, 'Decryption failure / key mismatch');
      return null;
    }
  }

  /**
   * Encrypts and atomically persists device credentials to disk.
   * Internal Main Process method: strictly for Main Process / PairingService usage.
   * NEVER expose this method to IPC or the renderer process.
   * @param {Object} rawPayload - Device credential payload
   * @param {Object} [options]
   * @param {boolean} [options.allowOverwrite = false] - Explicit authorization required to overwrite existing vault
   * @returns {{ success: boolean, error?: string }}
   */
  saveCredentials(rawPayload, { allowOverwrite = false } = {}) {
    // 1. Fail closed if encryption is unavailable - NEVER fallback to plaintext
    if (!this.isEncryptionAvailable()) {
      const errMsg = 'NEXA_ERR_ENCRYPTION_UNAVAILABLE: OS credential encryption (safeStorage/DPAPI) is unavailable. Plaintext storage is prohibited.';
      console.error(`[NEXA SecureStorage] ${errMsg}`);
      throw new Error(errMsg);
    }

    // 2. Prevent silent overwrite of active credentials without explicit authorization
    if (this.hasCredentials() && !allowOverwrite) {
      const errMsg = 'NEXA_ERR_VAULT_ALREADY_EXISTS: Cannot overwrite active credentials without explicit authorization.';
      console.error(`[NEXA SecureStorage] ${errMsg}`);
      throw new Error(errMsg);
    }

    // 3. Validate and sanitize input schema
    const validated = validateCredentialPayload(rawPayload);

    // 3. Encrypt payload with safeStorage
    const jsonString = JSON.stringify(validated);
    let encryptedBuffer;
    try {
      encryptedBuffer = this._safeStorage.encryptString(jsonString);
    } catch (encErr) {
      console.error('[NEXA SecureStorage] safeStorage.encryptString failed:', encErr.message);
      throw new Error(`Encryption failed: ${encErr.message}`);
    }

    // 4. Construct encrypted envelope
    const envelope = {
      format: VAULT_FORMAT_HEADER,
      version: VAULT_VERSION,
      updatedAt: new Date().toISOString(),
      ciphertext: encryptedBuffer.toString('base64'),
    };

    // 5. Atomic write to disk (write to tmp then atomic rename)
    const storageDir = this.getStorageDir();
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });
    }

    const vaultPath = this.getVaultPath();
    const tempPath = `${vaultPath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;

    try {
      fs.writeFileSync(tempPath, JSON.stringify(envelope, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, vaultPath);
    } catch (ioErr) {
      // Clean up orphaned temp file if write/rename failed
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_) {}
      console.error('[NEXA SecureStorage] Atomic vault write failed:', ioErr.message);
      throw new Error(`Storage write failed: ${ioErr.message}`);
    }

    // 6. Update in-memory cache
    this._memoryCache = { ...validated };
    return { success: true };
  }

  /**
   * Internal Main Process method: Securely clears all stored credentials from memory and disk.
   * Strictly for internal Main Process / authorized unpair operations.
   * NEVER expose this method to IPC or the renderer process.
   * @returns {{ success: boolean }}
   */
  clearCredentials() {
    // 1. Clear memory cache
    this._memoryCache = null;

    // 2. Remove vault file if present
    const vaultPath = this.getVaultPath();
    try {
      if (fs.existsSync(vaultPath)) {
        fs.unlinkSync(vaultPath);
      }
    } catch (unlinkErr) {
      console.warn('[NEXA SecureStorage] Error deleting vault file:', unlinkErr.message);
    }

    return { success: true };
  }

  /**
   * Quarantines a corrupted or tampered vault file without crashing.
   * @private
   * @param {string} vaultPath
   * @param {string} reason
   */
  _quarantineCorruptedVault(vaultPath, reason) {
    this._memoryCache = null;
    try {
      if (fs.existsSync(vaultPath)) {
        const quarantinePath = `${vaultPath}.corrupt.${Date.now()}`;
        fs.renameSync(vaultPath, quarantinePath);
        console.warn(`[NEXA SecureStorage] Corrupted vault quarantined to ${path.basename(quarantinePath)} (Reason: ${reason})`);
      }
    } catch (qErr) {
      console.error('[NEXA SecureStorage] Failed to quarantine corrupted vault:', qErr.message);
    }
  }

  /**
   * Purges sensitive in-memory credentials during application shutdown.
   */
  clearMemoryCache() {
    this._memoryCache = null;
  }
}

module.exports = {
  SecureStorageService,
  VAULT_FILE_NAME,
  VAULT_FORMAT_HEADER,
  VAULT_VERSION,
};
