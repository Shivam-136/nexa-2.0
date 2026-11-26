/**
 * NEXA 2.0 Desktop Agent - Ephemeral Disaster Recovery Client
 * Phase 6 — Milestone 3.3 Domain 1: RAT Retry & PoP Verification
 *
 * Implements ephemeral Ed25519 keypair generation, OS-backed DPAPI storage
 * at recovery.enc, and canonical Ed25519 PoP signature computation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const electron = require('electron');

const RECOVERY_FILE_NAME = 'recovery.enc';
const RECOVERY_FORMAT_HEADER = 'nexa-recovery-key';
const RECOVERY_VERSION = 1;

class RecoveryClient {
  /**
   * @param {Object} [options]
   * @param {Object} [options.appInstance]
   * @param {Object} [options.safeStorageInstance]
   * @param {string} [options.storageDir]
   * @param {string} [options.recoveryFileName = 'recovery.enc']
   */
  constructor(options = {}) {
    this._app = options.appInstance || (typeof electron === 'object' && electron ? electron.app : null);
    this._safeStorage = options.safeStorageInstance || (typeof electron === 'object' && electron ? electron.safeStorage : null);
    this._customStorageDir = options.storageDir || null;
    this._recoveryFileName = options.recoveryFileName || RECOVERY_FILE_NAME;
  }

  /**
   * Resolves storage directory for recovery key file.
   */
  getStorageDir() {
    if (this._customStorageDir) {
      return this._customStorageDir;
    }
    if (this._app && typeof this._app.getPath === 'function') {
      try {
        return this._app.getPath('userData');
      } catch (_) {}
    }
    return path.join(process.cwd(), '.nexa-data');
  }

  getRecoveryFilePath() {
    return path.join(this.getStorageDir(), this._recoveryFileName);
  }

  isEncryptionAvailable() {
    if (!this._safeStorage) return false;
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
   * Generates a fresh ephemeral Ed25519 keypair for recovery authorization.
   * @returns {{ publicKeyDER: Buffer, privateKeyDER: Buffer }}
   */
  generateRecoveryKeypair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const publicKeyDER = publicKey.export({ type: 'spki', format: 'der' });
    const privateKeyDER = privateKey.export({ type: 'pkcs8', format: 'der' });
    return { publicKeyDER, privateKeyDER };
  }

  /**
   * Encrypts and persists ephemeral recovery private key using DPAPI/safeStorage.
   * @param {Buffer} privateKeyDER
   */
  saveRecoveryPrivateKey(privateKeyDER) {
    if (!Buffer.isBuffer(privateKeyDER)) {
      throw new TypeError('privateKeyDER must be a Buffer');
    }

    if (!this.isEncryptionAvailable()) {
      throw new Error('NEXA_ERR_ENCRYPTION_UNAVAILABLE: OS safeStorage is required for recovery key persistence');
    }

    const encryptedBuffer = this._safeStorage.encryptString(privateKeyDER.toString('base64'));

    const envelope = {
      format: RECOVERY_FORMAT_HEADER,
      version: RECOVERY_VERSION,
      createdAt: new Date().toISOString(),
      ciphertext: encryptedBuffer.toString('base64'),
    };

    const storageDir = this.getStorageDir();
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true, mode: 0o700 });
    }

    const filePath = this.getRecoveryFilePath();
    const tempPath = `${filePath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;

    try {
      fs.writeFileSync(tempPath, JSON.stringify(envelope, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, filePath);
    } catch (err) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_) {}
      throw new Error(`Failed to atomically save recovery key: ${err.message}`);
    }
  }

  /**
   * Decrypts and retrieves stored recovery private key.
   * @returns {crypto.KeyObject|null}
   */
  loadRecoveryPrivateKey() {
    const filePath = this.getRecoveryFilePath();
    if (!fs.existsSync(filePath)) {
      return null;
    }

    let raw;
    try {
      raw = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      console.error('[NEXA RecoveryClient] Failed to read recovery file:', err.message);
      return null;
    }

    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch (_) {
      return null;
    }

    if (!envelope || envelope.format !== RECOVERY_FORMAT_HEADER || typeof envelope.ciphertext !== 'string') {
      return null;
    }

    if (!this.isEncryptionAvailable()) {
      throw new Error('NEXA_ERR_ENCRYPTION_UNAVAILABLE: safeStorage unavailable');
    }

    try {
      const encryptedBuffer = Buffer.from(envelope.ciphertext, 'base64');
      const decryptedBase64 = this._safeStorage.decryptString(encryptedBuffer);
      const privateKeyDER = Buffer.from(decryptedBase64, 'base64');

      return crypto.createPrivateKey({
        key: privateKeyDER,
        format: 'der',
        type: 'pkcs8',
      });
    } catch (err) {
      console.error('[NEXA RecoveryClient] Decryption failed for recovery key:', err.message);
      return null;
    }
  }

  /**
   * Computes the canonical Ed25519 PoP signature for a RAT retry request.
   * Format: NEXA-RAT-POP-v1|ratId|deviceGeneration|action|nonce|timestamp
   */
  createRetryPoPSignature({
    ratId,
    deviceGeneration,
    nonce,
    timestamp,
    privateKey,
  }) {
    if (!ratId || !deviceGeneration || !nonce || !timestamp) {
      throw new Error('Missing required fields for retry PoP signature');
    }

    const privKey = privateKey || this.loadRecoveryPrivateKey();
    if (!privKey) {
      throw new Error('No recovery private key available to sign retry payload');
    }

    const canonicalPayload = Buffer.from(
      [
        'NEXA-RAT-POP-v1',
        ratId,
        deviceGeneration.toString(),
        'RECOVER_RETRY',
        nonce,
        timestamp.toString(),
      ].join('|'),
      'utf8'
    );

    const signature = crypto.sign(null, canonicalPayload, privKey);
    return signature.toString('base64');
  }

  /**
   * Cryptographically zeroes and removes recovery key file from disk.
   */
  clearRecoveryKey() {
    const filePath = this.getRecoveryFilePath();
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > 0) {
          const zeroBuffer = crypto.randomBytes(stats.size);
          fs.writeFileSync(filePath, zeroBuffer);
        }
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn('[NEXA RecoveryClient] Error clearing recovery key:', err.message);
    }
  }
}

module.exports = {
  RecoveryClient,
  RECOVERY_FILE_NAME,
  RECOVERY_FORMAT_HEADER,
  RECOVERY_VERSION,
};
