import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

import app from '../app.js';
import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import User from '../models/user.model.js';
import { signAccessToken } from '../utils/auth.utils.js';
import { signDeviceAccessToken } from '../utils/deviceAuth.utils.js';
import { initiatePairingSession, claimPairingSession } from '../services/pairing.service.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';

const require = createRequire(import.meta.url);
const { DeviceAuthClient } = require('../../../nexa-desktop/src/main/auth/deviceAuthClient.js');
const { HeartbeatClient, CONNECTION_STATES } = require('../../../nexa-desktop/src/main/heartbeat/heartbeatClient.js');

function createDesktopStorageMock({ credentials }) {
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

describe('NEXA 2.0 Integration — Electron Main -> Backend -> MongoDB Heartbeat', () => {
  let user;
  let userToken;
  let server;
  let baseUrl;

  before(async () => {
    await startTestMongo(27027);
    user = await User.create({
      email: `hb_int_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'Integration Owner',
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

  async function setupPairedDesktopClients(suffix = 'int') {
    const session = await initiatePairingSession({ userId: user._id.toString() });
    const deviceId = `dev-int-${suffix}-${crypto.randomUUID()}`;
    const claimed = await claimPairingSession({
      pairingCode: session.pairingCode,
      deviceId,
      deviceName: `Desktop-${suffix}`,
    });

    const storage = createDesktopStorageMock({
      credentials: {
        deviceId: claimed.deviceId,
        deviceName: `Desktop-${suffix}`,
        deviceToken: claimed.deviceToken,
        deviceGeneration: claimed.deviceGeneration,
        userId: user._id.toString(),
        backendUrl: baseUrl,
        pairedAt: new Date().toISOString(),
      },
    });

    const authClient = new DeviceAuthClient({ storageService: storage });
    const hbClient = new HeartbeatClient({
      deviceAuthClient: authClient,
      intervalMs: 60000,
      timeoutMs: 3000,
    });

    return { claimed, authClient, hbClient };
  }

  it('authenticates Electron DeviceAuthClient, sends HeartbeatClient ping, updates MongoDB lastSeenAt, and reflects ONLINE in dashboard status API', async () => {
    const { claimed, authClient, hbClient } = await setupPairedDesktopClients('online');
    const beforeDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(beforeDoc.isOnline, false);

    await authClient.authenticate();
    await new Promise((r) => setTimeout(r, 15));

    const hbStatus = await hbClient.sendHeartbeat();
    assert.equal(hbStatus.state, CONNECTION_STATES.ONLINE);
    assert.equal(hbStatus.isOnline, true);
    assert.ok(hbStatus.lastSuccessfulHeartbeatAt);

    const afterDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(afterDoc.isOnline, true);
    assert.equal(afterDoc.heartbeatCount, 1);
    assert.ok(new Date(afterDoc.lastSeenAt).getTime() > new Date(beforeDoc.lastSeenAt).getTime());

    // Verify Dashboard API (/api/v1/pairing/status) returns real MongoDB online state
    const dashRes = await fetch(`${baseUrl}/api/v1/pairing/status`, {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    const dashBody = await dashRes.json();
    assert.equal(dashRes.status, 200);
    assert.equal(dashBody.connectedDevices.length, 1);
    assert.equal(dashBody.connectedDevices[0].isOnline, true);
    assert.equal(dashBody.connectedDevices[0].connectionState, 'ONLINE');
    assert.ok(dashBody.connectedDevices[0].lastSeenAt);
  });

  it('handles expired access token refresh end-to-end against real backend and MongoDB', async () => {
    const { claimed, authClient, hbClient } = await setupPairedDesktopClients('refresh');
    await authClient.authenticate();

    // Force an expired access token while keeping valid refresh token
    authClient._accessToken = signDeviceAccessToken(
      {
        deviceId: claimed.deviceId,
        userId: user._id.toString(),
        deviceGeneration: claimed.deviceGeneration,
      },
      '-10s'
    );
    authClient._accessTokenExpiresAt = Date.now() + 600000; // bypass proactive refresh to test 401 retry path

    const status = await hbClient.sendHeartbeat();
    assert.equal(status.state, CONNECTION_STATES.ONLINE);
    assert.equal(status.isOnline, true);

    const dbDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(dbDoc.isOnline, true);
    assert.equal(dbDoc.heartbeatCount, 1);
  });

  it('transitions to REVOKED and stops permanently when device is revoked in MongoDB', async () => {
    const { claimed, authClient, hbClient } = await setupPairedDesktopClients('revoked');
    await authClient.authenticate();

    const first = await hbClient.sendHeartbeat();
    assert.equal(first.state, CONNECTION_STATES.ONLINE);

    // Owner revokes device via backend API
    const revokeRes = await fetch(`${baseUrl}/api/v1/device/${claimed.deviceId}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(revokeRes.status, 200);

    const second = await hbClient.sendHeartbeat();
    assert.equal(second.state, CONNECTION_STATES.REVOKED);
    assert.equal(second.isOnline, false);
    assert.equal(second.permanentlyStopped, true);
    assert.equal(hbClient.start(), false);
  });

  it('transitions to RECONNECTING on network failure and recovers to ONLINE when backend is reachable', async () => {
    const { claimed, authClient, hbClient } = await setupPairedDesktopClients('reconnect');
    await authClient.authenticate();

    const ok1 = await hbClient.sendHeartbeat();
    assert.equal(ok1.state, CONNECTION_STATES.ONLINE);
    const savedHeartbeatAt = ok1.lastSuccessfulHeartbeatAt;

    // Simulate unreachable backend URL temporarily
    const realUrl = authClient._backendUrl;
    authClient._backendUrl = 'http://127.0.0.1:1';

    const failed = await hbClient.sendHeartbeat();
    assert.equal(failed.state, CONNECTION_STATES.RECONNECTING);
    assert.equal(failed.isOnline, false);
    assert.equal(failed.lastSuccessfulHeartbeatAt, savedHeartbeatAt);

    // Restore backend URL and verify recovery
    authClient._backendUrl = realUrl;
    const recovered = await hbClient.sendHeartbeat();
    assert.equal(recovered.state, CONNECTION_STATES.ONLINE);
    assert.equal(recovered.isOnline, true);

    const dbDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(dbDoc.heartbeatCount, 2);
  });
});
