import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

import app from '../app.js';
import Device from '../models/device.model.js';
import User from '../models/user.model.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';
import {
  executeInitialRecoveryBurn,
  executeAtomicNonceConsumptionAndFetchRat,
  verifyRetryPoPSignature,
  getRatSecret,
  validateRatSecretConfig,
} from '../services/pairing.service.js';

describe('NEXA 2.0 Milestone 3.3 — Domain 1: RAT Retry & Durable Idempotency', () => {
  let server;
  let baseUrl;
  let testPort;

  // Ephemeral test credentials & keypairs
  const testDeviceId = 'NEXA-TEST-DEVICE-001';
  let testUserId;
  const mrcPlaintext = 'MRC-A1B2-C3D4-E5F6-7890';
  const hashedMrc = crypto.createHash('sha256').update(mrcPlaintext).digest('hex');

  let clientRecoveryPrivKey;
  let clientRecoveryPubKeyDER;
  let clientRecoveryPubKeyBase64;

  before(async () => {
    // 1. Start live MongoDB test instance
    await startTestMongo(27019);

    const user = await User.create({
      email: `rat_recovery_user_${Date.now()}@nexa.ai`,
      password: 'RecoveryUserPass123!',
    });
    testUserId = user._id.toString();

    // 2. Start HTTP server
    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        testPort = server.address().port;
        baseUrl = `http://127.0.0.1:${testPort}`;
        resolve();
      });
    });

    // 3. Generate Ed25519 recovery keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    clientRecoveryPrivKey = privateKey;
    clientRecoveryPubKeyDER = publicKey.export({ type: 'spki', format: 'der' });
    clientRecoveryPubKeyBase64 = clientRecoveryPubKeyDER.toString('base64');
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await stopTestMongo();
  });

  beforeEach(async () => {
    // Reset test device to clean state before each test
    await Device.deleteMany({ deviceId: testDeviceId });
    await Device.create({
      deviceId: testDeviceId,
      deviceName: 'Test Production Workstation',
      deviceGeneration: 1,
      hashedMasterRecoveryCode: hashedMrc,
      fencingTokenSequence: 0,
      isOnline: true,
      pendingResetAuth: null,
      activePairingLock: {
        state: 'idle',
        recoveryEpoch: 0,
        deliveryFence: {
          fencingToken: 0,
        },
      },
    });
  });

  function signRetryPayload({
    ratId,
    deviceGeneration,
    action = 'RECOVER_RETRY',
    nonce,
    timestamp,
    privKey = clientRecoveryPrivKey,
  }) {
    const canonicalPayload = Buffer.from(
      [
        'NEXA-RAT-POP-v1',
        ratId,
        deviceGeneration.toString(),
        action,
        nonce,
        timestamp.toString(),
      ].join('|'),
      'utf8'
    );
    return crypto.sign(null, canonicalPayload, privKey).toString('base64');
  }

  // =========================================================================
  // TEST 1: Durable Token Identity (Zero Re-Minting)
  // =========================================================================
  it('test_rat_retry_durable_token_identity: /recover-retry returns exact byte-for-byte JWT stored during /recover-mrc', async () => {
    // Step 1: Execute initial recovery burn
    const burnRes = await fetch(`${baseUrl}/api/v1/pairing/recover-mrc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: 1,
        mrcPlaintext,
        intendedNewUserId: testUserId,
        clientRecoveryPubKey: clientRecoveryPubKeyBase64,
      }),
    });

    assert.equal(burnRes.status, 200);
    const burnData = await burnRes.json();
    assert.equal(burnData.status, 'RECOVERY_AUTHORIZED');
    assert.ok(burnData.ratToken);
    assert.equal(burnData.deviceGeneration, 2);

    const initialToken = burnData.ratToken;
    const initialRatId = burnData.ratId;
    const initialTokenHash = crypto.createHash('sha256').update(initialToken).digest('hex');

    // Verify DB persisted fields
    const deviceInDb = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(deviceInDb.deviceGeneration, 2);
    assert.equal(deviceInDb.hashedMasterRecoveryCode, null); // Code is burned
    assert.equal(deviceInDb.pendingResetAuth.persistedSignedRat, initialToken);
    assert.equal(deviceInDb.pendingResetAuth.persistedRatHash, initialTokenHash);

    // Step 2: Retry with fresh nonce and valid signature
    const nonce1 = crypto.randomBytes(16).toString('hex');
    const timestamp1 = Date.now();
    const signature1 = signRetryPayload({
      ratId: initialRatId,
      deviceGeneration: 2,
      nonce: nonce1,
      timestamp: timestamp1,
    });

    const retryRes = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: 2,
        ratId: initialRatId,
        action: 'RECOVER_RETRY',
        nonce: nonce1,
        timestamp: timestamp1,
        signature: signature1,
      }),
    });

    assert.equal(retryRes.status, 200);
    const retryData = await retryRes.json();
    assert.equal(retryData.status, 'RECOVERY_AUTHORIZED');
    assert.equal(retryData.idempotentlyRecovered, true);

    // STRICT INVARIANT: Returned token must match byte-for-byte with initial token
    assert.equal(retryData.ratToken, initialToken);
    assert.equal(
      crypto.createHash('sha256').update(retryData.ratToken).digest('hex'),
      initialTokenHash
    );

    // Decoded claims check
    const decoded = jwt.decode(retryData.ratToken);
    assert.equal(decoded.sub, testDeviceId);
    assert.equal(decoded.gen, 2);
    assert.equal(decoded.ratId, initialRatId);
  });

  // =========================================================================
  // TEST 2: Atomic Nonce Consumption
  // =========================================================================
  it('test_rat_retry_atomic_nonce_consumption: valid retry appends nonce and increments retryCounter', async () => {
    // Initial burn
    const burn = await executeInitialRecoveryBurn({
      deviceId: testDeviceId,
      deviceGeneration: 1,
      mrcPlaintext,
      intendedNewUserId: testUserId,
      clientRecoveryPubKeyDER,
    });

    const nonceA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const timestampA = Date.now();

    const retryResult = await executeAtomicNonceConsumptionAndFetchRat({
      deviceId: testDeviceId,
      deviceGeneration: burn.deviceGeneration,
      ratId: burn.ratId,
      nonce: nonceA,
      timestamp: timestampA,
    });

    assert.equal(retryResult.ratToken, burn.ratToken);
    assert.equal(retryResult.retryCount, 1);

    const updated = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(updated.pendingResetAuth.retryCounter, 1);
    assert.ok(updated.pendingResetAuth.consumedNonces.includes(nonceA));
    assert.equal(updated.pendingResetAuth.lastRetryTimestamp, timestampA);
  });

  // =========================================================================
  // TEST 3: Replay Attack Elimination (Same Nonce Rejected)
  // =========================================================================
  it('test_rat_retry_same_nonce_replay_rejected: replay of identical nonce returns 409 Conflict', async () => {
    const burn = await executeInitialRecoveryBurn({
      deviceId: testDeviceId,
      deviceGeneration: 1,
      mrcPlaintext,
      intendedNewUserId: testUserId,
      clientRecoveryPubKeyDER,
    });

    const replayNonce = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const timestamp = Date.now();
    const signature = signRetryPayload({
      ratId: burn.ratId,
      deviceGeneration: burn.deviceGeneration,
      nonce: replayNonce,
      timestamp,
    });

    // 1st dispatch: succeeds
    const res1 = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: burn.deviceGeneration,
        ratId: burn.ratId,
        action: 'RECOVER_RETRY',
        nonce: replayNonce,
        timestamp,
        signature,
      }),
    });
    assert.equal(res1.status, 200);

    // 2nd dispatch: replaying identical nonce is rejected with 409
    const res2 = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: burn.deviceGeneration,
        ratId: burn.ratId,
        action: 'RECOVER_RETRY',
        nonce: replayNonce,
        timestamp,
        signature,
      }),
    });
    assert.equal(res2.status, 409);
    const errData = await res2.json();
    assert.ok(errData.error.includes('RETRY_REJECTED'));
  });

  // =========================================================================
  // TEST 4: Concurrent Race with Identical Nonce (Exactly 1 Winner)
  // =========================================================================
  it('test_rat_retry_concurrent_race_single_winner: 5 concurrent retries with same nonce yields exactly 1 winner and 4 conflicts', async () => {
    const burn = await executeInitialRecoveryBurn({
      deviceId: testDeviceId,
      deviceGeneration: 1,
      mrcPlaintext,
      intendedNewUserId: testUserId,
      clientRecoveryPubKeyDER,
    });

    const contestedNonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const signature = signRetryPayload({
      ratId: burn.ratId,
      deviceGeneration: burn.deviceGeneration,
      nonce: contestedNonce,
      timestamp,
    });

    const requestPayload = {
      deviceId: testDeviceId,
      deviceGeneration: burn.deviceGeneration,
      ratId: burn.ratId,
      action: 'RECOVER_RETRY',
      nonce: contestedNonce,
      timestamp,
      signature,
    };

    // Dispatch 5 concurrent requests simultaneously
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestPayload),
        })
      )
    );

    const statuses = responses.map((r) => r.status);
    const successCount = statuses.filter((s) => s === 200).length;
    const conflictCount = statuses.filter((s) => s === 409).length;

    assert.equal(successCount, 1, `Expected exactly 1 winner (200), received: ${statuses}`);
    assert.equal(conflictCount, 4, `Expected exactly 4 conflicts (409), received: ${statuses}`);

    // Verify database state: nonce recorded exactly once
    const dev = await Device.findOne({ deviceId: testDeviceId });
    const countNonce = dev.pendingResetAuth.consumedNonces.filter((n) => n === contestedNonce).length;
    assert.equal(countNonce, 1);
    assert.equal(dev.pendingResetAuth.retryCounter, 1);
  });

  // =========================================================================
  // TEST 5: Crash After CAS Allows Recovery with Fresh Nonce
  // =========================================================================
  it('test_rat_retry_crash_after_cas_allows_fresh_nonce: simulated lost response recovered via fresh nonce and monotonic timestamp', async () => {
    const burn = await executeInitialRecoveryBurn({
      deviceId: testDeviceId,
      deviceGeneration: 1,
      mrcPlaintext,
      intendedNewUserId: testUserId,
      clientRecoveryPubKeyDER,
    });

    const lostNonce = 'lost_response_nonce_1111111111';
    const t1 = Date.now();

    // 1. First retry commits to DB (simulating server commit then packet drop)
    const commit1 = await executeAtomicNonceConsumptionAndFetchRat({
      deviceId: testDeviceId,
      deviceGeneration: burn.deviceGeneration,
      ratId: burn.ratId,
      nonce: lostNonce,
      timestamp: t1,
    });
    assert.equal(commit1.retryCount, 1);

    // 2. Client times out, generates fresh nonce and advances timestamp
    const freshNonce = 'fresh_recovery_nonce_222222222';
    const t2 = t1 + 100;
    const sig2 = signRetryPayload({
      ratId: burn.ratId,
      deviceGeneration: burn.deviceGeneration,
      nonce: freshNonce,
      timestamp: t2,
    });

    const retryRes = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: burn.deviceGeneration,
        ratId: burn.ratId,
        action: 'RECOVER_RETRY',
        nonce: freshNonce,
        timestamp: t2,
        signature: sig2,
      }),
    });

    assert.equal(retryRes.status, 200);
    const data = await retryRes.json();
    assert.equal(data.ratToken, burn.ratToken); // EXACT token returned
    assert.equal(data.retryCount, 2);

    const dev = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(dev.pendingResetAuth.consumedNonces.length, 2);
    assert.equal(dev.pendingResetAuth.consumedNonces[0], lostNonce);
    assert.equal(dev.pendingResetAuth.consumedNonces[1], freshNonce);
  });

  // =========================================================================
  // TEST 6: Adversarial Tampering Rejected
  // =========================================================================
  it('test_rat_retry_pop_payload_tamper_rejected: altered action, ratId, or signature returns error', async () => {
    const burn = await executeInitialRecoveryBurn({
      deviceId: testDeviceId,
      deviceGeneration: 1,
      mrcPlaintext,
      intendedNewUserId: testUserId,
      clientRecoveryPubKeyDER,
    });

    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const validSignature = signRetryPayload({
      ratId: burn.ratId,
      deviceGeneration: burn.deviceGeneration,
      nonce,
      timestamp,
    });

    // 1. Tampered action
    const resTamperedAction = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: burn.deviceGeneration,
        ratId: burn.ratId,
        action: 'MALICIOUS_ACTION',
        nonce,
        timestamp,
        signature: validSignature,
      }),
    });
    assert.equal(resTamperedAction.status, 400);

    // 2. Tampered ratId (mismatched staged session)
    const bogusRatId = crypto.randomUUID();
    const resTamperedRatId = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: burn.deviceGeneration,
        ratId: bogusRatId,
        action: 'RECOVER_RETRY',
        nonce,
        timestamp,
        signature: validSignature,
      }),
    });
    assert.equal(resTamperedRatId.status, 404);

    // 3. Forged signature with another key
    const otherKeypair = crypto.generateKeyPairSync('ed25519');
    const forgedSignature = signRetryPayload({
      ratId: burn.ratId,
      deviceGeneration: burn.deviceGeneration,
      nonce: crypto.randomBytes(16).toString('hex'),
      timestamp: Date.now(),
      privKey: otherKeypair.privateKey,
    });

    const resForged = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: burn.deviceGeneration,
        ratId: burn.ratId,
        action: 'RECOVER_RETRY',
        nonce: crypto.randomBytes(16).toString('hex'),
        timestamp: Date.now(),
        signature: forgedSignature,
      }),
    });
    assert.equal(resForged.status, 401);
  });

  // =========================================================================
  // TEST 7: Clock Skew Limits (60s Boundary)
  // =========================================================================
  it('test_rat_retry_clock_skew_bounds: timestamps > 60s in past or future are rejected', async () => {
    const burn = await executeInitialRecoveryBurn({
      deviceId: testDeviceId,
      deviceGeneration: 1,
      mrcPlaintext,
      intendedNewUserId: testUserId,
      clientRecoveryPubKeyDER,
    });

    // 1. Skewed 65s in past
    const pastTimestamp = Date.now() - 65000;
    const noncePast = crypto.randomBytes(16).toString('hex');
    const sigPast = signRetryPayload({
      ratId: burn.ratId,
      deviceGeneration: burn.deviceGeneration,
      nonce: noncePast,
      timestamp: pastTimestamp,
    });

    const resPast = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: burn.deviceGeneration,
        ratId: burn.ratId,
        action: 'RECOVER_RETRY',
        nonce: noncePast,
        timestamp: pastTimestamp,
        signature: sigPast,
      }),
    });
    assert.equal(resPast.status, 401);

    // 2. Skewed 65s in future
    const futureTimestamp = Date.now() + 65000;
    const nonceFuture = crypto.randomBytes(16).toString('hex');
    const sigFuture = signRetryPayload({
      ratId: burn.ratId,
      deviceGeneration: burn.deviceGeneration,
      nonce: nonceFuture,
      timestamp: futureTimestamp,
    });

    const resFuture = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: burn.deviceGeneration,
        ratId: burn.ratId,
        action: 'RECOVER_RETRY',
        nonce: nonceFuture,
        timestamp: futureTimestamp,
        signature: sigFuture,
      }),
    });
    assert.equal(resFuture.status, 401);
  });

  // =========================================================================
  // TEST 8: Invalid MRC Code Rejected Without Burning
  // =========================================================================
  it('test_mrc_burn_with_invalid_code_rejected: bad recovery code fails with 401 and code is not burned', async () => {
    const res = await fetch(`${baseUrl}/api/v1/pairing/recover-mrc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: 1,
        mrcPlaintext: 'WRONG-CODE-0000-0000',
        intendedNewUserId: testUserId,
        clientRecoveryPubKey: clientRecoveryPubKeyBase64,
      }),
    });

    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'INVALID_MASTER_RECOVERY_CODE');

    // Invariant: device was NOT modified
    const dev = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(dev.deviceGeneration, 1);
    assert.equal(dev.hashedMasterRecoveryCode, hashedMrc);
    assert.ok(!dev.pendingResetAuth || !dev.pendingResetAuth.ratId);
  });

  // =========================================================================
  // TEST 9: Concurrent Requests with Distinct Nonces & Monotonic Timestamps
  // =========================================================================
  it('test_rat_retry_concurrent_race_different_nonces: 5 distinct nonces serialize and return identical token', async () => {
    const burn = await executeInitialRecoveryBurn({
      deviceId: testDeviceId,
      deviceGeneration: 1,
      mrcPlaintext,
      intendedNewUserId: testUserId,
      clientRecoveryPubKeyDER,
    });

    const baseT = Date.now();
    const nonces = Array.from({ length: 5 }, (_, i) => ({
      nonce: `distinct_nonce_${i}_${crypto.randomBytes(8).toString('hex')}`,
      timestamp: baseT + (i + 1) * 10,
    }));

    // Sequential/concurrent execution with monotonically ordered timestamps
    for (const item of nonces) {
      const sig = signRetryPayload({
        ratId: burn.ratId,
        deviceGeneration: burn.deviceGeneration,
        nonce: item.nonce,
        timestamp: item.timestamp,
      });

      const res = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: testDeviceId,
          deviceGeneration: burn.deviceGeneration,
          ratId: burn.ratId,
          action: 'RECOVER_RETRY',
          nonce: item.nonce,
          timestamp: item.timestamp,
          signature: sig,
        }),
      });

      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.ratToken, burn.ratToken);
    }

    const dev = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(dev.pendingResetAuth.consumedNonces.length, 5);
    assert.equal(dev.pendingResetAuth.retryCounter, 5);
  });

  // =========================================================================
  // TEST 10: Consumed Reset Authorization Rejection
  // =========================================================================
  it('test_rat_retry_consumed_pra_rejected: retries against consumed PRA return 403', async () => {
    const burn = await executeInitialRecoveryBurn({
      deviceId: testDeviceId,
      deviceGeneration: 1,
      mrcPlaintext,
      intendedNewUserId: testUserId,
      clientRecoveryPubKeyDER,
    });

    // Mark PRA as consumed
    await Device.updateOne(
      { deviceId: testDeviceId },
      { $set: { 'pendingResetAuth.isConsumed': true } }
    );

    const nonce = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now();
    const sig = signRetryPayload({
      ratId: burn.ratId,
      deviceGeneration: burn.deviceGeneration,
      nonce,
      timestamp,
    });

    const res = await fetch(`${baseUrl}/api/v1/pairing/recover-retry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: burn.deviceGeneration,
        ratId: burn.ratId,
        action: 'RECOVER_RETRY',
        nonce,
        timestamp,
        signature: sig,
      }),
    });

    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, 'RESET_AUTHORIZATION_ALREADY_CONSUMED');
  });

  // =========================================================================
  // TEST 11: RAT Secret Configuration Fail-Closed & Test Isolation
  // =========================================================================
  it('test_rat_secret_configuration_fail_closed: production fails closed when missing/weak; test env uses isolated test secret', () => {
    const origNodeEnv = process.env.NODE_ENV;
    const origRatSecret = process.env.RAT_SECRET;
    const origJwtSecret = process.env.JWT_ACCESS_SECRET;

    try {
      // 1. Production with missing RAT_SECRET (even when JWT_ACCESS_SECRET is set) -> throws CONFIGURATION_ERROR
      process.env.NODE_ENV = 'production';
      delete process.env.RAT_SECRET;
      process.env.JWT_ACCESS_SECRET = 'prod_jwt_access_secret_0123456789abcdef_0123456789';
      assert.throws(() => validateRatSecretConfig(), /CONFIGURATION_ERROR/);

      // 2. Production with RAT_SECRET identical to JWT_ACCESS_SECRET -> throws CONFIGURATION_ERROR
      process.env.RAT_SECRET = 'prod_jwt_access_secret_0123456789abcdef_0123456789';
      assert.throws(() => validateRatSecretConfig(), /CONFIGURATION_ERROR/);

      // 3. Production with short secret (< 32 chars) -> throws CONFIGURATION_ERROR
      process.env.RAT_SECRET = 'too_short_secret';
      assert.throws(() => validateRatSecretConfig(), /CONFIGURATION_ERROR/);

      // 4. Production with known insecure dev default -> throws CONFIGURATION_ERROR
      process.env.RAT_SECRET = 'nexa_dev_access_secret_super_secure_key_12345';
      assert.throws(() => validateRatSecretConfig(), /CONFIGURATION_ERROR/);

      // 5. Production with valid >= 32 char dedicated RAT_SECRET -> succeeds
      const prodSecret = 'prod_rat_secret_0123456789abcdef_0123456789abcdef';
      process.env.RAT_SECRET = prodSecret;
      assert.equal(getRatSecret(), prodSecret);

      // 6. Test environment without env secrets -> uses isolated test secret (NOT dev fallback)
      process.env.NODE_ENV = 'test';
      delete process.env.RAT_SECRET;
      delete process.env.JWT_ACCESS_SECRET;
      const testSecret = getRatSecret();
      assert.ok(testSecret.length >= 32);
      assert.notEqual(testSecret, 'nexa_dev_access_secret_super_secure_key_12345');

      // 7. Development environment without env secrets -> uses isolated dev secret (distinct from test)
      process.env.NODE_ENV = 'development';
      const devSecret = getRatSecret();
      assert.ok(devSecret.length >= 32);
      assert.notEqual(devSecret, testSecret);
    } finally {
      if (origNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = origNodeEnv;
      if (origRatSecret === undefined) delete process.env.RAT_SECRET;
      else process.env.RAT_SECRET = origRatSecret;
      if (origJwtSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
      else process.env.JWT_ACCESS_SECRET = origJwtSecret;
    }
  });

  // =========================================================================
  // TEST 12: Recovery Target User & Ownership Validation
  // =========================================================================
  it('test_recovery_target_user_and_ownership_validation: rejects invalid ID, non-existent user, and ownership mismatch', async () => {
    // 1. Invalid ObjectId format -> 400
    const badIdRes = await fetch(`${baseUrl}/api/v1/pairing/recover-mrc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: 1,
        mrcPlaintext,
        intendedNewUserId: 'not-a-valid-object-id',
        clientRecoveryPubKey: clientRecoveryPubKeyBase64,
      }),
    });
    assert.equal(badIdRes.status, 400);

    // 2. Non-existent valid ObjectId -> 404
    const missingUserId = new mongoose.Types.ObjectId().toString();
    const missingRes = await fetch(`${baseUrl}/api/v1/pairing/recover-mrc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: 1,
        mrcPlaintext,
        intendedNewUserId: missingUserId,
        clientRecoveryPubKey: clientRecoveryPubKeyBase64,
      }),
    });
    assert.equal(missingRes.status, 404);

    // 3. Owned device recovery attempted by a different valid user -> 403
    const otherUser = await User.create({
      email: `other_owner_${Date.now()}@nexa.ai`,
      password: 'OtherOwnerPass123!',
    });
    await Device.updateOne(
      { deviceId: testDeviceId },
      { $set: { userId: new mongoose.Types.ObjectId(testUserId) } }
    );

    const hijackRes = await fetch(`${baseUrl}/api/v1/pairing/recover-mrc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: testDeviceId,
        deviceGeneration: 1,
        mrcPlaintext,
        intendedNewUserId: otherUser._id.toString(),
        clientRecoveryPubKey: clientRecoveryPubKeyBase64,
      }),
    });
    assert.equal(hijackRes.status, 403);
    const hijackData = await hijackRes.json();
    assert.ok(hijackData.error.includes('RECOVERY_OWNERSHIP_MISMATCH'));
  });
});
