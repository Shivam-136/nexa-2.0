import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import app from '../app.js';
import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import User from '../models/user.model.js';
import { signAccessToken } from '../utils/auth.utils.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';
import {
  initiatePairingSession,
  getPairingStatus,
  cancelPairingSession,
  claimPairingSession,
} from '../services/pairing.service.js';

describe('NEXA 2.0 Milestone 3.4.1 — Device Pairing Lifecycle & Security', () => {
  let testUser;
  let accessToken;
  let server;
  let baseUrl;

  before(async () => {
    await startTestMongo(27024);
    testUser = await User.create({
      email: `pairing_m341_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'Pairing Tester',
    });
    accessToken = signAccessToken(testUser);

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await stopTestMongo();
  });

  beforeEach(async () => {
    await PairingSession.deleteMany({ userId: testUser._id });
    await Device.deleteMany({ userId: testUser._id });
  });

  it('initiates a short-lived pairing session and supersedes prior pending sessions', async () => {
    const first = await initiatePairingSession({ userId: testUser._id.toString() });
    assert.match(first.pairingCode, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.equal(first.status, 'pending');
    assert.ok(Date.parse(first.expiresAt) > Date.now());

    const second = await initiatePairingSession({ userId: testUser._id.toString() });
    assert.notEqual(second.sessionId, first.sessionId);

    const firstDoc = await PairingSession.findById(first.sessionId).lean();
    assert.equal(firstDoc.status, 'cancelled');
    assert.notEqual(firstDoc.pairingCode, first.pairingCode, 'Plaintext pairing code must NEVER be stored in MongoDB');
    const expectedHash = crypto.createHash('sha256').update(first.pairingCode).digest('hex').toUpperCase();
    assert.equal(firstDoc.pairingCode, expectedHash);
  });

  it('claims a valid pairing code once, hashes deviceToken, and rejects replay', async () => {
    const session = await initiatePairingSession({ userId: testUser._id.toString() });
    const deviceId = `dev-m341-${crypto.randomUUID()}`;

    const claimed = await claimPairingSession({
      pairingCode: session.pairingCode.toLowerCase().replace('-', ''),
      deviceId,
      deviceName: 'Workstation-Alpha',
    });

    assert.equal(claimed.deviceId, deviceId);
    assert.equal(claimed.deviceName, 'Workstation-Alpha');
    assert.equal(claimed.userId, testUser._id.toString());
    assert.ok(claimed.deviceToken && claimed.deviceToken.length >= 32);

    const deviceDoc = await Device.findOne({ deviceId }).lean();
    assert.ok(deviceDoc);
    const expectedHash = crypto.createHash('sha256').update(claimed.deviceToken).digest('hex');
    assert.equal(deviceDoc.hashedDeviceToken, expectedHash);
    assert.notEqual(deviceDoc.hashedDeviceToken, claimed.deviceToken);

    await assert.rejects(
      () =>
        claimPairingSession({
          pairingCode: session.pairingCode,
          deviceId: `dev-m341-other-${crypto.randomUUID()}`,
          deviceName: 'Replay-Device',
        }),
      (err) => err.statusCode === 409 && /ALREADY_CLAIMED/.test(err.message)
    );
  });

  it('enforces single-winner atomic CAS under concurrent claim race', async () => {
    const session = await initiatePairingSession({ userId: testUser._id.toString() });

    const attempts = Array.from({ length: 5 }, (_, idx) =>
      claimPairingSession({
        pairingCode: session.pairingCode,
        deviceId: `dev-race-${idx}-${crypto.randomUUID()}`,
        deviceName: `Race-PC-${idx}`,
      })
    );

    const results = await Promise.allSettled(attempts);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'Exactly one concurrent claim must win');
    assert.equal(rejected.length, 4, 'All other concurrent claims must be rejected');
  });

  it('rejects expired pairing codes with 410', async () => {
    const session = await initiatePairingSession({ userId: testUser._id.toString() });
    await PairingSession.updateOne(
      { _id: session.sessionId },
      { $set: { expiresAt: new Date(Date.now() - 5000) } }
    );

    await assert.rejects(
      () =>
        claimPairingSession({
          pairingCode: session.pairingCode,
          deviceId: `dev-exp-${crypto.randomUUID()}`,
          deviceName: 'Late-PC',
        }),
      (err) => err.statusCode === 410 && /EXPIRED/.test(err.message)
    );
  });

  it('cancels pending pairing session and blocks subsequent claim', async () => {
    const session = await initiatePairingSession({ userId: testUser._id.toString() });
    const cancelRes = await cancelPairingSession({
      userId: testUser._id.toString(),
      sessionId: session.sessionId,
    });
    assert.equal(cancelRes.cancelled, true);
    assert.equal(cancelRes.status, 'cancelled');

    await assert.rejects(
      () =>
        claimPairingSession({
          pairingCode: session.pairingCode,
          deviceId: `dev-cancel-${crypto.randomUUID()}`,
          deviceName: 'Cancelled-PC',
        }),
      (err) => err.statusCode === 410 && /CANCELLED/.test(err.message)
    );
  });

  it('HTTP endpoints require auth for initiate/status/cancel and complete end-to-end claim', async () => {
    const unauthRes = await fetch(`${baseUrl}/api/v1/pairing/initiate`, { method: 'POST' });
    assert.equal(unauthRes.status, 401);

    const initRes = await fetch(`${baseUrl}/api/v1/pairing/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(initRes.status, 201);
    const initJson = await initRes.json();
    assert.equal(initJson.success, true);
    assert.ok(initJson.pairingCode);

    const deviceId = `dev-http-${crypto.randomUUID()}`;
    const claimRes = await fetch(`${baseUrl}/api/v1/pairing/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: initJson.pairingCode,
        deviceId,
        deviceName: 'HTTP-Desktop-Agent',
      }),
    });
    assert.equal(claimRes.status, 200);
    const claimJson = await claimRes.json();
    assert.equal(claimJson.success, true);
    assert.equal(claimJson.deviceId, deviceId);
    assert.ok(claimJson.deviceToken);

    const statusRes = await fetch(
      `${baseUrl}/api/v1/pairing/status?sessionId=${encodeURIComponent(initJson.sessionId)}`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
    assert.equal(statusRes.status, 200);
    const statusJson = await statusRes.json();
    assert.equal(statusJson.activeSession.status, 'completed');
    assert.equal(statusJson.connectedDevices.length, 1);
    assert.equal(statusJson.connectedDevices[0].deviceId, deviceId);
    assert.equal(statusJson.connectedDevices[0].deviceToken, undefined);

    const statusSummary = await getPairingStatus({ userId: testUser._id.toString() });
    assert.equal(statusSummary.connectedDevices.length, 1);
  });

  it('blocks cross-account deviceId impersonation and preserves victim device ownership', async () => {
    const victimSession = await initiatePairingSession({ userId: testUser._id.toString() });
    const victimDeviceId = `dev-victim-${crypto.randomUUID()}`;
    const victimClaim = await claimPairingSession({
      pairingCode: victimSession.pairingCode,
      deviceId: victimDeviceId,
      deviceName: 'Victim-PC',
    });

    const attacker = await User.create({
      email: `attacker_m341_${Date.now()}@nexa.ai`,
      password: 'AttackerPassword123!',
      displayName: 'Attacker',
    });

    // Attacker cannot cancel or view victim's session
    const crossCancel = await cancelPairingSession({
      userId: attacker._id.toString(),
      sessionId: victimSession.sessionId,
    });
    assert.equal(crossCancel.cancelled, false);

    // Attacker initiates their own pairing session and tries to claim victimDeviceId
    const attackerSession = await initiatePairingSession({ userId: attacker._id.toString() });
    await assert.rejects(
      () =>
        claimPairingSession({
          pairingCode: attackerSession.pairingCode,
          deviceId: victimDeviceId,
          deviceName: 'Hijacked-PC',
        }),
      (err) => err.statusCode === 403 && /DEVICE_IDENTITY_CONFLICT/.test(err.message)
    );

    const victimDevice = await Device.findOne({ deviceId: victimDeviceId }).lean();
    assert.equal(victimDevice.userId.toString(), testUser._id.toString());
    const expectedVictimHash = crypto.createHash('sha256').update(victimClaim.deviceToken).digest('hex');
    assert.equal(victimDevice.hashedDeviceToken, expectedVictimHash);
  });
});
