import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import app from '../app.js';
import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import User from '../models/user.model.js';
import { signAccessToken } from '../utils/auth.utils.js';
import { initiatePairingSession, claimPairingSession } from '../services/pairing.service.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';

describe('NEXA 2.0 M3.4.7 — Device Management Listing & Metadata API', () => {
  let user;
  let userToken;
  let server;
  let baseUrl;

  before(async () => {
    await startTestMongo(27031);
    user = await User.create({
      email: `m347_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'M347 Owner',
    });
    userToken = signAccessToken(user);

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

  it('returns real OS/platform metadata, online state, and historical unpaired/revoked devices without secrets', async () => {
    // 1. Pair active device and send authenticated heartbeat with platform metadata
    const s1 = await initiatePairingSession({ userId: user._id.toString() });
    const c1 = await claimPairingSession({
      pairingCode: s1.pairingCode,
      deviceId: `dev-m347-active-${crypto.randomUUID()}`,
      deviceName: 'Workstation-Active',
    });

    const auth1 = await fetch(`${baseUrl}/api/v1/device/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: c1.deviceId,
        deviceGeneration: c1.deviceGeneration,
        deviceToken: c1.deviceToken,
      }),
    }).then((r) => r.json());

    await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth1.accessToken}`,
      },
      body: JSON.stringify({
        agentVersion: '2.0.0',
        platform: 'win32',
        arch: 'x64',
        uptimeSeconds: 120,
      }),
    });

    // 2. Pair and unpair a second device for historical revoked/unpaired list
    const s2 = await initiatePairingSession({ userId: user._id.toString() });
    const c2 = await claimPairingSession({
      pairingCode: s2.pairingCode,
      deviceId: `dev-m347-old-${crypto.randomUUID()}`,
      deviceName: 'Workstation-Old',
    });
    await fetch(`${baseUrl}/api/v1/device/${c2.deviceId}/unpair`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userToken}` },
    });

    // 3. Query dashboard status endpoint
    const statusRes = await fetch(`${baseUrl}/api/v1/pairing/status`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const body = await statusRes.json();

    assert.equal(statusRes.status, 200);
    assert.equal(body.connectedDevices.length, 1);
    assert.equal(body.connectedDevices[0].deviceId, c1.deviceId);
    assert.equal(body.connectedDevices[0].isOnline, true);
    assert.equal(body.connectedDevices[0].connectionState, 'ONLINE');
    assert.equal(body.connectedDevices[0].platform, 'win32');
    assert.equal(body.connectedDevices[0].arch, 'x64');
    assert.equal(body.connectedDevices[0].agentVersion, '2.0.0');

    assert.equal(body.revokedDevices.length, 1);
    assert.equal(body.revokedDevices[0].deviceId, c2.deviceId);
    assert.equal(body.revokedDevices[0].connectionState, 'UNPAIRED');
    assert.ok(body.revokedDevices[0].unpairedAt);

    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes('hashedDeviceToken'), false);
    assert.equal(serialized.includes('deviceRefreshTokens'), false);
  });
});
