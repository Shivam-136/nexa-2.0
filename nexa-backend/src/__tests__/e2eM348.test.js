import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

import app from '../app.js';
import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import User from '../models/user.model.js';
import { signAccessToken } from '../utils/auth.utils.js';
import { signDeviceAccessToken } from '../utils/deviceAuth.utils.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';
import {
  resolveDeviceStatus,
  computeDeviceOverview,
} from '../../../nexa-frontend/src/utils/deviceStatus.js';

const require = createRequire(import.meta.url);
const { SecureStorageService } = require('../../../nexa-desktop/src/main/storage/secureStorage.js');
const { PairingClient } = require('../../../nexa-desktop/src/main/pairing/pairingClient.js');
const { DeviceAuthClient } = require('../../../nexa-desktop/src/main/auth/deviceAuthClient.js');
const { HeartbeatClient, CONNECTION_STATES } = require('../../../nexa-desktop/src/main/heartbeat/heartbeatClient.js');

function createMockSafeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (str) => Buffer.from(`dpapi:${Buffer.from(str, 'utf8').toString('base64')}`, 'utf8'),
    decryptString: (buf) => {
      const s = buf.toString('utf8');
      if (!s.startsWith('dpapi:')) throw new Error('Invalid DPAPI envelope');
      return Buffer.from(s.slice(6), 'base64').toString('utf8');
    },
  };
}

describe('NEXA 2.0 M3.4.8 — Complete Device Lifecycle E2E (Frontend -> Backend -> MongoDB -> Electron)', () => {
  let userA;
  let userB;
  let userAToken;
  let userBToken;
  let server;
  let baseUrl;
  let tempDirs = [];

  before(async () => {
    await startTestMongo(27032);
    userA = await User.create({
      email: `e2e_a_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'E2E Owner A',
    });
    userB = await User.create({
      email: `e2e_b_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'E2E Owner B',
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
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await stopTestMongo();
  });

  beforeEach(async () => {
    await PairingSession.deleteMany({});
    await Device.deleteMany({});
  });

  async function pairDesktopAgent(ownerToken, deviceName) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-e2e-'));
    tempDirs.push(dir);
    const storage = new SecureStorageService({
      storageDir: dir,
      safeStorageInstance: createMockSafeStorage(),
    });
    storage.init();

    // 1. User initiates pairing from web dashboard API
    const initRes = await fetch(`${baseUrl}/api/v1/pairing/initiate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ownerToken}`,
      },
      body: JSON.stringify({}),
    });
    const initBody = await initRes.json();
    assert.equal(initRes.status, 201);
    assert.ok(initBody.pairingCode);

    // 2. Electron Main PairingClient claims pairing code & stores credentials in SecureStorageService
    const pairingClient = new PairingClient({ storageService: storage });
    const claimRes = await pairingClient.claimPairing({
      pairingCode: initBody.pairingCode,
      deviceName,
      backendUrl: baseUrl,
    });
    assert.equal(claimRes.success, true);
    assert.equal(storage.hasCredentials(), true);

    const authClient = new DeviceAuthClient({ storageService: storage });
    const hbClient = new HeartbeatClient({
      deviceAuthClient: authClient,
      intervalMs: 60000,
      initialReconnectDelayMs: 40,
      jitterFactor: 0,
    });

    return { dir, storage, pairingClient, authClient, hbClient, claimRes };
  }

  it('executes full multi-user & multi-device E2E: Pairing -> Auth -> Heartbeat -> Refresh -> Reconnect -> Unpair -> Dashboard Overview', async () => {
    // 1. Pair Desktop A1, Desktop A2 (User A) and Desktop B1 (User B)
    const a1 = await pairDesktopAgent(userAToken, 'Desktop-A1');
    const a2 = await pairDesktopAgent(userAToken, 'Desktop-A2');
    const b1 = await pairDesktopAgent(userBToken, 'Desktop-B1');

    // 2. Authenticate all 3 devices and send heartbeats
    await Promise.all([
      a1.authClient.authenticate(),
      a2.authClient.authenticate(),
      b1.authClient.authenticate(),
    ]);
    await Promise.all([
      a1.hbClient.sendHeartbeat(),
      a2.hbClient.sendHeartbeat(),
      b1.hbClient.sendHeartbeat(),
    ]);

    assert.equal(a1.hbClient.getStatus().state, CONNECTION_STATES.ONLINE);
    assert.equal(a2.hbClient.getStatus().state, CONNECTION_STATES.ONLINE);
    assert.equal(b1.hbClient.getStatus().state, CONNECTION_STATES.ONLINE);

    // 3. Token Refresh E2E on A1 (expired access token -> single-flight rotation -> heartbeat continues)
    const a1InitialRefresh = a1.authClient._refreshToken;
    a1.authClient._accessToken = signDeviceAccessToken(
      {
        deviceId: a1.claimRes.deviceInfo.deviceId,
        userId: userA._id.toString(),
        deviceGeneration: 1,
      },
      '-10s'
    );
    a1.authClient._accessTokenExpiresAt = Date.now() + 600000;
    const hbAfterRefresh = await a1.hbClient.sendHeartbeat();
    assert.equal(hbAfterRefresh.state, CONNECTION_STATES.ONLINE);
    assert.notEqual(a1.authClient._refreshToken, a1InitialRefresh);

    // 4. Auto Reconnect E2E on A2 (outage -> RECONNECTING -> restored -> ONLINE)
    const a2SavedHb = a2.hbClient.getStatus().lastSuccessfulHeartbeatAt;
    a2.authClient._backendUrl = 'http://127.0.0.1:1';
    a2.hbClient.start();
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(a2.hbClient.getStatus().state, CONNECTION_STATES.RECONNECTING);
    assert.equal(a2.hbClient.getStatus().lastSuccessfulHeartbeatAt, a2SavedHb);

    a2.authClient._backendUrl = baseUrl;
    await new Promise((r) => setTimeout(r, 120));
    a2.hbClient.stop();
    assert.equal(a2.hbClient.getStatus().state, CONNECTION_STATES.ONLINE);

    // 5. Multi-device isolation: User B cannot unpair User A's A1; User A sees only A1 & A2
    const crossUnpair = await fetch(`${baseUrl}/api/v1/device/${a1.claimRes.deviceInfo.deviceId}/unpair`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    assert.equal(crossUnpair.status, 403);

    // 6. User A unpairs A1 via Electron unpairDevice() (verifies remote revocation + DPAPI deletion)
    const unpairRes = await a1.authClient.unpairDevice({ heartbeatClient: a1.hbClient });
    assert.equal(unpairRes.success, true);
    assert.equal(unpairRes.unpaired, true);
    assert.equal(a1.storage.hasCredentials(), false);
    assert.equal(a1.authClient._accessToken, null);
    assert.equal(a1.authClient._refreshToken, null);
    assert.equal(a1.hbClient.getStatus().isRunning, false);

    // A2 & B1 remain completely unaffected
    const a2Hb = await a2.hbClient.sendHeartbeat();
    const b1Hb = await b1.hbClient.sendHeartbeat();
    assert.equal(a2Hb.state, CONNECTION_STATES.ONLINE);
    assert.equal(b1Hb.state, CONNECTION_STATES.ONLINE);

    // 7. Frontend Device Management API & Status/Overview computation against real backend data
    const dashA = await fetch(`${baseUrl}/api/v1/pairing/status`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    }).then((r) => r.json());

    const overviewA = computeDeviceOverview(dashA.connectedDevices, dashA.revokedDevices);
    assert.deepEqual(overviewA, {
      totalPaired: 1,
      online: 1,
      offline: 0,
      revokedOrUnpaired: 1,
    });
    assert.equal(dashA.connectedDevices[0].deviceId, a2.claimRes.deviceInfo.deviceId);
    assert.equal(resolveDeviceStatus(dashA.connectedDevices[0]).state, 'ONLINE');
    assert.equal(dashA.revokedDevices[0].deviceId, a1.claimRes.deviceInfo.deviceId);
    assert.equal(resolveDeviceStatus(dashA.revokedDevices[0]).state, 'UNPAIRED');

    const dashB = await fetch(`${baseUrl}/api/v1/pairing/status`, {
      headers: { Authorization: `Bearer ${userBToken}` },
    }).then((r) => r.json());
    assert.equal(dashB.connectedDevices.length, 1);
    assert.equal(dashB.connectedDevices[0].deviceId, b1.claimRes.deviceInfo.deviceId);
    assert.equal(dashB.revokedDevices.length, 0);
  });
});
