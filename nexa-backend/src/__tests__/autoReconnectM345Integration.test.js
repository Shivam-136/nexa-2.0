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

describe('NEXA 2.0 M3.4.5 — Auto Reconnect Integration (Electron Main -> Backend -> MongoDB)', () => {
  let user;
  let userToken;
  let server;
  let baseUrl;

  before(async () => {
    await startTestMongo(27029);
    user = await User.create({
      email: `m345_int_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'M345 Integration Owner',
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

  async function pairDesktop(suffix = 'm345') {
    const session = await initiatePairingSession({ userId: user._id.toString() });
    const deviceId = `dev-m345-${suffix}-${crypto.randomUUID()}`;
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

  it('automatically reconnects with exponential backoff after backend outage and updates MongoDB lastSeenAt', async () => {
    const { claimed, storage } = await pairDesktop('outage');
    const authClient = new DeviceAuthClient({ storageService: storage });
    const hbClient = new HeartbeatClient({
      deviceAuthClient: authClient,
      intervalMs: 60000,
      initialReconnectDelayMs: 40,
      backoffMultiplier: 2,
      maxReconnectDelayMs: 200,
      jitterFactor: 0,
    });

    await authClient.authenticate();
    const initialStatus = await hbClient.sendHeartbeat();
    assert.equal(initialStatus.state, CONNECTION_STATES.ONLINE);
    const savedHeartbeat = initialStatus.lastSuccessfulHeartbeatAt;

    // Simulate outage
    authClient._backendUrl = 'http://127.0.0.1:1';
    hbClient.start();
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(hbClient.getStatus().state, CONNECTION_STATES.RECONNECTING);
    assert.equal(hbClient.getStatus().lastSuccessfulHeartbeatAt, savedHeartbeat);

    // Restore backend -> backoff tick recovers automatically
    authClient._backendUrl = baseUrl;
    await new Promise((r) => setTimeout(r, 150));
    hbClient.stop();

    const finalStatus = hbClient.getStatus();
    assert.equal(finalStatus.state, CONNECTION_STATES.ONLINE);
    assert.equal(finalStatus.isOnline, true);
    assert.equal(finalStatus.consecutiveFailures, 0);

    const dbDoc = await Device.findOne({ deviceId: claimed.deviceId }).lean();
    assert.equal(dbDoc.isOnline, true);
    assert.ok(dbDoc.heartbeatCount >= 2);
  });

  it('stops pending reconnect permanently if device is revoked during outage', async () => {
    const { claimed, storage } = await pairDesktop('revoke-outage');
    const authClient = new DeviceAuthClient({ storageService: storage });
    const hbClient = new HeartbeatClient({
      deviceAuthClient: authClient,
      intervalMs: 60000,
      initialReconnectDelayMs: 40,
      jitterFactor: 0,
    });

    await authClient.authenticate();
    await hbClient.sendHeartbeat();

    // Simulate outage + pending reconnect
    authClient._backendUrl = 'http://127.0.0.1:1';
    hbClient.start();
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(hbClient.getStatus().state, CONNECTION_STATES.RECONNECTING);

    // Owner revokes device while desktop is reconnecting
    const revokeRes = await fetch(`${baseUrl}/api/v1/device/${claimed.deviceId}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    assert.equal(revokeRes.status, 200);

    // Restore connectivity -> next reconnect attempt hits 403 DEVICE_REVOKED and stops permanently
    authClient._backendUrl = baseUrl;
    await new Promise((r) => setTimeout(r, 120));

    const status = hbClient.getStatus();
    assert.equal(status.state, CONNECTION_STATES.REVOKED);
    assert.equal(status.permanentlyStopped, true);
    assert.equal(status.isRunning, false);
    assert.equal(hbClient.start(), false);
  });
});
