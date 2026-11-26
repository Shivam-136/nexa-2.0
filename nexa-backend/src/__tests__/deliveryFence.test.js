import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import mongoose from 'mongoose';

import app from '../app.js';
import Device from '../models/device.model.js';
import User from '../models/user.model.js';
import { signAccessToken } from '../utils/auth.utils.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';
import {
  acquireInitialDeliveryFence,
  renewDeviceDeliveryFence,
  ackAndPromoteDeviceDeliveryFence,
  releaseDeviceDeliveryFence,
  executeFencedAdminReset,
  verifyDeliveryFencePoP,
} from '../services/pairing.service.js';
import { handleConfirmActivation } from '../controllers/pairing.controller.js';

describe('NEXA 2.0 Milestone 3.3 — Domain 2: Device Delivery Fence & Safe Credential Activation', () => {
  let server;
  let baseUrl;
  let testPort;

  const testDeviceId = 'NEXA-FENCE-TEST-DEV-001';
  const testSessionId = 'SESSION-ABC-12345';
  const testOperationId = 'OP-FENCE-XYZ-999';
  const initialHashedMrc = crypto.createHash('sha256').update('INITIAL-MRC-SECRET').digest('hex');

  let clientSessionPrivKey;
  let clientSessionPubKeyDER;
  let clientSessionPubKeyBase64;

  before(async () => {
    await startTestMongo(27019);

    server = http.createServer(app);
    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        testPort = server.address().port;
        baseUrl = `http://127.0.0.1:${testPort}`;
        resolve();
      });
    });

    // Generate ephemeral Ed25519 pairing session keypair
    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    clientSessionPrivKey = privateKey;
    clientSessionPubKeyDER = publicKey.export({ type: 'spki', format: 'der' });
    clientSessionPubKeyBase64 = clientSessionPubKeyDER.toString('base64');
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await stopTestMongo();
  });

  beforeEach(async () => {
    await Device.deleteMany({ deviceId: testDeviceId });
    await Device.create({
      deviceId: testDeviceId,
      deviceName: 'Fenced Delivery Test Station',
      deviceGeneration: 1,
      hashedMasterRecoveryCode: initialHashedMrc,
      fencingTokenSequence: 0,
      stagedDeviceToken: {
        operationId: testOperationId,
        hashedToken: 'staged_hashed_token_value_abc_123',
      },
      hashedDeviceToken: null,
      activePairingLock: {
        state: 'in_pairing',
        operationId: testOperationId,
        recoveryEpoch: 0,
        deliveryFence: {
          clientRetrievalId: null,
          clientSessionPubKey: null,
          fencingToken: 0, // Initialized to 0
          expiresAt: null,
        },
      },
    });
  });

  function signFencePayload({
    action,
    sessionId = testSessionId,
    deviceId = testDeviceId,
    clientRetrievalId,
    fencingToken,
    deviceGeneration = null,
    timestamp,
    privKey = clientSessionPrivKey,
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
      parts.push(deviceGeneration.toString());
    }
    parts.push(timestamp.toString());
    const canonical = Buffer.from(parts.join('|'), 'utf8');
    return crypto.sign(null, canonical, privKey).toString('base64');
  }

  // =========================================================================
  // TEST 6: Ed25519 PoP Verification for Keepalive, ACK, and Release
  // =========================================================================
  it('test_delivery_fence_ed25519_pop_verification: validates PoP for keepalive, ACK, and release; rejects tampering', () => {
    const timestamp = Date.now();
    const retrievalId = 'retrieval_id_valid_01';

    // 1. Valid KEEPALIVE PoP
    const keepaliveSig = signFencePayload({
      action: 'KEEPALIVE',
      clientRetrievalId: retrievalId,
      fencingToken: 1,
      timestamp,
    });

    assert.doesNotThrow(() => {
      verifyDeliveryFencePoP({
        action: 'KEEPALIVE',
        sessionId: testSessionId,
        deviceId: testDeviceId,
        clientRetrievalId: retrievalId,
        fencingToken: 1,
        timestamp,
        signatureBase64: keepaliveSig,
        clientSessionPubKeyDER,
      });
    });

    // 2. Valid ACK PoP
    const ackSig = signFencePayload({
      action: 'ACK',
      clientRetrievalId: retrievalId,
      fencingToken: 1,
      deviceGeneration: 1,
      timestamp,
    });

    assert.doesNotThrow(() => {
      verifyDeliveryFencePoP({
        action: 'ACK',
        sessionId: testSessionId,
        deviceId: testDeviceId,
        clientRetrievalId: retrievalId,
        fencingToken: 1,
        deviceGeneration: 1,
        timestamp,
        signatureBase64: ackSig,
        clientSessionPubKeyDER,
      });
    });

    // 3. Reject invalid action
    assert.throws(
      () => {
        verifyDeliveryFencePoP({
          action: 'INVALID_ACTION',
          sessionId: testSessionId,
          deviceId: testDeviceId,
          clientRetrievalId: retrievalId,
          fencingToken: 1,
          timestamp,
          signatureBase64: ackSig,
          clientSessionPubKeyDER,
        });
      },
      /INVALID_FENCE_ACTION/
    );

    // 4. Reject tampered retrievalId
    assert.throws(
      () => {
        verifyDeliveryFencePoP({
          action: 'ACK',
          sessionId: testSessionId,
          deviceId: testDeviceId,
          clientRetrievalId: 'tampered_retrieval_id',
          fencingToken: 1,
          deviceGeneration: 1,
          timestamp,
          signatureBase64: ackSig,
          clientSessionPubKeyDER,
        });
      },
      /INVALID_DELIVERY_FENCE_POP_SIGNATURE/
    );
  });

  // =========================================================================
  // TEST 7: Strictly Monotonic Fencing Token (Never Resets to Null or 1)
  // =========================================================================
  it('test_delivery_fence_fencing_token_monotonic_across_reset: token strictly increments across acquisition, renewal, release, and reset', async () => {
    const retrievalId = 'retrieval_mono_test_01';

    // 1. Initial Acquisition -> Token 0 -> 1
    const acq = await acquireInitialDeliveryFence({
      deviceId: testDeviceId,
      operationId: testOperationId,
      deviceGeneration: 1,
      clientRetrievalId: retrievalId,
      clientSessionPubKeyDER,
    });
    assert.equal(acq.fencingToken, 1);

    // 2. Renewal 1 -> Token 1 -> 2
    const renew1 = await renewDeviceDeliveryFence({
      deviceId: testDeviceId,
      operationId: testOperationId,
      deviceGeneration: 1,
      clientRetrievalId: retrievalId,
      fencingToken: 1,
    });
    assert.equal(renew1.fencingToken, 2);

    // 3. Renewal 2 -> Token 2 -> 3
    const renew2 = await renewDeviceDeliveryFence({
      deviceId: testDeviceId,
      operationId: testOperationId,
      deviceGeneration: 1,
      clientRetrievalId: retrievalId,
      fencingToken: 2,
    });
    assert.equal(renew2.fencingToken, 3);

    // 4. Explicit Release -> Token 3 -> 4 (NEVER RESET TO NULL OR 1)
    const rel = await releaseDeviceDeliveryFence({
      deviceId: testDeviceId,
      operationId: testOperationId,
      clientRetrievalId: retrievalId,
      fencingToken: 3,
    });
    assert.equal(rel.fencingToken, 4);

    const devAfterRelease = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(devAfterRelease.activePairingLock.deliveryFence.clientRetrievalId, null);
    assert.equal(devAfterRelease.activePairingLock.deliveryFence.fencingToken, 4);

    // 5. Admin Reset -> Token 4 -> 5 and Generation 1 -> 2
    const adminReset = await executeFencedAdminReset({
      deviceId: testDeviceId,
      expectedGeneration: 1,
      newMasterHash: crypto.createHash('sha256').update('NEW-MRC-SECRET').digest('hex'),
      adminUser: {
        id: 'test-admin-id',
        role: 'admin',
        permissions: ['device:admin_reset'],
      },
    });
    assert.equal(adminReset.newGeneration, 2);
    assert.equal(adminReset.fencingToken, 5);

    // 6. Next Acquisition in Generation 2 -> Token 5 -> 6
    const acqGen2 = await acquireInitialDeliveryFence({
      deviceId: testDeviceId,
      operationId: testOperationId,
      deviceGeneration: 2,
      clientRetrievalId: 'retrieval_gen2',
      clientSessionPubKeyDER,
    });
    assert.equal(acqGen2.fencingToken, 6);
  });

  // =========================================================================
  // TEST 8: Signed Keepalive Endpoint Extends Lease & Returns Updated Token
  // =========================================================================
  it('test_delivery_fence_keepalive_extends_lease: /delivery-keepalive returns updated token and extends lease', async () => {
    const retrievalId = 'retrieval_keepalive_01';

    const acq = await acquireInitialDeliveryFence({
      deviceId: testDeviceId,
      operationId: testOperationId,
      deviceGeneration: 1,
      clientRetrievalId: retrievalId,
      clientSessionPubKeyDER,
    });
    const currentToken = acq.fencingToken; // 1

    const timestamp = Date.now();
    const signature = signFencePayload({
      action: 'KEEPALIVE',
      clientRetrievalId: retrievalId,
      fencingToken: currentToken,
      timestamp,
    });

    const res = await fetch(`${baseUrl}/api/v1/pairing/delivery-keepalive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'KEEPALIVE',
        sessionId: testSessionId,
        deviceId: testDeviceId,
        operationId: testOperationId,
        deviceGeneration: 1,
        clientRetrievalId: retrievalId,
        fencingToken: currentToken,
        timestamp,
        signature,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'FENCE_RENEWED');
    assert.equal(data.fencingToken, currentToken + 1); // Returned incremented token!

    const dev = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(dev.activePairingLock.deliveryFence.fencingToken, currentToken + 1);
  });

  // =========================================================================
  // TEST 9: Signed ACK & Promotion Promotes Staged Token
  // =========================================================================
  it('test_delivery_fence_ack_promotes_staged_token: /confirm-activation promotes token and marks active', async () => {
    const retrievalId = 'retrieval_ack_01';

    const acq = await acquireInitialDeliveryFence({
      deviceId: testDeviceId,
      operationId: testOperationId,
      deviceGeneration: 1,
      clientRetrievalId: retrievalId,
      clientSessionPubKeyDER,
    });
    const fenceToken = acq.fencingToken;

    const timestamp = Date.now();
    const signature = signFencePayload({
      action: 'ACK',
      clientRetrievalId: retrievalId,
      fencingToken: fenceToken,
      deviceGeneration: 1,
      timestamp,
    });

    const res = await fetch(`${baseUrl}/api/v1/pairing/confirm-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ACK',
        sessionId: testSessionId,
        deviceId: testDeviceId,
        operationId: testOperationId,
        deviceGeneration: 1,
        clientRetrievalId: retrievalId,
        fencingToken: fenceToken,
        timestamp,
        signature,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.status, 'ACTIVATION_CONFIRMED');
    assert.equal(data.confirmedGen, 1);
    assert.equal(data.confirmedToken, fenceToken + 1);

    // Verify DB promotion
    const dev = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(dev.hashedDeviceToken, 'staged_hashed_token_value_abc_123'); // PROMOTED!
    assert.equal(dev.stagedDeviceToken, null); // CLEARED!
    assert.equal(dev.activePairingLock.state, 'idle');
    assert.equal(dev.activePairingLock.deliveryFence.clientRetrievalId, null);
    assert.ok(dev.lastConfirmedActivationAt);

    // Test Idempotent Repeat: Repeating same confirmation succeeds with 200
    const repeatRes = await fetch(`${baseUrl}/api/v1/pairing/confirm-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ACK',
        sessionId: testSessionId,
        deviceId: testDeviceId,
        operationId: testOperationId,
        deviceGeneration: 1,
        clientRetrievalId: retrievalId,
        fencingToken: fenceToken,
        timestamp,
        signature,
      }),
    });

    assert.equal(repeatRes.status, 200);
    const repeatData = await repeatRes.json();
    assert.equal(repeatData.status, 'ACTIVATION_CONFIRMED');
    assert.equal(repeatData.idempotentRepeat, true);
  });

  // =========================================================================
  // TEST 10: Admin Reset (Gen Bump) Rejects In-Flight ACK
  // =========================================================================
  it('test_delivery_fence_generation_bump_rejects_ack: admin reset to Gen 2 causes Gen 1 ACK to be rejected with 409', async () => {
    const retrievalId = 'retrieval_bump_01';

    // 1. Client acquires fence in generation 1
    const acq = await acquireInitialDeliveryFence({
      deviceId: testDeviceId,
      operationId: testOperationId,
      deviceGeneration: 1,
      clientRetrievalId: retrievalId,
      clientSessionPubKeyDER,
    });

    // 2. Client is delayed; admin executes reset advancing generation: 1 -> 2
    // First expire fence on device to allow admin reset
    await Device.updateOne(
      { deviceId: testDeviceId },
      { $set: { 'activePairingLock.deliveryFence.expiresAt': new Date(Date.now() - 1000) } }
    );

    await executeFencedAdminReset({
      deviceId: testDeviceId,
      expectedGeneration: 1,
      newMasterHash: crypto.createHash('sha256').update('NEW-MASTER-AFTER-BUMP').digest('hex'),
      adminUser: {
        id: 'test-admin-id',
        role: 'admin',
        permissions: ['device:admin_reset'],
      },
    });

    // Verify generation bumped to 2
    const devBumped = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(devBumped.deviceGeneration, 2);

    // 3. Client attempts to confirm activation for generation 1
    const timestamp = Date.now();
    const sig = signFencePayload({
      action: 'ACK',
      clientRetrievalId: retrievalId,
      fencingToken: acq.fencingToken,
      deviceGeneration: 1,
      timestamp,
    });

    const res = await fetch(`${baseUrl}/api/v1/pairing/confirm-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ACK',
        sessionId: testSessionId,
        deviceId: testDeviceId,
        operationId: testOperationId,
        deviceGeneration: 1,
        clientRetrievalId: retrievalId,
        fencingToken: acq.fencingToken,
        timestamp,
        signature: sig,
      }),
    });

    // Invariant: generation mismatch is rejected with 404 or 409
    assert.ok(res.status === 404 || res.status === 409);
    const data = await res.json();
    assert.equal(data.success, false);
  });

  // =========================================================================
  // TEST 11: Admin Reset Authorization (Positive & Negative Tests)
  // =========================================================================
  it('test_admin_reset_authorization: rejects unauthenticated, non-admin, missing-permission, and body-only deviceId; allows verified admin', async () => {
    const regularUser = await User.create({
      email: `regular_${Date.now()}@nexa.ai`,
      password: 'Password123!',
      role: 'user',
      permissions: [],
    });
    const adminNoPerm = await User.create({
      email: `admin_noperm_${Date.now()}@nexa.ai`,
      password: 'Password123!',
      role: 'admin',
      permissions: ['other:read'],
    });
    const authorizedAdmin = await User.create({
      email: `admin_full_${Date.now()}@nexa.ai`,
      password: 'Password123!',
      role: 'admin',
      permissions: ['device:admin_reset'],
    });

    const regularToken = signAccessToken(regularUser);
    const adminNoPermToken = signAccessToken(adminNoPerm);
    const authorizedAdminToken = signAccessToken(authorizedAdmin);
    const newMasterHash = crypto.createHash('sha256').update('AUTHORIZED-NEW-MRC').digest('hex');

    // 1. Unauthenticated request -> 401
    const unauthRes = await fetch(`${baseUrl}/api/v1/pairing/admin-reset/${testDeviceId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedGeneration: 1, newMasterHash }),
    });
    assert.equal(unauthRes.status, 401);

    // 2. Authenticated regular user (even if spoofing role/adminId in body) -> 403
    const userRes = await fetch(`${baseUrl}/api/v1/pairing/admin-reset/${testDeviceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${regularToken}`,
      },
      body: JSON.stringify({
        expectedGeneration: 1,
        newMasterHash,
        role: 'admin',
        adminId: authorizedAdmin._id.toString(),
      }),
    });
    assert.equal(userRes.status, 403);

    // 3. Authenticated admin WITHOUT device:admin_reset permission -> 403
    const noPermRes = await fetch(`${baseUrl}/api/v1/pairing/admin-reset/${testDeviceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminNoPermToken}`,
      },
      body: JSON.stringify({ expectedGeneration: 1, newMasterHash }),
    });
    assert.equal(noPermRes.status, 403);

    // 4. Body-only deviceId (missing :deviceId URL param) -> 404
    const bodyOnlyRes = await fetch(`${baseUrl}/api/v1/pairing/admin-reset`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authorizedAdminToken}`,
      },
      body: JSON.stringify({ deviceId: testDeviceId, expectedGeneration: 1, newMasterHash }),
    });
    assert.equal(bodyOnlyRes.status, 404);

    // 5. Mismatched body deviceId vs URL param -> 400
    const mismatchRes = await fetch(`${baseUrl}/api/v1/pairing/admin-reset/${testDeviceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authorizedAdminToken}`,
      },
      body: JSON.stringify({ deviceId: 'OTHER-DEVICE', expectedGeneration: 1, newMasterHash }),
    });
    assert.equal(mismatchRes.status, 400);

    // 6. Direct service call without adminUser -> 403
    await assert.rejects(
      () => executeFencedAdminReset({ deviceId: testDeviceId, expectedGeneration: 1, newMasterHash }),
      (err) => err.statusCode === 403
    );

    // Verify device was NOT modified by any of the rejected attempts
    const devBefore = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(devBefore.deviceGeneration, 1);
    assert.equal(devBefore.hashedMasterRecoveryCode, initialHashedMrc);

    // 7. Authorized admin with device:admin_reset permission -> 200
    const okRes = await fetch(`${baseUrl}/api/v1/pairing/admin-reset/${testDeviceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authorizedAdminToken}`,
      },
      body: JSON.stringify({ expectedGeneration: 1, newMasterHash }),
    });
    assert.equal(okRes.status, 200);
    const okData = await okRes.json();
    assert.equal(okData.status, 'ADMIN_RESET_COMPLETE');
    assert.equal(okData.newGeneration, 2);

    const devAfter = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(devAfter.deviceGeneration, 2);
    assert.equal(devAfter.hashedMasterRecoveryCode, newMasterHash);
  });

  // =========================================================================
  // TEST 12: ACK Idempotency Bypass & RELEASE Action Rejection
  // =========================================================================
  it('test_ack_idempotency_bypass_and_release_action_rejected: rejects RELEASE action, forged idempotency, and stale operations', async () => {
    const retrievalId = 'retrieval_sec_fix_01';

    const acq = await acquireInitialDeliveryFence({
      deviceId: testDeviceId,
      operationId: testOperationId,
      deviceGeneration: 1,
      clientRetrievalId: retrievalId,
      clientSessionPubKeyDER,
    });
    const fenceToken = acq.fencingToken;

    // 1. RELEASE signature CANNOT activate a device via /confirm-activation (HTTP 400)
    const ts1 = Date.now();
    const releaseSig = signFencePayload({
      action: 'RELEASE',
      clientRetrievalId: retrievalId,
      fencingToken: fenceToken,
      deviceGeneration: 1,
      timestamp: ts1,
    });

    const releaseHttpRes = await fetch(`${baseUrl}/api/v1/pairing/confirm-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'RELEASE',
        sessionId: testSessionId,
        deviceId: testDeviceId,
        operationId: testOperationId,
        deviceGeneration: 1,
        clientRetrievalId: retrievalId,
        fencingToken: fenceToken,
        timestamp: ts1,
        signature: releaseSig,
      }),
    });
    assert.equal(releaseHttpRes.status, 400);

    // Also verify controller directly enforces action === 'ACK' even if called without validator
    const mockRes = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
    };
    await handleConfirmActivation(
      {
        body: {
          action: 'RELEASE',
          sessionId: testSessionId,
          deviceId: testDeviceId,
          operationId: testOperationId,
          deviceGeneration: 1,
          clientRetrievalId: retrievalId,
          fencingToken: fenceToken,
          timestamp: ts1,
          signature: releaseSig,
        },
      },
      mockRes,
      () => {}
    );
    assert.equal(mockRes.statusCode, 400);
    assert.ok(mockRes.body.error.includes('INVALID_FENCE_ACTION'));

    // Device must still be unpromoted
    const unpromoted = await Device.findOne({ deviceId: testDeviceId });
    assert.equal(unpromoted.hashedDeviceToken, null);

    // 2. Legitimate ACK activates the device
    const ts2 = Date.now();
    const validAckSig = signFencePayload({
      action: 'ACK',
      clientRetrievalId: retrievalId,
      fencingToken: fenceToken,
      deviceGeneration: 1,
      timestamp: ts2,
    });

    const ackRes = await fetch(`${baseUrl}/api/v1/pairing/confirm-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ACK',
        sessionId: testSessionId,
        deviceId: testDeviceId,
        operationId: testOperationId,
        deviceGeneration: 1,
        clientRetrievalId: retrievalId,
        fencingToken: fenceToken,
        timestamp: ts2,
        signature: validAckSig,
      }),
    });
    assert.equal(ackRes.status, 200);

    // 3. Stale/unrelated operationId CANNOT get idempotent ACTIVATION_CONFIRMED (409)
    const staleOpRes = await fetch(`${baseUrl}/api/v1/pairing/confirm-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ACK',
        sessionId: testSessionId,
        deviceId: testDeviceId,
        operationId: 'STALE-UNRELATED-OP-999',
        deviceGeneration: 1,
        clientRetrievalId: retrievalId,
        fencingToken: fenceToken,
        timestamp: ts2,
        signature: validAckSig,
      }),
    });
    assert.equal(staleOpRes.status, 409);

    // 4. Forged signature on matching operationId CANNOT get idempotent ACTIVATION_CONFIRMED (401)
    const otherKeypair = crypto.generateKeyPairSync('ed25519');
    const forgedSig = signFencePayload({
      action: 'ACK',
      clientRetrievalId: retrievalId,
      fencingToken: fenceToken,
      deviceGeneration: 1,
      timestamp: Date.now(),
      privKey: otherKeypair.privateKey,
    });
    const forgedIdempRes = await fetch(`${baseUrl}/api/v1/pairing/confirm-activation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'ACK',
        sessionId: testSessionId,
        deviceId: testDeviceId,
        operationId: testOperationId,
        deviceGeneration: 1,
        clientRetrievalId: retrievalId,
        fencingToken: fenceToken,
        timestamp: Date.now(),
        signature: forgedSig,
      }),
    });
    assert.equal(forgedIdempRes.status, 401);
  });
});
