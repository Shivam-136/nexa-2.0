const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const {
  QuarantineManager,
  QUARANTINE_FORMAT_HEADER,
} = require('../main/storage/quarantineManager');
const { SecureStorageService } = require('../main/storage/secureStorage');

describe('NEXA 2.0 Desktop Agent — Quarantined Credential Staging & Safe Activation (Domain 2)', () => {
  let tempDir;
  let mockSafeStorage;
  let quarantineManager;
  let secureStorageService;

  before(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-quarantine-test-'));
  });

  after(() => {
    try {
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  beforeEach(() => {
    const testSecret = crypto.createHash('sha256').update('nexa_quarantine_dpapi_secret').digest();

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

    quarantineManager = new QuarantineManager({
      storageDir: tempDir,
      safeStorageInstance: mockSafeStorage,
    });

    secureStorageService = new SecureStorageService({
      storageDir: tempDir,
      safeStorageInstance: mockSafeStorage,
    });
  });

  const testPayload = {
    deviceId: 'NEXA-DESKTOP-TEST-777',
    deviceName: 'Operator Workstation',
    userId: 'user_operator_999',
    deviceToken: 'super_secret_raw_device_token_xyz_1234567890',
    backendUrl: 'http://127.0.0.1:3000',
    pairedAt: new Date().toISOString(),
  };

  it('stageCredentialBundle should stage encrypted credentials without touching active secure-vault', () => {
    const retrievalId = 'retrieval_stage_001';
    const result = quarantineManager.stageCredentialBundle(retrievalId, testPayload);

    assert.equal(result.success, true);
    assert.ok(fs.existsSync(result.quarantinePath));

    // INVARIANT: Active store must NOT exist yet!
    assert.equal(secureStorageService.hasCredentials(), false);
    assert.equal(fs.existsSync(secureStorageService.getVaultPath()), false);

    // Verify envelope format
    const envelope = JSON.parse(fs.readFileSync(result.quarantinePath, 'utf8'));
    assert.equal(envelope.format, QUARANTINE_FORMAT_HEADER);
    assert.equal(envelope.retrievalId, retrievalId);
  });

  it('validateMonotonicTimerAndLease should abort if monotonic elapsed time >= 40s', () => {
    // Simulate monotonic start time 41 seconds ago
    const simulatedStartHrTime = process.hrtime.bigint() - 41000000000n; // 41s in nanoseconds
    const futureExpiry = new Date(Date.now() + 45000).toISOString();

    assert.throws(
      () => {
        quarantineManager.validateMonotonicTimerAndLease({
          startHrTime: simulatedStartHrTime,
          leaseExpiresAt: futureExpiry,
          maxElapsedMs: 40000,
        });
      },
      /LOCAL_LEASE_EXPIRATION_ABORT.*Monotonic elapsed time/
    );
  });

  it('validateMonotonicTimerAndLease should abort if approaching server lease boundary', () => {
    const recentStart = process.hrtime.bigint() - 1000000000n; // 1s ago
    // Lease expires in 3 seconds (within 5-second safety buffer)
    const almostExpired = new Date(Date.now() + 3000).toISOString();

    assert.throws(
      () => {
        quarantineManager.validateMonotonicTimerAndLease({
          startHrTime: recentStart,
          leaseExpiresAt: almostExpired,
          safetyBufferMs: 5000,
        });
      },
      /LOCAL_LEASE_EXPIRATION_ABORT.*Server lease expiring/
    );
  });

  it('promoteQuarantineToActive should safely promote credentials and wipe quarantined file', () => {
    const retrievalId = 'retrieval_promote_002';
    quarantineManager.stageCredentialBundle(retrievalId, testPayload);
    const quarantinePath = quarantineManager.getQuarantineFilePath(retrievalId);
    assert.ok(fs.existsSync(quarantinePath));

    // Promote
    const promoResult = quarantineManager.promoteQuarantineToActive(retrievalId, secureStorageService);
    assert.equal(promoResult.success, true);

    // 1. Active store now has credentials
    assert.equal(secureStorageService.hasCredentials(), true);
    const active = secureStorageService.getCredentials();
    assert.equal(active.deviceId, testPayload.deviceId);
    assert.equal(active.deviceToken, testPayload.deviceToken);

    // 2. Quarantine file is unlinked/zeroed
    assert.equal(fs.existsSync(quarantinePath), false);
  });

  it('purgeQuarantinedBundle should cryptographically zero and delete quarantined file upon rejection', () => {
    const retrievalId = 'retrieval_purge_003';
    quarantineManager.stageCredentialBundle(retrievalId, testPayload);
    const quarantinePath = quarantineManager.getQuarantineFilePath(retrievalId);
    assert.ok(fs.existsSync(quarantinePath));

    quarantineManager.purgeQuarantinedBundle(retrievalId);
    assert.equal(fs.existsSync(quarantinePath), false);
  });

  it('createDeliveryFencePoPSignature should generate cryptographically valid signatures for KEEPALIVE and ACK', () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    const sessionId = 'session_pop_01';
    const deviceId = 'device_pop_01';
    const clientRetrievalId = 'retrieval_pop_01';
    const fencingToken = 3;
    const timestamp = Date.now();

    // 1. KEEPALIVE signature
    const keepaliveSig = quarantineManager.createDeliveryFencePoPSignature({
      action: 'KEEPALIVE',
      sessionId,
      deviceId,
      clientRetrievalId,
      fencingToken,
      timestamp,
      privateKey,
    });

    assert.ok(keepaliveSig);

    const canonicalKeepalive = Buffer.from(
      `NEXA-FENCE-POP-v1|KEEPALIVE|${sessionId}|${deviceId}|${clientRetrievalId}|${fencingToken}|${timestamp}`,
      'utf8'
    );
    assert.equal(
      crypto.verify(null, canonicalKeepalive, publicKey, Buffer.from(keepaliveSig, 'base64')),
      true
    );

    // 2. ACK signature
    const ackSig = quarantineManager.createDeliveryFencePoPSignature({
      action: 'ACK',
      sessionId,
      deviceId,
      clientRetrievalId,
      fencingToken,
      deviceGeneration: 2,
      timestamp,
      privateKey,
    });

    assert.ok(ackSig);

    const canonicalAck = Buffer.from(
      `NEXA-FENCE-POP-v1|ACK|${sessionId}|${deviceId}|${clientRetrievalId}|${fencingToken}|2|${timestamp}`,
      'utf8'
    );
    assert.equal(
      crypto.verify(null, canonicalAck, publicKey, Buffer.from(ackSig, 'base64')),
      true
    );
  });
});
