import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import app from '../app.js';
import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import User from '../models/user.model.js';
import { signAccessToken } from '../utils/auth.utils.js';
import { initiatePairingSession, claimPairingSession } from '../services/pairing.service.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';

const require = createRequire(import.meta.url);
const { DeviceAuthClient } = require('../../../nexa-desktop/src/main/auth/deviceAuthClient.js');
const { HeartbeatClient, CONNECTION_STATES } = require('../../../nexa-desktop/src/main/heartbeat/heartbeatClient.js');

function createDesktopStorageMock(initialCreds) {
  let creds = initialCreds ? { ...initialCreds } : null;
  return {
    isEncryptionAvailable: () => true,
    hasCredentials: () => Boolean(creds),
    getCredentials: () => (creds ? { ...creds } : null),
    clearCredentials: () => {
      creds = null;
      return { success: true };
    },
    getDeviceInfo: () => ({
      isPaired: Boolean(creds),
      deviceId: creds?.deviceId || null,
      deviceName: creds?.deviceName || null,
      userId: creds?.userId || null,
      backendUrl: creds?.backendUrl || null,
      pairedAt: creds?.pairedAt || null,
    }),
  };
}

describe('NEXA 2.0 M3.4.6 — Secure Device Unpair & Integration', () => {
  let userA;
  let userB;
  let userAToken;
  let userBToken;
  let server;
  let baseUrl;

  before(async () => {
    await startTestMongo(27030);
    userA = await User.create({
      email: `m346_a_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'Unpair Owner A',
    });
    userB = await User.create({
      email: `m346_b_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'Unpair Owner B',
    });
    userAToken = signAccessToken(userA);
    userBToken = signAccessToken(userB);

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

  async function pairAndAuth(owner, suffix) {
    const session = await initiatePairingSession({ userId: owner._id.toString() });
    const deviceId = `dev-m346-${suffix}-${crypto.randomUUID()}`;
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

  it('unpairs owned device, invalidates tokens, bumps generation, preserves audit record, and blocks future auth/heartbeat', async () => {
    const { claimed, authBody } = await pairAndAuth(userA, 'owner');

    // Send an initial heartbeat so isOnline is true
    const hb1 = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authBody.accessToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(hb1.status, 200);

    // Owner unpairs device
    const unpairRes = await fetch(`${baseUrl}/api/v1/device/${claimed.deviceId}/unpair`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const unpairBody = await unpairRes.json();

    assert.equal(unpairRes.status, 200);
    assert.equal(unpairBody.success, true);
    assert.equal(unpairBody.unpaired, true);
    assert.equal(unpairBody.alreadyUnpaired, false);
    assert.equal(unpairBody.deviceGeneration, claimed.deviceGeneration + 1);
    assert.equal(unpairBody.isOnline, false);
    assert.ok(unpairBody.unpairedAt);

    // Audit record is preserved in MongoDB with revoked/unpaired fields
    const dbDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.ok(dbDoc);
    assert.equal(dbDoc.isRevoked, true);
    assert.equal(dbDoc.isOnline, false);
    assert.equal(dbDoc.hashedDeviceToken, null);
    assert.equal(dbDoc.deviceRefreshTokens.length, 0);
    assert.ok(dbDoc.unpairedAt);

    // Subsequent heartbeat, refresh, and re-auth are all rejected
    const hb2 = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authBody.accessToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(hb2.status, 403);
    assert.equal((await hb2.json()).code, 'DEVICE_REVOKED');

    const refRes = await fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: authBody.refreshToken }),
    });
    assert.equal(refRes.status, 403);

    const reauthRes = await fetch(`${baseUrl}/api/v1/device/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: claimed.deviceId,
        deviceGeneration: claimed.deviceGeneration,
        deviceToken: claimed.deviceToken,
      }),
    });
    assert.equal(reauthRes.status, 403);
  });

  it('rejects cross-account unpair and isolates multi-device sessions', async () => {
    const devA1 = await pairAndAuth(userA, 'a1');
    const devA2 = await pairAndAuth(userA, 'a2');

    // User B cannot unpair User A's device
    const crossRes = await fetch(`${baseUrl}/api/v1/device/${devA1.claimed.deviceId}/unpair`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    assert.equal(crossRes.status, 403);

    // User A unpairs devA1 -> devA2 remains completely functional
    const unpairA1 = await fetch(`${baseUrl}/api/v1/device/${devA1.claimed.deviceId}/unpair`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    assert.equal(unpairA1.status, 200);

    const hbA2 = await fetch(`${baseUrl}/api/v1/device/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${devA2.authBody.accessToken}`,
      },
      body: JSON.stringify({}),
    });
    assert.equal(hbA2.status, 200);

    const statusRes = await fetch(`${baseUrl}/api/v1/pairing/status`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const statusBody = await statusRes.json();
    assert.equal(statusBody.connectedDevices.length, 1);
    assert.equal(statusBody.connectedDevices[0].deviceId, devA2.claimed.deviceId);
  });

  it('handles concurrent unpair requests and idempotent repeated unpair requests', async () => {
    const { claimed } = await pairAndAuth(userA, 'concurrent');

    const [r1, r2] = await Promise.all([
      fetch(`${baseUrl}/api/v1/device/${claimed.deviceId}/unpair`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userAToken}` },
      }).then((r) => r.json()),
      fetch(`${baseUrl}/api/v1/device/${claimed.deviceId}/unpair`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${userAToken}` },
      }).then((r) => r.json()),
    ]);

    assert.equal(r1.success, true);
    assert.equal(r2.success, true);

    const repeat = await fetch(`${baseUrl}/api/v1/device/${claimed.deviceId}/unpair`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    const repeatBody = await repeat.json();
    assert.equal(repeat.status, 200);
    assert.equal(repeatBody.unpaired, true);
    assert.equal(repeatBody.alreadyUnpaired, true);
    assert.equal(repeatBody.deviceGeneration, claimed.deviceGeneration + 1);
  });

  it('performs Electron Main -> Backend -> MongoDB self-unpair and preserves credentials on outage', async () => {
    const { claimed } = await pairAndAuth(userA, 'electron-self');
    const storage = createDesktopStorageMock({
      deviceId: claimed.deviceId,
      deviceName: 'Electron-Self',
      deviceToken: claimed.deviceToken,
      deviceGeneration: claimed.deviceGeneration,
      userId: userA._id.toString(),
      backendUrl: baseUrl,
      pairedAt: new Date().toISOString(),
    });

    const authClient = new DeviceAuthClient({ storageService: storage });
    const hbClient = new HeartbeatClient({ deviceAuthClient: authClient, intervalMs: 60000 });

    await authClient.authenticate();
    hbClient.start();
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(hbClient.getStatus().state, CONNECTION_STATES.ONLINE);

    // 1. Backend outage during unpair -> preserves credentials & reports pending
    authClient._backendUrl = 'http://127.0.0.1:1';
    const failedUnpair = await authClient.unpairDevice({ heartbeatClient: hbClient });
    assert.equal(failedUnpair.success, false);
    assert.equal(failedUnpair.remoteRevocationPending, true);
    assert.equal(storage.hasCredentials(), true);

    // 2. Restore backend -> self-unpair succeeds, stops heartbeat, clears DPAPI & tokens
    authClient._backendUrl = baseUrl;
    const okUnpair = await authClient.unpairDevice({ heartbeatClient: hbClient });
    assert.equal(okUnpair.success, true);
    assert.equal(okUnpair.unpaired, true);
    assert.equal(storage.hasCredentials(), false);
    assert.equal(authClient._accessToken, null);
    assert.equal(authClient._refreshToken, null);
    assert.equal(hbClient.getStatus().isRunning, false);

    const dbDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(dbDoc.isRevoked, true);
    assert.equal(dbDoc.isOnline, false);
  });
});
