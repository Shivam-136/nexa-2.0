/**
 * NEXA 2.0 Desktop Agent - HeartbeatClient, Connection State & IPC Isolation Tests (M3.4.3)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { DeviceAuthClient } = require('../main/auth/deviceAuthClient');
const { HeartbeatClient, CONNECTION_STATES } = require('../main/heartbeat/heartbeatClient');
const { nexaDesktopAPI } = require('../preload/index');
const { isAllowedInvokeChannel, isAllowedReceiveChannel } = require('../preload/channels');
const { registerIpcHandlers, unregisterIpcHandlers } = require('../main/ipc');
const { IPC_CHANNELS } = require('../main/config');

function createMockStorage({ credentials = null, encryptionAvailable = true } = {}) {
  const stored = credentials ? { ...credentials } : null;
  return {
    isEncryptionAvailable: () => encryptionAvailable,
    hasCredentials: () => Boolean(stored),
    getCredentials: () => (stored ? { ...stored } : null),
    getDeviceInfo: () => {
      if (!stored) {
        return { isPaired: false, deviceId: null, deviceName: null, userId: null, backendUrl: null, pairedAt: null };
      }
      return {
        isPaired: true,
        deviceId: stored.deviceId,
        deviceName: stored.deviceName,
        userId: stored.userId,
        backendUrl: stored.backendUrl,
        pairedAt: stored.pairedAt,
      };
    },
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

describe('NEXA 2.0 Desktop Agent — M3.4.3 HeartbeatClient & Connection State', () => {
  const secretDeviceToken = 'dpapi_secret_device_token_1234567890abcdef1234567890abcdef';
  const secretAccessToken = 'jwt_secret_device_access_token_xyz_1234567890';
  const secretRefreshToken = 'jwt_secret_device_refresh_token_abc_0987654321';

  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage({
      encryptionAvailable: true,
      credentials: {
        deviceId: 'dev-desktop-m343-001',
        deviceName: 'Desktop-Heartbeat',
        deviceToken: secretDeviceToken,
        deviceGeneration: 1,
        userId: 'user-owner-001',
        backendUrl: 'http://127.0.0.1:5000',
        pairedAt: '2026-11-26T10:00:00.000Z',
      },
    });
  });

  it('whitelists heartbeat IPC channels and freezes nexaDesktopAPI.heartbeat', () => {
    assert.equal(isAllowedInvokeChannel('nexa:heartbeat-get-status'), true);
    assert.equal(isAllowedInvokeChannel('nexa:heartbeat-start'), true);
    assert.equal(isAllowedInvokeChannel('nexa:heartbeat-stop'), true);
    assert.equal(isAllowedInvokeChannel('nexa:heartbeat-send-now'), true);
    assert.equal(isAllowedReceiveChannel('nexa:heartbeat-status-changed'), true);

    assert.equal(typeof nexaDesktopAPI.heartbeat, 'object');
    assert.equal(Object.isFrozen(nexaDesktopAPI.heartbeat), true);
    assert.equal(typeof nexaDesktopAPI.heartbeat.getStatus, 'function');
    assert.equal(typeof nexaDesktopAPI.heartbeat.start, 'function');
    assert.equal(typeof nexaDesktopAPI.heartbeat.stop, 'function');
    assert.equal(typeof nexaDesktopAPI.heartbeat.sendNow, 'function');
    assert.equal(typeof nexaDesktopAPI.heartbeat.onStatusChange, 'function');
  });

  it('starts heartbeat after authentication and transitions CONNECTING -> ONLINE', async () => {
    const stateHistory = [];
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
              deviceId: 'dev-desktop-m343-001',
              deviceGeneration: 1,
              userId: 'user-owner-001',
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
              deviceId: 'dev-desktop-m343-001',
              deviceGeneration: 1,
              isOnline: true,
              lastSeenAt: '2026-11-26T12:00:00.000Z',
              lastHeartbeatAt: '2026-11-26T12:00:00.000Z',
              heartbeatCount: 1,
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
      onStateChange: (s) => stateHistory.push(s.state),
    });

    hbClient.start();
    // Wait for immediate async heartbeat
    await new Promise((r) => setTimeout(r, 30));
    hbClient.stop();

    assert.ok(stateHistory.includes(CONNECTION_STATES.CONNECTING));
    assert.equal(stateHistory[stateHistory.length - 1], CONNECTION_STATES.ONLINE);
    const status = hbClient.getStatus();
    assert.equal(status.isOnline, true);
    assert.equal(status.lastSuccessfulHeartbeatAt, '2026-11-26T12:00:00.000Z');
    assert.equal(status.heartbeatCount, 1);
  });

  it('prevents overlapping heartbeat requests via single-flight deduplication', async () => {
    let heartbeatCalls = 0;
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
              deviceId: 'dev-desktop-m343-001',
              deviceGeneration: 1,
              userId: 'user-owner-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/heartbeat')) {
          heartbeatCalls += 1;
          await new Promise((r) => setTimeout(r, 40));
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'ONLINE',
              isOnline: true,
              lastHeartbeatAt: '2026-11-26T12:01:00.000Z',
              heartbeatCount: 1,
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await authClient.authenticate();
    const hbClient = new HeartbeatClient({ deviceAuthClient: authClient, intervalMs: 60000 });

    const [r1, r2, r3] = await Promise.all([
      hbClient.sendHeartbeat(),
      hbClient.sendHeartbeat(),
      hbClient.sendHeartbeat(),
    ]);

    assert.equal(heartbeatCalls, 1);
    assert.equal(r1.state, CONNECTION_STATES.ONLINE);
    assert.equal(r2.state, CONNECTION_STATES.ONLINE);
    assert.equal(r3.state, CONNECTION_STATES.ONLINE);
  });

  it('handles network failure -> RECONNECTING, timeout -> OFFLINE, and successful reconnect -> ONLINE', async () => {
    let mode = 'success';
    const authClient = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url, opts) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: secretAccessToken,
              refreshToken: secretRefreshToken,
              expiresIn: 900,
              deviceId: 'dev-desktop-m343-001',
              deviceGeneration: 1,
              userId: 'user-owner-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/heartbeat')) {
          if (mode === 'network_fail') {
            throw new TypeError('fetch failed: ECONNREFUSED');
          }
          if (mode === 'timeout') {
            return await new Promise((_resolve, reject) => {
              opts.signal.addEventListener('abort', () => {
                const err = new Error('The operation was aborted');
                err.name = 'AbortError';
                reject(err);
              });
            });
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'ONLINE',
              isOnline: true,
              lastHeartbeatAt: '2026-11-26T12:05:00.000Z',
              heartbeatCount: 2,
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
      timeoutMs: 60,
    });

    // 1. Initial success
    const ok1 = await hbClient.sendHeartbeat();
    assert.equal(ok1.state, CONNECTION_STATES.ONLINE);
    const initialSuccessTime = ok1.lastSuccessfulHeartbeatAt;

    // 2. Network failure -> RECONNECTING, lastSuccessfulHeartbeatAt unchanged
    mode = 'network_fail';
    const netFail = await hbClient.sendHeartbeat();
    assert.equal(netFail.state, CONNECTION_STATES.RECONNECTING);
    assert.equal(netFail.isOnline, false);
    assert.equal(netFail.lastSuccessfulHeartbeatAt, initialSuccessTime);
    assert.ok(netFail.lastError);

    // 3. Timeout -> OFFLINE, lastSuccessfulHeartbeatAt unchanged
    mode = 'timeout';
    const timedOut = await hbClient.sendHeartbeat();
    assert.equal(timedOut.state, CONNECTION_STATES.OFFLINE);
    assert.equal(timedOut.isOnline, false);
    assert.equal(timedOut.lastSuccessfulHeartbeatAt, initialSuccessTime);

    // 4. Reconnect -> ONLINE, lastError cleared
    mode = 'success';
    const recovered = await hbClient.sendHeartbeat();
    assert.equal(recovered.state, CONNECTION_STATES.ONLINE);
    assert.equal(recovered.isOnline, true);
    assert.equal(recovered.lastError, null);
    assert.equal(recovered.lastSuccessfulHeartbeatAt, '2026-11-26T12:05:00.000Z');
  });

  it('refreshes expired access token once and completes heartbeat', async () => {
    let refreshCalled = 0;
    let heartbeatAttempts = 0;
    const rotatedAccessToken = 'jwt_rotated_access_token_new_12345';
    const rotatedRefreshToken = 'jwt_rotated_refresh_token_new_67890';

    const authClient = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url, opts) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: secretAccessToken,
              refreshToken: secretRefreshToken,
              expiresIn: 900,
              deviceId: 'dev-desktop-m343-001',
              deviceGeneration: 1,
              userId: 'user-owner-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/auth/refresh')) {
          refreshCalled += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: rotatedAccessToken,
              refreshToken: rotatedRefreshToken,
              expiresIn: 900,
              deviceId: 'dev-desktop-m343-001',
              deviceGeneration: 1,
              userId: 'user-owner-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/heartbeat')) {
          heartbeatAttempts += 1;
          if (opts.headers.Authorization === `Bearer ${secretAccessToken}`) {
            return {
              ok: false,
              status: 401,
              clone() { return this; },
              json: async () => ({
                success: false,
                code: 'DEVICE_TOKEN_EXPIRED',
                error: 'Device access token has expired',
              }),
            };
          }
          assert.equal(opts.headers.Authorization, `Bearer ${rotatedAccessToken}`);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'ONLINE',
              isOnline: true,
              lastHeartbeatAt: '2026-11-26T12:10:00.000Z',
              heartbeatCount: 1,
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await authClient.authenticate();
    const hbClient = new HeartbeatClient({ deviceAuthClient: authClient, intervalMs: 60000 });
    const status = await hbClient.sendHeartbeat();

    assert.equal(refreshCalled, 1);
    assert.equal(heartbeatAttempts, 2);
    assert.equal(status.state, CONNECTION_STATES.ONLINE);
    assert.equal(status.isOnline, true);
  });

  it('stops permanently for revoked or quarantined devices and refuses auto-reconnect', async () => {
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
              deviceId: 'dev-desktop-m343-001',
              deviceGeneration: 1,
              userId: 'user-owner-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/heartbeat')) {
          return {
            ok: false,
            status: 403,
            json: async () => ({
              success: false,
              code: 'DEVICE_REVOKED',
              error: 'DEVICE_REVOKED: Device access has been revoked',
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await authClient.authenticate();
    const hbClient = new HeartbeatClient({ deviceAuthClient: authClient, intervalMs: 100 });
    const status = await hbClient.sendHeartbeat();

    assert.equal(status.state, CONNECTION_STATES.REVOKED);
    assert.equal(status.isOnline, false);
    assert.equal(status.isRunning, false);
    assert.equal(status.permanentlyStopped, true);

    // Cannot restart automatically
    const restarted = hbClient.start();
    assert.equal(restarted, false);
    assert.equal(hbClient.getStatus().isRunning, false);
  });

  it('cleans up timers and stops loop on application shutdown', async () => {
    let calls = 0;
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
              deviceId: 'dev-desktop-m343-001',
              deviceGeneration: 1,
              userId: 'user-owner-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/heartbeat')) {
          calls += 1;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'ONLINE',
              isOnline: true,
              lastHeartbeatAt: '2026-11-26T12:15:00.000Z',
              heartbeatCount: calls,
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await authClient.authenticate();
    const hbClient = new HeartbeatClient({ deviceAuthClient: authClient, intervalMs: 100 });
    hbClient.start();
    await new Promise((r) => setTimeout(r, 25));

    hbClient.stop();
    const callsAtStop = calls;
    await new Promise((r) => setTimeout(r, 150));

    assert.equal(calls, callsAtStop);
    assert.equal(hbClient.getStatus().isRunning, false);
  });

  it('never leaks credentials or tokens across heartbeat IPC handlers', async () => {
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
              deviceId: 'dev-desktop-m343-001',
              deviceGeneration: 1,
              userId: 'user-owner-001',
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
              lastHeartbeatAt: '2026-11-26T12:20:00.000Z',
              heartbeatCount: 1,
            }),
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

    const sendRes = await ipcMock.invoke(IPC_CHANNELS.HEARTBEAT_SEND_NOW);
    const statusRes = await ipcMock.invoke(IPC_CHANNELS.HEARTBEAT_GET_STATUS);
    unregisterIpcHandlers(ipcMock);

    const serialized = JSON.stringify({ sendRes, statusRes });
    assert.equal(serialized.includes(secretDeviceToken), false);
    assert.equal(serialized.includes(secretAccessToken), false);
    assert.equal(serialized.includes(secretRefreshToken), false);
    assert.equal(statusRes.state, CONNECTION_STATES.ONLINE);
    assert.equal(statusRes.isOnline, true);
  });
});
