/**
 * NEXA 2.0 Desktop Agent - Quarantined Credential Staging & Delivery Fence Manager
 * Phase 6 — Milestone 3.3 Domain 2: Device Delivery Fence & Safe Credential Activation
 *
 * Implements quarantined staging in %LOCALAPPDATA%\NEXA\quarantine\<retrievalId>.enc,
 * high-resolution monotonic timer validation (hrtime), cryptographic wipe, and
 * safe promotion to active storage only after authoritative backend confirmation.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const electron = require('electron');

const QUARANTINE_DIR_NAME = 'quarantine';
const QUARANTINE_FORMAT_HEADER = 'nexa-quarantined-credentials';
const QUARANTINE_VERSION = 1;

class QuarantineManager {
  /**
   * @param {Object} [options]
   * @param {Object} [options.appInstance]
   * @param {Object} [options.safeStorageInstance]
   * @param {string} [options.storageDir]
   */
  constructor(options = {}) {
    this._app = options.appInstance || (typeof electron === 'object' && electron ? electron.app : null);
    this._safeStorage = options.safeStorageInstance || (typeof electron === 'object' && electron ? electron.safeStorage : null);
    this._customStorageDir = options.storageDir || null;
  }

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

  getQuarantineDir() {
    return path.join(this.getStorageDir(), QUARANTINE_DIR_NAME);
  }

  getQuarantineFilePath(clientRetrievalId) {
    const sanitizedId = clientRetrievalId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.getQuarantineDir(), `${sanitizedId}.enc`);
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
   * Stages an unconfirmed credential bundle in isolated, inactive quarantine storage.
   * Active credentials store (credentials.enc) is completely UNTOUCHED.
   *
   * @param {string} clientRetrievalId
   * @param {Object} bundlePayload
   * @returns {{ success: boolean, quarantinePath: string }}
   */
  stageCredentialBundle(clientRetrievalId, bundlePayload) {
    if (!this.isEncryptionAvailable()) {
      throw new Error('NEXA_ERR_ENCRYPTION_UNAVAILABLE: OS safeStorage/DPAPI is required to stage credentials');
    }

    const quarantineDir = this.getQuarantineDir();
    if (!fs.existsSync(quarantineDir)) {
      fs.mkdirSync(quarantineDir, { recursive: true, mode: 0o700 });
    }

    const encryptedBuffer = this._safeStorage.encryptString(JSON.stringify(bundlePayload));

    const envelope = {
      format: QUARANTINE_FORMAT_HEADER,
      version: QUARANTINE_VERSION,
      retrievalId: clientRetrievalId,
      stagedAt: new Date().toISOString(),
      ciphertext: encryptedBuffer.toString('base64'),
    };

    const targetPath = this.getQuarantineFilePath(clientRetrievalId);
    const tempPath = `${targetPath}.${Date.now()}.${Math.random().toString(36).substring(2, 8)}.tmp`;

    try {
      fs.writeFileSync(tempPath, JSON.stringify(envelope, null, 2), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tempPath, targetPath);
      return { success: true, quarantinePath: targetPath };
    } catch (err) {
      try {
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      } catch (_) {}
      throw new Error(`Failed to stage quarantined credential bundle: ${err.message}`);
    }
  }

  /**
   * Dual-Clock Validation using process.hrtime.bigint() and server clock skew.
   * Never relies solely on Date.now().
   *
   * @param {Object} params
   * @param {bigint} params.startHrTime - Monotonic start recorded upon response receipt
   * @param {string|Date} params.leaseExpiresAt - Authoritative lease expiration from backend
   * @param {number} [params.serverClockSkew = 0] - (serverTime - clientDateNow)
   * @param {number} [params.maxElapsedMs = 40000] - Strict monotonic timeout (default 40s)
   * @param {number} [params.safetyBufferMs = 5000] - Server lease margin (default 5s)
   */
  validateMonotonicTimerAndLease({
    startHrTime,
    leaseExpiresAt,
    serverClockSkew = 0,
    maxElapsedMs = 40000,
    safetyBufferMs = 5000,
  }) {
    if (typeof startHrTime !== 'bigint') {
      throw new Error('startHrTime must be a BigInt from process.hrtime.bigint()');
    }

    const elapsedNs = process.hrtime.bigint() - startHrTime;
    const elapsedMs = Number(elapsedNs / 1000000n);

    if (elapsedMs >= maxElapsedMs) {
      throw new Error(`LOCAL_LEASE_EXPIRATION_ABORT: Monotonic elapsed time (${elapsedMs}ms) exceeded limit (${maxElapsedMs}ms)`);
    }

    const estimatedServerNow = Date.now() + serverClockSkew;
    const expiryTime = typeof leaseExpiresAt === 'number' ? leaseExpiresAt : Date.parse(leaseExpiresAt);

    if (estimatedServerNow >= (expiryTime - safetyBufferMs)) {
      throw new Error(`LOCAL_LEASE_EXPIRATION_ABORT: Server lease expiring (estimated: ${estimatedServerNow}, boundary: ${expiryTime - safetyBufferMs})`);
    }

    return { isValid: true, elapsedMs };
  }

  /**
   * Promotes quarantined credentials to active store after receiving authoritative 200 OK.
   *
   * @param {string} clientRetrievalId
   * @param {Object} secureStorageService
   * @returns {{ success: boolean }}
   */
  promoteQuarantineToActive(clientRetrievalId, secureStorageService) {
    const filePath = this.getQuarantineFilePath(clientRetrievalId);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Quarantined file not found for retrievalId: ${clientRetrievalId}`);
    }

    let envelope;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      envelope = JSON.parse(raw);
    } catch (err) {
      this.purgeQuarantinedBundle(clientRetrievalId);
      throw new Error(`Failed to parse quarantined envelope: ${err.message}`);
    }

    if (!envelope || envelope.format !== QUARANTINE_FORMAT_HEADER || typeof envelope.ciphertext !== 'string') {
      this.purgeQuarantinedBundle(clientRetrievalId);
      throw new Error('Malformed quarantined envelope format');
    }

    let bundle;
    try {
      const encryptedBuffer = Buffer.from(envelope.ciphertext, 'base64');
      const decryptedString = this._safeStorage.decryptString(encryptedBuffer);
      bundle = JSON.parse(decryptedString);
    } catch (err) {
      this.purgeQuarantinedBundle(clientRetrievalId);
      throw new Error(`Decryption failed during quarantine promotion: ${err.message}`);
    }

    // Save into active credential store
    secureStorageService.saveCredentials(bundle, { allowOverwrite: true });

    // Instantly zero and unlink quarantined staging file
    this.purgeQuarantinedBundle(clientRetrievalId);

    return { success: true };
  }

  /**
   * Cryptographically zeroes and unlinks a quarantined credential bundle upon rejection or timeout.
   *
   * @param {string} clientRetrievalId
   */
  purgeQuarantinedBundle(clientRetrievalId) {
    const filePath = this.getQuarantineFilePath(clientRetrievalId);
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > 0) {
          const randomBytes = crypto.randomBytes(stats.size);
          fs.writeFileSync(filePath, randomBytes);
        }
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.warn(`[NEXA QuarantineManager] Error purging quarantined bundle: ${err.message}`);
    }
  }

  /**
   * Generates a canonical Ed25519 PoP signature for KEEPALIVE, ACK, or RELEASE.
   */
  createDeliveryFencePoPSignature({
    action,
    sessionId,
    deviceId,
    clientRetrievalId,
    fencingToken,
    deviceGeneration = null,
    timestamp,
    privateKey,
  }) {
    const parts = [
      'NEXA-FENCE-POP-v1',
      action,
      sessionId,
      deviceId,
      clientRetrievalId,
      fencingToken.toString(),
    ];

    if (action === 'ACK' || action === 'RELEASE') {
      if (deviceGeneration === null || deviceGeneration === undefined) {
        throw new Error('Missing deviceGeneration for fence PoP signature');
      }
      parts.push(deviceGeneration.toString());
    }

    parts.push(timestamp.toString());

    const canonicalPayload = Buffer.from(parts.join('|'), 'utf8');
    const signature = crypto.sign(null, canonicalPayload, privateKey);
    return signature.toString('base64');
  }
}

module.exports = {
  QuarantineManager,
  QUARANTINE_DIR_NAME,
  QUARANTINE_FORMAT_HEADER,
  QUARANTINE_VERSION,
};
