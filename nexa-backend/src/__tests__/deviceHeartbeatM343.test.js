import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import app from '../app.js';
import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import User from '../models/user.model.js';
import { signDeviceAccessToken } from '../utils/deviceAuth.utils.js';
import { initiatePairingSession, claimPairingSession } from '../services/pairing.service.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';

describe('NEXA 2.0 Milestone 3.4.3 — Authenticated Device Heartbeat API', () => {
  let userA;
  let userB;
  let server;
  let baseUrl;

  before(async () => {
    await startTestMongo(27026);
    userA = await User.create({
      email: `hb_a_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'Heartbeat Owner A',
    });
    userB = await User.create({
      email: `hb_b_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'Heartbeat Owner B',
    });

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
    await PairingSession.deleteMany({});
    await Device.deleteMany({});
  });

  async function pairAndAuthDevice(ownerId, suffix = 'alpha') {
    const session = await initiatePairingSession({ userId: ownerId.toString() });
    const deviceId = `dev-m343-${suffix}-${crypto.randomUUID()}`;
    const claimed = await claimPairingSession({
      pairingCode: session.pairingCode,
      deviceId,
      deviceName: `Workstation-${suffix}`,
    });

    const authRes = await fetch(`${baseUrl}/api/v1/device/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: claimed.deviceId,
        deviceGeneration: claimed.deviceGeneration,
        deviceToken: claimed.deviceToken,
      }),
    });
    const authBody = await authRes.json();
    assert.equal(authRes.status, 200);
    return { claimed, authBody };
  }

  it('records an authenticated heartbeat and updates lastSeenAt, isOnline, and metadata', async () => {
    const { claimed, authBody } = await pairAndAuthDevice(userA._id, 'ok');
    const beforeDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(beforeDoc.isOnline, false);

    // Ensure timestamp advances
    await new Promise((r) => setTimeout(r, 15));

    const res = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authBody.accessToken}`,
        'X-Device-Id': claimed.deviceId,
        'X-Device-Generation': String(claimed.deviceGeneration),
      },
      body: JSON.stringify({
        agentVersion: '2.0.0',
        platform: 'win32',
        arch: 'x64',
        uptimeSeconds: 42,
      }),
    });
    const body = await res.json();

    assert.equal(res.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.status, 'ONLINE');
    assert.equal(body.deviceId, claimed.deviceId);
    assert.equal(body.deviceGeneration, claimed.deviceGeneration);
    assert.equal(body.isOnline, true);
    assert.equal(body.heartbeatCount, 1);
    assert.ok(body.lastSeenAt);
    assert.ok(body.lastHeartbeatAt);
    assert.ok(new Date(body.lastSeenAt).getTime() >= new Date(beforeDoc.lastSeenAt).getTime());

    const afterDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(afterDoc.isOnline, true);
    assert.equal(afterDoc.heartbeatCount, 1);
    assert.equal(afterDoc.heartbeatMetadata?.agentVersion, '2.0.0');
    assert.equal(afterDoc.heartbeatMetadata?.platform, 'win32');
    assert.equal(afterDoc.heartbeatMetadata?.uptimeSeconds, 42);
  });

  it('rejects heartbeat with missing authentication', async () => {
    const res = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.success, false);
    assert.equal(body.code, 'DEVICE_AUTH_REQUIRED');
  });

  it('rejects heartbeat with invalid device identity', async () => {
    const fakeToken = signDeviceAccessToken({
      deviceId: `dev-nonexistent-${crypto.randomUUID()}`,
      userId: userA._id.toString(),
      deviceGeneration: 1,
    });

    const res = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${fakeToken}`,
      },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.success, false);
    assert.equal(body.code, 'DEVICE_NOT_FOUND');
  });

  it('rejects heartbeat with invalid or stale device generation', async () => {
    const { claimed, authBody } = await pairAndAuthDevice(userA._id, 'gen');

    await Device.updateOne({ deviceId: claimed.deviceId }, { $inc: { deviceGeneration: 1 } });

    const res = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authBody.accessToken}`,
        'X-Device-Id': claimed.deviceId,
        'X-Device-Generation': String(claimed.deviceGeneration),
      },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 401);
    assert.equal(body.success, false);
    assert.equal(body.code, 'DEVICE_GENERATION_MISMATCH');
  });

  it('rejects heartbeat from revoked device', async () => {
    const { claimed, authBody } = await pairAndAuthDevice(userA._id, 'revoked');
    await Device.updateOne({ deviceId: claimed.deviceId }, { $set: { isRevoked: true } });

    const res = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authBody.accessToken}`,
      },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.success, false);
    assert.equal(body.code, 'DEVICE_REVOKED');
  });

  it('rejects heartbeat from quarantined device', async () => {
    const { claimed, authBody } = await pairAndAuthDevice(userA._id, 'quarantined');
    await Device.updateOne(
      { deviceId: claimed.deviceId },
      { $set: { isQuarantined: true, quarantineReason: 'Security audit lock' } }
    );

    const res = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authBody.accessToken}`,
      },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.success, false);
    assert.equal(body.code, 'DEVICE_QUARANTINED');
  });

  it('rejects heartbeat from recovery-locked device', async () => {
    const { claimed, authBody } = await pairAndAuthDevice(userA._id, 'reclock');
    await Device.updateOne(
      { deviceId: claimed.deviceId },
      { $set: { 'activePairingLock.state': 'in_pairing' } }
    );

    const res = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authBody.accessToken}`,
      },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.success, false);
    assert.equal(body.code, 'DEVICE_QUARANTINED');
  });

  it('prevents cross-device access via X-Device-Id header or body.deviceId spoofing', async () => {
    const devA = await pairAndAuthDevice(userA._id, 'cross-a');
    const devB = await pairAndAuthDevice(userB._id, 'cross-b');

    // 1. Spoofed X-Device-Id header
    const resHeader = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${devA.authBody.accessToken}`,
        'X-Device-Id': devB.claimed.deviceId,
      },
      body: JSON.stringify({}),
    });
    const bodyHeader = await resHeader.json();
    assert.equal(resHeader.status, 403);
    assert.equal(bodyHeader.code, 'CROSS_DEVICE_TOKEN_MISUSE');

    // 2. Spoofed body.deviceId (never trust body deviceId)
    const resBody = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${devA.authBody.accessToken}`,
        'X-Device-Id': devA.claimed.deviceId,
      },
      body: JSON.stringify({
        deviceId: devB.claimed.deviceId,
      }),
    });
    const bodyResp = await resBody.json();
    assert.equal(resBody.status, 403);
    assert.equal(bodyResp.code, 'CROSS_DEVICE_TOKEN_MISUSE');

    // Verify devB was NOT marked online
    const devBDoc = await Device.findOne({ deviceId: devB.claimed.deviceId }).lean();
    assert.equal(devBDoc.isOnline, false);
    assert.equal(devBDoc.heartbeatCount, 0);
  });
});
