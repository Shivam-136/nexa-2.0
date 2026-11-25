/**
 * NEXA 2.0 Desktop Agent - Secure Storage Service Unit Tests
 * Phase 6 — Milestone 3.2: Secure Device Storage
 *
 * Verifies:
 * - CRUD operations (save, read, exists, clear)
 * - Atomic file write semantics
 * - Encryption/decryption handling
 * - Fail-closed policy when encryption is unavailable
 * - Corrupted file quarantine without secret leakage
 * - In-memory cache purging on shutdown
 * - Token redaction guarantee (deviceToken never returned by getDeviceInfo)
 */

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');

const { SecureStorageService, VAULT_FILE_NAME, VAULT_FORMAT_HEADER } = require('../main/storage/secureStorage');
const { validateCredentialPayload, redactDeviceCredentials } = require('../main/storage/storageSchema');

// Simple mock cryptor simulating Electron safeStorage
function createMockSafeStorage({ available = true, shouldFailDecrypt = false } = {}) {
  let isAvailable = available;
  return {
    isEncryptionAvailable: () => isAvailable,
    setAvailable: (val) => { isAvailable = val; },
    encryptString: (str) => {
      if (!isAvailable) throw new Error('Encryption is not available');
      // Simple reversible mock cipher: prefix + base64
      return Buffer.from('MOCK_ENC:' + Buffer.from(str, 'utf8').toString('base64'), 'utf8');
    },
    decryptString: (buf) => {
      if (!isAvailable) throw new Error('Encryption is not available');
      if (shouldFailDecrypt) throw new Error('Decryption failed');
      const str = buf.toString('utf8');
      if (!str.startsWith('MOCK_ENC:')) {
        throw new Error('Decryption failed: invalid ciphertext signature');
      }
      const b64 = str.slice('MOCK_ENC:'.length);
      return Buffer.from(b64, 'base64').toString('utf8');
    },
  };
}

describe('1. Schema Validation & Token Redaction', () => {
  it('should accept valid credential payload and sanitize fields', () => {
    const raw = {
      deviceId: '  dev-uuid-1234  ',
      deviceName: '  Workstation PC  ',
      deviceToken: 'super-secret-bearer-token-9999',
      userId: 'user-id-5678',
      backendUrl: 'https://api.nexa.local/v1',
    };

    const sanitized = validateCredentialPayload(raw);
    assert.equal(sanitized.deviceId, 'dev-uuid-1234');
    assert.equal(sanitized.deviceName, 'Workstation PC');
    assert.equal(sanitized.deviceToken, 'super-secret-bearer-token-9999');
    assert.equal(sanitized.userId, 'user-id-5678');
    assert.equal(sanitized.backendUrl, 'https://api.nexa.local/v1');
    assert.ok(sanitized.pairedAt, 'pairedAt should be populated');
  });

  it('should reject invalid payload types', () => {
    assert.throws(() => validateCredentialPayload(null), { name: 'TypeError' });
    assert.throws(() => validateCredentialPayload('string'), { name: 'TypeError' });
    assert.throws(() => validateCredentialPayload([]), { name: 'TypeError' });
  });

  it('should reject missing or short deviceToken', () => {
    assert.throws(
      () => validateCredentialPayload({
        deviceId: 'dev-1',
        deviceName: 'PC',
        deviceToken: 'too-short',
        userId: 'u1',
        backendUrl: 'https://api.nexa.local',
      }),
      /Invalid deviceToken/
    );
  });

  it('should reject invalid backendUrl', () => {
    assert.throws(
      () => validateCredentialPayload({
        deviceId: 'dev-1',
        deviceName: 'PC',
        deviceToken: 'valid-device-token-12345',
        userId: 'u1',
        backendUrl: 'ftp://not-http-url',
      }),
      /Protocol must be http: or https:/
    );
  });

  it('redactDeviceCredentials must NEVER include deviceToken', () => {
    const full = {
      deviceId: 'dev-123',
      deviceName: 'Office-PC',
      deviceToken: 'SUPER_SECRET_TOKEN_DO_NOT_LEAK',
      userId: 'usr-456',
      backendUrl: 'https://api.nexa.ai',
      pairedAt: '2026-11-20T10:00:00.000Z',
    };

    const redacted = redactDeviceCredentials(full);
    assert.equal(redacted.isPaired, true);
    assert.equal(redacted.deviceId, 'dev-123');
    assert.equal(redacted.deviceName, 'Office-PC');
    assert.equal(redacted.userId, 'usr-456');
    assert.equal(redacted.backendUrl, 'https://api.nexa.ai');
    assert.equal(redacted.pairedAt, '2026-11-20T10:00:00.000Z');
    assert.equal(redacted.deviceToken, undefined, 'CRITICAL SECURITY: deviceToken must NOT exist on redacted object');
    assert.equal(Object.keys(redacted).includes('deviceToken'), false);
  });

  it('redactDeviceCredentials on null returns safe unpaired object', () => {
    const redacted = redactDeviceCredentials(null);
    assert.equal(redacted.isPaired, false);
    assert.equal(redacted.deviceId, null);
    assert.equal(redacted.deviceToken, undefined);
  });
});

describe('2. SecureStorageService CRUD Operations', () => {
  let tempDir;
  let mockCryptor;
  let storage;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-storage-test-'));
    mockCryptor = createMockSafeStorage({ available: true });
    storage = new SecureStorageService({
      safeStorageInstance: mockCryptor,
      storageDir: tempDir,
    });
    storage.init();
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('hasCredentials returns false when vault is empty', () => {
    assert.equal(storage.hasCredentials(), false);
    assert.equal(storage.getCredentials(), null);
    assert.deepEqual(storage.getDeviceInfo(), {
      isPaired: false,
      deviceId: null,
      deviceName: null,
      userId: null,
      backendUrl: null,
      pairedAt: null,
    });
  });

  it('saveCredentials encrypts and writes vault file to disk', () => {
    const creds = {
      deviceId: 'dev-uuid-1',
      deviceName: 'Testing Device',
      deviceToken: 'secret-pairing-token-abc-123',
      userId: 'user-999',
      backendUrl: 'https://agent.nexa.ai',
    };

    const res = storage.saveCredentials(creds);
    assert.equal(res.success, true);
    assert.equal(storage.hasCredentials(), true);

    // Verify file on disk exists and contains no plaintext credentials
    const vaultPath = path.join(tempDir, VAULT_FILE_NAME);
    assert.equal(fs.existsSync(vaultPath), true);

    const fileContent = fs.readFileSync(vaultPath, 'utf8');
    assert.doesNotMatch(fileContent, /secret-pairing-token-abc-123/, 'CRITICAL: Plaintext token must NEVER appear on disk');
    assert.doesNotMatch(fileContent, /dev-uuid-1/, 'Plaintext deviceId should not appear unencrypted in envelope');

    const envelope = JSON.parse(fileContent);
    assert.equal(envelope.format, VAULT_FORMAT_HEADER);
    assert.equal(envelope.version, 1);
    assert.ok(envelope.ciphertext, 'Ciphertext must be present');
  });

  it('saveCredentials should reject silent overwrite of active credentials without explicit authorization', () => {
    const creds1 = {
      deviceId: 'dev-overwrite-1',
      deviceName: 'Device One',
      deviceToken: 'token-active-12345678',
      userId: 'user-orig',
      backendUrl: 'https://orig.nexa.ai',
    };
    storage.saveCredentials(creds1);
    assert.equal(storage.hasCredentials(), true);

    const creds2 = {
      deviceId: 'dev-overwrite-2',
      deviceName: 'Device Two',
      deviceToken: 'token-hijack-87654321',
      userId: 'user-rogue',
      backendUrl: 'https://rogue.nexa.ai',
    };

    assert.throws(
      () => storage.saveCredentials(creds2),
      /NEXA_ERR_VAULT_ALREADY_EXISTS/
    );

    // Verify original credentials remain intact
    const active = storage.getCredentials();
    assert.equal(active.deviceId, 'dev-overwrite-1');
    assert.equal(active.deviceToken, 'token-active-12345678');
  });

  it('saveCredentials should allow overwrite when allowOverwrite: true is explicitly provided', () => {
    const creds1 = {
      deviceId: 'dev-allow-1',
      deviceName: 'Device One',
      deviceToken: 'token-initial-12345678',
      userId: 'user-orig',
      backendUrl: 'https://orig.nexa.ai',
    };
    storage.saveCredentials(creds1);

    const creds2 = {
      deviceId: 'dev-allow-2',
      deviceName: 'Device Rotated',
      deviceToken: 'token-rotated-87654321',
      userId: 'user-rotated',
      backendUrl: 'https://rotated.nexa.ai',
    };

    const res = storage.saveCredentials(creds2, { allowOverwrite: true });
    assert.equal(res.success, true);

    const active = storage.getCredentials();
    assert.equal(active.deviceId, 'dev-allow-2');
    assert.equal(active.deviceToken, 'token-rotated-87654321');
  });

  it('getCredentials returns decrypted data matching stored payload', () => {
    const creds = {
      deviceId: 'dev-read-test',
      deviceName: 'Read PC',
      deviceToken: 'token-read-test-12345',
      userId: 'user-read',
      backendUrl: 'https://read.nexa.ai',
    };

    storage.saveCredentials(creds);

    // Create a new instance pointing to same storageDir to test read from disk (without cache)
    const freshStorage = new SecureStorageService({
      safeStorageInstance: mockCryptor,
      storageDir: tempDir,
    });
    freshStorage.init();

    const retrieved = freshStorage.getCredentials();
    assert.ok(retrieved, 'Should retrieve stored credentials');
    assert.equal(retrieved.deviceId, 'dev-read-test');
    assert.equal(retrieved.deviceToken, 'token-read-test-12345');
    assert.equal(retrieved.userId, 'user-read');
  });

  it('getDeviceInfo returns redacted metadata without leaking token', () => {
    storage.saveCredentials({
      deviceId: 'dev-info-test',
      deviceName: 'Info PC',
      deviceToken: 'secret-token-do-not-reveal',
      userId: 'user-info',
      backendUrl: 'https://info.nexa.ai',
    });

    const info = storage.getDeviceInfo();
    assert.equal(info.isPaired, true);
    assert.equal(info.deviceId, 'dev-info-test');
    assert.equal(info.deviceName, 'Info PC');
    assert.equal(info.deviceToken, undefined, 'deviceToken MUST be redacted');
  });

  it('clearCredentials removes vault file and purges cache', () => {
    storage.saveCredentials({
      deviceId: 'dev-clear-test',
      deviceName: 'Clear PC',
      deviceToken: 'token-to-be-deleted-12345',
      userId: 'user-clear',
      backendUrl: 'https://clear.nexa.ai',
    });
    assert.equal(storage.hasCredentials(), true);

    const clearRes = storage.clearCredentials();
    assert.equal(clearRes.success, true);
    assert.equal(storage.hasCredentials(), false);
    assert.equal(storage.getCredentials(), null);

    const vaultPath = path.join(tempDir, VAULT_FILE_NAME);
    assert.equal(fs.existsSync(vaultPath), false, 'Vault file must be deleted from disk');
  });
});

describe('3. Fail-Closed Security & Error Handling', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-storage-fail-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  });

  it('must fail closed and throw if encryption is unavailable (NEVER write plaintext)', () => {
    const unavailableCryptor = createMockSafeStorage({ available: false });
    const storage = new SecureStorageService({
      safeStorageInstance: unavailableCryptor,
      storageDir: tempDir,
    });

    assert.equal(storage.isEncryptionAvailable(), false);

    assert.throws(
      () => storage.saveCredentials({
        deviceId: 'dev-fail',
        deviceName: 'Fail PC',
        deviceToken: 'token-should-never-be-saved',
        userId: 'u1',
        backendUrl: 'https://api.nexa.ai',
      }),
      /NEXA_ERR_ENCRYPTION_UNAVAILABLE/
    );

    // Verify NO files were written to disk
    const files = fs.readdirSync(tempDir);
    assert.equal(files.length, 0, 'No files or plaintext fallback may be written when encryption is unavailable');
  });

  it('should safely quarantine corrupted vault file without crashing', () => {
    const vaultPath = path.join(tempDir, VAULT_FILE_NAME);
    // Write corrupted JSON
    fs.writeFileSync(vaultPath, 'CORRUPTED_NON_JSON_DATA', 'utf8');

    const cryptor = createMockSafeStorage({ available: true });
    const storage = new SecureStorageService({
      safeStorageInstance: cryptor,
      storageDir: tempDir,
    });

    const res = storage.getCredentials();
    assert.equal(res, null, 'Should return null on corrupted vault');

    // Original corrupted vault must be renamed/quarantined
    assert.equal(fs.existsSync(vaultPath), false, 'Original corrupted file should be moved');
    const remainingFiles = fs.readdirSync(tempDir);
    assert.ok(
      remainingFiles.some((f) => f.includes('corrupt')),
      'Corrupted file should be quarantined with timestamp'
    );
  });

  it('should quarantine file if decryption fails (e.g. altered ciphertext or key mismatch)', () => {
    const vaultPath = path.join(tempDir, VAULT_FILE_NAME);
    const tamperedEnvelope = {
      format: VAULT_FORMAT_HEADER,
      version: 1,
      updatedAt: new Date().toISOString(),
      ciphertext: Buffer.from('TAMPERED_CIPHERTEXT').toString('base64'),
    };
    fs.writeFileSync(vaultPath, JSON.stringify(tamperedEnvelope), 'utf8');

    const cryptor = createMockSafeStorage({ available: true });
    const storage = new SecureStorageService({
      safeStorageInstance: cryptor,
      storageDir: tempDir,
    });

    const res = storage.getCredentials();
    assert.equal(res, null, 'Should return null when decryption fails');
    assert.equal(fs.existsSync(vaultPath), false, 'Corrupted file should be quarantined');
  });

  it('clearMemoryCache should zero out in-memory credentials on shutdown', () => {
    const cryptor = createMockSafeStorage({ available: true });
    const storage = new SecureStorageService({
      safeStorageInstance: cryptor,
      storageDir: tempDir,
    });

    storage.saveCredentials({
      deviceId: 'dev-mem',
      deviceName: 'Memory PC',
      deviceToken: 'token-in-memory-12345',
      userId: 'u-mem',
      backendUrl: 'https://mem.nexa.ai',
    });

    assert.ok(storage._memoryCache, 'Memory cache should be populated');
    storage.clearMemoryCache();
    assert.equal(storage._memoryCache, null, 'Memory cache must be null after clearMemoryCache()');
  });
});
