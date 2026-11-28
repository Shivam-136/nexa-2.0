/**
 * NEXA 2.0 Desktop Agent - M3.4.6 Secure Device Unpair Tests
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { DeviceAuthClient } = require('../main/auth/deviceAuthClient');
const { HeartbeatClient, CONNECTION_STATES } = require('../main/heartbeat/heartbeatClient');
const { nexaDesktopAPI } = require('../preload/index');
const { isAllowedInvokeChannel } = require('../preload/channels');
const { registerIpcHandlers, unregisterIpcHandlers } = require('../main/ipc');
const { IPC_CHANNELS } = require('../main/config');

function createMockStorage({ credentials = null } = {}) {
  let stored = credentials ? { ...credentials } : null;
  let clearedCount = 0;
  return {
    isEncryptionAvailable: () => true,
    hasCredentials: () => Boolean(stored),
    getCredentials: () => (stored ? { ...stored } : null),
    clearCredentials: () => {
      stored = null;
      clearedCount += 1;
      return { success: true };
    },
    getClearedCount: () => clearedCount,
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

function createMockIpcMain() {
  const handlers = new Map();
  return {
    handle: (ch, fn) => handlers.set(ch, fn),
    removeHandler: (ch) => handlers.delete(ch),
    invoke: async (ch, ...args) => {
      const fn = handlers.get(ch);
      if (!fn) throw new Error(`No handler for ${ch}`);
      return await fn({ sender: {} }, ...args);
    },
  };
}

describe('NEXA 2.0 Desktop Agent — M3.4.6 Secure Device Unpair', () => {
  const secretDeviceToken = 'dpapi_secret_device_token_m346_1234567890abcdef1234567890';
  const secretAccessToken = 'jwt_secret_access_m346_xyz';
  const secretRefreshToken = 'jwt_secret_refresh_m346_abc';
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage({
      credentials: {
        deviceId: 'dev-desktop-m346-001',
        deviceName: 'Desktop-Unpair',
        deviceToken: secretDeviceToken,
        deviceGeneration: 1,
        userId: 'user-m346-001',
        backendUrl: 'http://127.0.0.1:5000',
        pairedAt: '2026-11-26T10:00:00.000Z',
      },
    });
  });

  it('whitelists device unpair IPC channel and freezes nexaDesktopAPI.deviceAuth.unpair', () => {
    assert.equal(isAllowedInvokeChannel('nexa:device-auth-unpair'), true);
    assert.equal(typeof nexaDesktopAPI.deviceAuth.unpair, 'function');
    assert.equal(Object.isFrozen(nexaDesktopAPI.deviceAuth), true);
  });

  it('stops heartbeat/reconnect, clears tokens & DPAPI credentials, and coalesces simultaneous unpair calls', async () => {
    let unpairCalls = 0;

    const authClient = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: secretAccessToken,
              refreshToken: secretRefreshToken,
              expiresIn: 900,
              deviceId: 'dev-desktop-m346-001',
              deviceGeneration: 1,
              userId: 'user-m346-001',
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
        if (url.endsWith('/api/v1/device/unpair')) {
          unpairCalls += 1;
          await new Promise((r) => setTimeout(r, 25));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              unpaired: true,
              unpairedAt: '2026-11-26T16:00:00.000Z',
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await authClient.authenticate();
    const hbClient = new HeartbeatClient({
      deviceAuthClient: authClient,
      intervalMs: 60000,
      initialReconnectDelayMs: 50,
    });
    hbClient.start();
    await new Promise((r) => setTimeout(r, 20));

    const [u1, u2] = await Promise.all([
      authClient.unpairDevice({ heartbeatClient: hbClient }),
      authClient.unpairDevice({ heartbeatClient: hbClient }),
    ]);

    assert.equal(unpairCalls, 1);
    assert.equal(u1.success, true);
    assert.equal(u1.unpaired, true);
    assert.equal(u2.unpaired, true);

    assert.equal(mockStorage.hasCredentials(), false);
    assert.equal(mockStorage.getClearedCount(), 1);
    assert.equal(authClient._accessToken, null);
    assert.equal(authClient._refreshToken, null);
    assert.equal(authClient.getAuthStatus().state, 'unpaired');
    assert.equal(hbClient.getStatus().isRunning, false);
    assert.equal(hbClient.getStatus().state, CONNECTION_STATES.OFFLINE);

    // Stale credentials cannot be reused after unpair
    await assert.rejects(() => authClient.authenticate(), /DEVICE_NOT_PAIRED/);
  });

  it('preserves DPAPI credentials and reports retryable pending state on backend outage', async () => {
    const authClient = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: secretAccessToken,
              refreshToken: secretRefreshToken,
              expiresIn: 900,
              deviceId: 'dev-desktop-m346-001',
              deviceGeneration: 1,
              userId: 'user-m346-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/unpair')) {
          throw new TypeError('fetch failed: ECONNREFUSED');
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await authClient.authenticate();
    const res = await authClient.unpairDevice();

    assert.equal(res.success, false);
    assert.equal(res.unpaired, false);
    assert.equal(res.remoteRevocationPending, true);
    assert.equal(res.retryable, true);
    assert.equal(mockStorage.hasCredentials(), true);
    assert.equal(mockStorage.getClearedCount(), 0);
  });

  it('executes unpair via IPC without ever leaking tokens to renderer', async () => {
    const authClient = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: secretAccessToken,
              refreshToken: secretRefreshToken,
              expiresIn: 900,
              deviceId: 'dev-desktop-m346-001',
              deviceGeneration: 1,
              userId: 'user-m346-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/unpair')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, unpaired: true }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const hbClient = new HeartbeatClient({ deviceAuthClient: authClient, intervalMs: 60000 });
    const ipcMock = createMockIpcMain();

    registerIpcHandlers({
      getMainWindow: () => null,
      onQuit: () => {},
      storageService: mockStorage,
      deviceAuthClient: authClient,
      heartbeatClient: hbClient,
      ipc: ipcMock,
    });

    const res = await ipcMock.invoke(IPC_CHANNELS.DEVICE_AUTH_UNPAIR);
    unregisterIpcHandlers(ipcMock);

    const serialized = JSON.stringify(res);
    assert.equal(res.success, true);
    assert.equal(res.unpaired, true);
    assert.equal(serialized.includes(secretDeviceToken), false);
    assert.equal(serialized.includes(secretAccessToken), false);
    assert.equal(serialized.includes(secretRefreshToken), false);
  });
});
