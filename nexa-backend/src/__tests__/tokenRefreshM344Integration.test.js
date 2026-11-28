import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import app from '../app.js';
import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import User from '../models/user.model.js';
import { signDeviceAccessToken } from '../utils/deviceAuth.utils.js';
import { initiatePairingSession, claimPairingSession } from '../services/pairing.service.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';

const require = createRequire(import.meta.url);
const { DeviceAuthClient } = require('../../../nexa-desktop/src/main/auth/deviceAuthClient.js');
const { HeartbeatClient, CONNECTION_STATES } = require('../../../nexa-desktop/src/main/heartbeat/heartbeatClient.js');

function createDesktopStorageMock(credentials) {
  return {
    isEncryptionAvailable: () => true,
    hasCredentials: () => Boolean(credentials),
    getCredentials: () => (credentials ? { ...credentials } : null),
    getDeviceInfo: () => ({
      isPaired: Boolean(credentials),
      deviceId: credentials?.deviceId || null,
      deviceName: credentials?.deviceName || null,
      userId: credentials?.userId || null,
      backendUrl: credentials?.backendUrl || null,
      pairedAt: credentials?.pairedAt || null,
    }),
  };
}

describe('NEXA 2.0 M3.4.4 — Token Refresh Lifecycle Integration (Electron Main -> Backend -> MongoDB)', () => {
  let user;
  let server;
  let baseUrl;

  before(async () => {
    await startTestMongo(27028);
    user = await User.create({
      email: `m344_int_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'M344 Integration Owner',
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

  async function pairDesktop(suffix = 'm344') {
    const session = await initiatePairingSession({ userId: user._id.toString() });
    const deviceId = `dev-m344-${suffix}-${crypto.randomUUID()}`;
    const claimed = await claimPairingSession({
      pairingCode: session.pairingCode,
      deviceId,
      deviceName: `Desktop-${suffix}`,
    });

    const storage = createDesktopStorageMock({
      deviceId: claimed.deviceId,
      deviceName: `Desktop-${suffix}`,
      deviceToken: claimed.deviceToken,
      deviceGeneration: claimed.deviceGeneration,
      userId: user._id.toString(),
      backendUrl: baseUrl,
      pairedAt: new Date().toISOString(),
    });

    return { claimed, storage };
  }

  it('continues heartbeat seamlessly across proactive refresh and concurrent API calls against MongoDB', async () => {
    const { claimed, storage } = await pairDesktop('concurrent');
    const authClient = new DeviceAuthClient({ storageService: storage });
    const hbClient = new HeartbeatClient({ deviceAuthClient: authClient, intervalMs: 60000 });

    await authClient.authenticate();
    const initialRefresh = authClient._refreshToken;

    // Simulate expired access token while concurrent API calls + heartbeat run
    authClient._accessToken = signDeviceAccessToken(
      {
        deviceId: claimed.deviceId,
        userId: user._id.toString(),
        deviceGeneration: claimed.deviceGeneration,
      },
      '-10s'
    );
    authClient._accessTokenExpiresAt = Date.now() + 600000;

    const [meRes, verifyRes, hbStatus] = await Promise.all([
      authClient.authenticatedFetch('/api/v1/device/me'),
      authClient.authenticatedFetch('/api/v1/device/verify'),
      hbClient.sendHeartbeat(),
    ]);

    assert.equal(meRes.status, 200);
    assert.equal(verifyRes.status, 200);
    assert.equal(hbStatus.state, CONNECTION_STATES.ONLINE);
    assert.equal(hbStatus.isOnline, true);
    assert.notEqual(authClient._refreshToken, initialRefresh);

    const doc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(doc.isOnline, true);
    assert.equal(doc.heartbeatCount, 1);
  });

  it('revokes entire token family and marks device offline in MongoDB on refresh-token replay', async () => {
    const { claimed, storage } = await pairDesktop('replay');
    const authClient = new DeviceAuthClient({ storageService: storage });
    const hbClient = new HeartbeatClient({ deviceAuthClient: authClient, intervalMs: 60000 });

    await authClient.authenticate();
    const leakedRefreshToken = authClient._refreshToken;

    // Legitimate heartbeat + rotation
    await hbClient.sendHeartbeat();
    await authClient.refreshSession();
    const activeDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(activeDoc.isOnline, true);

    // Replay leaked old refresh token -> must wipe entire family and mark isOnline: false
    const replayRes = await fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: leakedRefreshToken }),
    });
    const replayBody = await replayRes.json();
    assert.equal(replayRes.status, 401);
    assert.equal(replayBody.code, 'DEVICE_TOKEN_REUSE_DETECTED');

    const wipedDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(wipedDoc.deviceRefreshTokens.length, 0);
    assert.equal(wipedDoc.isOnline, false);
  });

  it('rejects quarantined device on refresh and re-authenticates cleanly after simulated restart', async () => {
    const { claimed, storage } = await pairDesktop('quarantine-restart');
    const authClient1 = new DeviceAuthClient({ storageService: storage });
    const hbClient1 = new HeartbeatClient({ deviceAuthClient: authClient1, intervalMs: 60000 });

    await authClient1.authenticate();
    await hbClient1.sendHeartbeat();

    // Quarantine device in MongoDB
    await Device.updateOne({ deviceId: claimed.deviceId }, { $set: { isQuarantined: true } });
    authClient1._accessTokenExpiresAt = Date.now() + 1000; // trigger proactive refresh

    const qStatus = await hbClient1.sendHeartbeat();
    assert.equal(qStatus.state, CONNECTION_STATES.REVOKED);
    assert.equal(qStatus.permanentlyStopped, true);

    // Unquarantine and simulate Electron restart with fresh client instances
    await Device.updateOne({ deviceId: claimed.deviceId }, { $set: { isQuarantined: false } });
    const authClient2 = new DeviceAuthClient({ storageService: storage });
    const hbClient2 = new HeartbeatClient({ deviceAuthClient: authClient2, intervalMs: 60000 });

    await authClient2.authenticate();
    const resumedStatus = await hbClient2.sendHeartbeat();
    assert.equal(resumedStatus.state, CONNECTION_STATES.ONLINE);
    assert.equal(resumedStatus.isOnline, true);
  });
});
