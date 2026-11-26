const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const {
  RecoveryClient,
  RECOVERY_FILE_NAME,
  RECOVERY_FORMAT_HEADER,
} = require('../main/recovery/recoveryClient');

describe('NEXA 2.0 Desktop Agent — Ephemeral Disaster Recovery Client (Domain 1)', () => {
  let tempDir;
  let mockSafeStorage;
  let recoveryClient;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-recovery-test-'));
  });

  after(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  beforeEach(() => {
    // Mock DPAPI / safeStorage with reversible symmetric encryption for desktop test environment
    const testSecret = crypto.createHash('sha256').update('nexa_desktop_dpapi_test_secret').digest();

    mockSafeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText) => {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', testSecret, iv);
        const ciphertext = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
        const tag = cipher.getAuthTag();
        return Buffer.concat([iv, tag, ciphertext]);
      },
      decryptString: (encryptedBuffer) => {
        const iv = encryptedBuffer.subarray(0, 12);
        const tag = encryptedBuffer.subarray(12, 28);
        const ciphertext = encryptedBuffer.subarray(28);
        const decipher = crypto.createDecipheriv('aes-256-gcm', testSecret, iv);
        decipher.setAuthTag(tag);
        return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
      },
    };

    recoveryClient = new RecoveryClient({
      storageDir: tempDir,
      safeStorageInstance: mockSafeStorage,
    });
  });

  it('generateRecoveryKeypair should return valid Ed25519 SPKI and PKCS8 DER Buffers', () => {
    const { publicKeyDER, privateKeyDER } = recoveryClient.generateRecoveryKeypair();

    assert.ok(Buffer.isBuffer(publicKeyDER));
    assert.ok(Buffer.isBuffer(privateKeyDER));
    assert.ok(publicKeyDER.length > 32);
    assert.ok(privateKeyDER.length > 32);

    // Verify key can be imported into Node.js crypto
    const pubKey = crypto.createPublicKey({ key: publicKeyDER, format: 'der', type: 'spki' });
    const privKey = crypto.createPrivateKey({ key: privateKeyDER, format: 'der', type: 'pkcs8' });

    assert.equal(pubKey.asymmetricKeyType, 'ed25519');
    assert.equal(privKey.asymmetricKeyType, 'ed25519');
  });

  it('saveRecoveryPrivateKey should encrypt and atomically write recovery.enc file', () => {
    const { privateKeyDER } = recoveryClient.generateRecoveryKeypair();
    recoveryClient.saveRecoveryPrivateKey(privateKeyDER);

    const filePath = recoveryClient.getRecoveryFilePath();
    assert.ok(fs.existsSync(filePath));

    const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(content.format, RECOVERY_FORMAT_HEADER);
    assert.ok(content.ciphertext);
    // Plaintext key MUST NOT appear in the file
    assert.ok(!fs.readFileSync(filePath, 'utf8').includes(privateKeyDER.toString('hex')));
  });

  it('loadRecoveryPrivateKey should decrypt and restore valid private KeyObject', () => {
    const { privateKeyDER } = recoveryClient.generateRecoveryKeypair();
    recoveryClient.saveRecoveryPrivateKey(privateKeyDER);

    const loadedKey = recoveryClient.loadRecoveryPrivateKey();
    assert.ok(loadedKey);
    assert.equal(loadedKey.asymmetricKeyType, 'ed25519');
  });

  it('createRetryPoPSignature should generate verifiable signature over canonical payload', () => {
    const { publicKeyDER, privateKeyDER } = recoveryClient.generateRecoveryKeypair();
    recoveryClient.saveRecoveryPrivateKey(privateKeyDER);

    const ratId = crypto.randomUUID();
    const deviceGeneration = 3;
    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();

    const signatureBase64 = recoveryClient.createRetryPoPSignature({
      ratId,
      deviceGeneration,
      nonce,
      timestamp,
    });

    assert.ok(signatureBase64);
    assert.ok(typeof signatureBase64 === 'string');

    // Verify signature against public key
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

    const pubKey = crypto.createPublicKey({ key: publicKeyDER, format: 'der', type: 'spki' });
    const isVerified = crypto.verify(
      null,
      canonicalPayload,
      pubKey,
      Buffer.from(signatureBase64, 'base64')
    );

    assert.equal(isVerified, true);
  });

  it('clearRecoveryKey should cryptographically wipe and unlink recovery.enc', () => {
    const { privateKeyDER } = recoveryClient.generateRecoveryKeypair();
    recoveryClient.saveRecoveryPrivateKey(privateKeyDER);

    const filePath = recoveryClient.getRecoveryFilePath();
    assert.ok(fs.existsSync(filePath));

    recoveryClient.clearRecoveryKey();
    assert.equal(fs.existsSync(filePath), false);
    assert.equal(recoveryClient.loadRecoveryPrivateKey(), null);
  });
});
