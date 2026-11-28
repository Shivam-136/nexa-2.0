/**
 * NEXA 2.0 Desktop Agent - M3.4.4 Token Refresh Lifecycle Tests
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DeviceAuthClient, REFRESH_LEEWAY_MS } = require('../main/auth/deviceAuthClient');
const { HeartbeatClient, CONNECTION_STATES } = require('../main/heartbeat/heartbeatClient');
const { SecureStorageService } = require('../main/storage/secureStorage');

function createMockStorage({ credentials = null, encryptionAvailable = true } = {}) {
  const stored = credentials ? { ...credentials } : null;
  return {
    isEncryptionAvailable: () => encryptionAvailable,
    hasCredentials: () => Boolean(stored),
    getCredentials: () => (stored ? { ...stored } : null),
    getDeviceInfo: () => ({
      isPaired: Boolean(stored),
      deviceId: stored?.deviceId || null,
      deviceName: stored?.deviceName || null,
      userId: stored?.userId || null,
      backendUrl: stored?.backendUrl || null,
      pairedAt: stored?.pairedAt || null,
    }),
  };
}

describe('NEXA 2.0 Desktop Agent — M3.4.4 Token Refresh Lifecycle', () => {
  const secretDeviceToken = 'dpapi_secret_device_token_m344_1234567890abcdef1234567890';
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage({
      credentials: {
        deviceId: 'dev-m344-001',
        deviceName: 'Desktop-M344',
        deviceToken: secretDeviceToken,
        deviceGeneration: 1,
        userId: 'user-m344-001',
        backendUrl: 'http://127.0.0.1:5000',
        pairedAt: '2026-11-26T10:00:00.000Z',
      },
    });
  });

  it('performs proactive access-token refresh within REFRESH_LEEWAY_MS without waiting for 401', async () => {
    let refreshCalls = 0;
    let heartbeatAuthHeader = null;

    const client = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url, opts) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'access_initial_near_expiry',
              refreshToken: 'refresh_initial_1',
              // Expires within leeway window
              expiresAt: new Date(Date.now() + Math.floor(REFRESH_LEEWAY_MS / 2)).toISOString(),
              deviceId: 'dev-m344-001',
              deviceGeneration: 1,
              userId: 'user-m344-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/auth/refresh')) {
          refreshCalls += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'access_proactive_rotated_2',
              refreshToken: 'refresh_proactive_rotated_2',
              expiresIn: 900,
              expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
              deviceId: 'dev-m344-001',
              deviceGeneration: 1,
              userId: 'user-m344-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/heartbeat')) {
          heartbeatAuthHeader = opts.headers.Authorization;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'ONLINE',
              isOnline: true,
              lastHeartbeatAt: new Date().toISOString(),
              heartbeatCount: 1,
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await client.authenticate();
    const hbClient = new HeartbeatClient({ deviceAuthClient: client, intervalMs: 60000 });
    const status = await hbClient.sendHeartbeat();

    assert.equal(refreshCalls, 1);
    assert.equal(heartbeatAuthHeader, 'Bearer access_proactive_rotated_2');
    assert.equal(status.state, CONNECTION_STATES.ONLINE);
  });

  it('coalesces concurrent authenticate() and concurrent refreshSession() calls into single HTTP requests', async () => {
    let authCalls = 0;
    let refreshCalls = 0;

    const client = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          authCalls += 1;
          await new Promise((r) => setTimeout(r, 25));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'access_single_flight_1',
              refreshToken: 'refresh_single_flight_1',
              expiresIn: 900,
              expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
              deviceId: 'dev-m344-001',
              deviceGeneration: 1,
              userId: 'user-m344-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/auth/refresh')) {
          refreshCalls += 1;
          await new Promise((r) => setTimeout(r, 25));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'access_single_flight_2',
              refreshToken: 'refresh_single_flight_2',
              expiresIn: 900,
              expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
              deviceId: 'dev-m344-001',
              deviceGeneration: 1,
              userId: 'user-m344-001',
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const authResults = await Promise.all([
      client.authenticate(),
      client.authenticate(),
      client.authenticate(),
    ]);
    assert.equal(authCalls, 1);
    assert.ok(authResults.every((r) => r.authenticated === true));

    const refreshResults = await Promise.all([
      client.refreshSession(),
      client.refreshSession(),
      client.refreshSession(),
    ]);
    assert.equal(refreshCalls, 1);
    assert.ok(refreshResults.every((r) => r.authenticated === true));
  });

  it('coordinates concurrent authenticatedFetch() 401s with a single refresh and prevents infinite retry loops', async () => {
    let refreshCalls = 0;
    let verifyCalls = 0;

    const client = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url, opts) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'access_expired_1',
              refreshToken: 'refresh_valid_1',
              expiresIn: 900,
              expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
              deviceId: 'dev-m344-001',
              deviceGeneration: 1,
              userId: 'user-m344-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/auth/refresh')) {
          refreshCalls += 1;
          await new Promise((r) => setTimeout(r, 20));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'access_fresh_2',
              refreshToken: 'refresh_fresh_2',
              expiresIn: 900,
              expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
              deviceId: 'dev-m344-001',
              deviceGeneration: 1,
              userId: 'user-m344-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/verify')) {
          verifyCalls += 1;
          if (opts.headers.Authorization === 'Bearer access_expired_1') {
            return {
              ok: false,
              status: 401,
              clone() { return this; },
              json: async () => ({
                success: false,
                code: 'DEVICE_TOKEN_EXPIRED',
                error: 'Expired',
              }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, authenticated: true }),
          };
        }
        if (url.endsWith('/api/v1/device/always-401')) {
          return {
            ok: false,
            status: 401,
            clone() { return this; },
            json: async () => ({
              success: false,
              code: 'DEVICE_TOKEN_EXPIRED',
              error: 'Still expired',
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await client.authenticate();
    const responses = await Promise.all([
      client.authenticatedFetch('/api/v1/device/verify'),
      client.authenticatedFetch('/api/v1/device/verify'),
      client.authenticatedFetch('/api/v1/device/verify'),
    ]);

    assert.equal(refreshCalls, 1);
    assert.equal(verifyCalls, 6);
    assert.ok(responses.every((r) => r.status === 200));

    // Verify no infinite loop when endpoint keeps returning 401
    const loopRes = await client.authenticatedFetch('/api/v1/device/always-401');
    assert.equal(loopRes.status, 401);
    assert.equal(refreshCalls, 2); // Only 1 extra refresh, never a loop
  });

  it('handles expired refresh token -> AUTHENTICATION_REQUIRED and clears session', async () => {
    const client = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'access_1',
              refreshToken: 'refresh_expired_1',
              expiresAt: new Date(Date.now() + 1000).toISOString(), // within leeway
              deviceId: 'dev-m344-001',
              deviceGeneration: 1,
              userId: 'user-m344-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/auth/refresh')) {
          return {
            ok: false,
            status: 401,
            json: async () => ({
              success: false,
              code: 'DEVICE_REFRESH_TOKEN_EXPIRED',
              error: 'Device refresh token has expired',
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await client.authenticate();
    const hbClient = new HeartbeatClient({ deviceAuthClient: client, intervalMs: 60000 });
    const status = await hbClient.sendHeartbeat();

    assert.equal(status.state, CONNECTION_STATES.AUTHENTICATION_REQUIRED);
    assert.equal(status.isOnline, false);
    assert.equal(client.getAuthStatus().authenticated, false);
  });

  it('preserves refresh token on network failure or 503 backend unavailable during refresh and recovers', async () => {
    let refreshMode = 'network_fail';
    let refreshCalls = 0;

    const client = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'access_1',
              refreshToken: 'refresh_preserved_1',
              expiresAt: new Date(Date.now() + 1000).toISOString(), // within leeway
              deviceId: 'dev-m344-001',
              deviceGeneration: 1,
              userId: 'user-m344-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/auth/refresh')) {
          refreshCalls += 1;
          if (refreshMode === 'network_fail') {
            throw new TypeError('fetch failed: ECONNREFUSED');
          }
          if (refreshMode === 'unavailable_503') {
            return {
              ok: false,
              status: 503,
              json: async () => ({ success: false, error: 'Service temporarily unavailable' }),
            };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'access_recovered_2',
              refreshToken: 'refresh_recovered_2',
              expiresIn: 900,
              expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
              deviceId: 'dev-m344-001',
              deviceGeneration: 1,
              userId: 'user-m344-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/heartbeat')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'ONLINE',
              isOnline: true,
              lastHeartbeatAt: new Date().toISOString(),
              heartbeatCount: 1,
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await client.authenticate();
    const hbClient = new HeartbeatClient({ deviceAuthClient: client, intervalMs: 60000 });

    // 1. Network failure during refresh -> RECONNECTING, refresh token preserved
    const netFail = await hbClient.sendHeartbeat();
    assert.equal(netFail.state, CONNECTION_STATES.RECONNECTING);
    assert.equal(client._refreshToken, 'refresh_preserved_1');

    // 2. Backend 503 during refresh -> RECONNECTING, refresh token still preserved
    refreshMode = 'unavailable_503';
    const unavailable = await hbClient.sendHeartbeat();
    assert.equal(unavailable.state, CONNECTION_STATES.RECONNECTING);
    assert.equal(client._refreshToken, 'refresh_preserved_1');

    // 3. Recovery -> refresh succeeds, heartbeat succeeds -> ONLINE
    refreshMode = 'ok';
    const recovered = await hbClient.sendHeartbeat();
    assert.equal(recovered.state, CONNECTION_STATES.ONLINE);
    assert.equal(recovered.isOnline, true);
    assert.equal(refreshCalls, 3);
  });

  it('stops heartbeat permanently on quarantined device during refresh and clears session on logout/restart', async () => {
    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-m344-restart-'));
    const mockSafeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (s) => Buffer.from(`dpapi:${Buffer.from(s, 'utf8').toString('base64')}`, 'utf8'),
      decryptString: (b) => Buffer.from(b.toString('utf8').slice(6), 'base64').toString('utf8'),
    };

    const storage1 = new SecureStorageService({ storageDir, safeStorageInstance: mockSafeStorage });
    storage1.init();
    storage1.saveCredentials({
      deviceId: 'dev-m344-restart',
      deviceName: 'Restart-M344',
      deviceToken: secretDeviceToken,
      deviceGeneration: 2,
      userId: 'user-m344-001',
      backendUrl: 'http://127.0.0.1:5000',
    });

    // Simulate restart
    const storage2 = new SecureStorageService({ storageDir, safeStorageInstance: mockSafeStorage });
    storage2.init();

    let logoutCalled = false;
    const client = new DeviceAuthClient({
      storageService: storage2,
      fetchImpl: async (url) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'access_restart_1',
              refreshToken: 'refresh_restart_1',
              expiresAt: new Date(Date.now() + 1000).toISOString(),
              deviceId: 'dev-m344-restart',
              deviceGeneration: 2,
              userId: 'user-m344-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/auth/logout')) {
          logoutCalled = true;
          return { ok: true, status: 200, json: async () => ({ success: true }) };
        }
        if (url.endsWith('/api/v1/device/auth/refresh')) {
          return {
            ok: false,
            status: 403,
            json: async () => ({
              success: false,
              code: 'DEVICE_QUARANTINED',
              error: 'DEVICE_QUARANTINED: Device is quarantined',
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await client.authenticate();
    const hbClient = new HeartbeatClient({ deviceAuthClient: client, intervalMs: 60000 });
    const quarantined = await hbClient.sendHeartbeat();

    assert.equal(quarantined.state, CONNECTION_STATES.REVOKED);
    assert.equal(quarantined.permanentlyStopped, true);
    assert.equal(hbClient.start(), false);

    // Logout clears session tokens
    await client.logout();
    assert.equal(logoutCalled, false); // already cleared on revocation
    assert.equal(client._accessToken, null);
    assert.equal(client._refreshToken, null);

    fs.rmSync(storageDir, { recursive: true, force: true });
  });
});
