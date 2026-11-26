/**
 * NEXA 2.0 Desktop Agent - DeviceAuthClient & Credential Isolation Tests (M3.4.2)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { DeviceAuthClient } = require('../main/auth/deviceAuthClient');
const { nexaDesktopAPI } = require('../preload/index');
const { isAllowedInvokeChannel, isAllowedReceiveChannel } = require('../preload/channels');
const { registerIpcHandlers, unregisterIpcHandlers } = require('../main/ipc');
const { IPC_CHANNELS } = require('../main/config');

function createMockStorage({ credentials = null, encryptionAvailable = true } = {}) {
  let stored = credentials ? { ...credentials } : null;

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
    _setStored: (next) => {
      stored = next ? { ...next } : null;
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

describe('NEXA 2.0 Desktop Agent — M3.4.2 DeviceAuthClient & Credential Isolation', () => {
  const secretDeviceToken = 'dpapi_secret_device_token_1234567890abcdef1234567890abcdef';
  const secretAccessToken = 'jwt_secret_device_access_token_xyz_1234567890';
  const secretRefreshToken = 'jwt_secret_device_refresh_token_abc_0987654321';

  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage({
      encryptionAvailable: true,
      credentials: {
        deviceId: 'dev-desktop-m342-001',
        deviceName: 'Desktop-Alpha',
        deviceToken: secretDeviceToken,
        deviceGeneration: 2,
        userId: 'user-owner-001',
        backendUrl: 'http://127.0.0.1:5000',
        pairedAt: '2026-11-26T10:00:00.000Z',
      },
    });
  });

  it('whitelists deviceAuth IPC channels and freezes nexaDesktopAPI.deviceAuth', () => {
    assert.equal(isAllowedInvokeChannel('nexa:device-auth-get-status'), true);
    assert.equal(isAllowedInvokeChannel('nexa:device-auth-authenticate'), true);
    assert.equal(isAllowedInvokeChannel('nexa:device-auth-verify'), true);
    assert.equal(isAllowedReceiveChannel('nexa:device-auth-status-changed'), true);

    assert.equal(typeof nexaDesktopAPI.deviceAuth, 'object');
    assert.equal(Object.isFrozen(nexaDesktopAPI.deviceAuth), true);
    assert.equal(typeof nexaDesktopAPI.deviceAuth.getStatus, 'function');
    assert.equal(typeof nexaDesktopAPI.deviceAuth.authenticate, 'function');
    assert.equal(typeof nexaDesktopAPI.deviceAuth.verify, 'function');
    assert.equal(typeof nexaDesktopAPI.deviceAuth.onStatusChange, 'function');
  });

  it('authenticates from DPAPI storage in Main Process and NEVER leaks tokens via IPC or status events', async () => {
    const emittedEvents = [];
    const client = new DeviceAuthClient({
      storageService: mockStorage,
      onStatusChange: (status) => emittedEvents.push(status),
      fetchImpl: async (url, opts) => {
        if (url === 'http://127.0.0.1:5000/api/v1/device/auth/token') {
          const body = JSON.parse(opts.body);
          assert.equal(body.deviceId, 'dev-desktop-m342-001');
          assert.equal(body.deviceGeneration, 2);
          assert.equal(body.deviceToken, secretDeviceToken);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              tokenType: 'Bearer',
              accessToken: secretAccessToken,
              refreshToken: secretRefreshToken,
              expiresIn: 900,
              expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
              deviceId: 'dev-desktop-m342-001',
              deviceGeneration: 2,
              userId: 'user-owner-001',
            }),
          };
        }

        if (url === 'http://127.0.0.1:5000/api/v1/device/verify') {
          assert.equal(opts.headers.Authorization, `Bearer ${secretAccessToken}`);
          assert.equal(opts.headers['X-Device-Id'], 'dev-desktop-m342-001');
          assert.equal(opts.headers['X-Device-Generation'], '2');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              authenticated: true,
              device: {
                deviceId: 'dev-desktop-m342-001',
                deviceGeneration: 2,
                userId: 'user-owner-001',
              },
            }),
          };
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const mockIpc = createMockIpcMain();
    registerIpcHandlers({
      getMainWindow: () => null,
      onQuit: () => {},
      storageService: mockStorage,
      deviceAuthClient: client,
      ipc: mockIpc,
    });

    const authResult = await mockIpc.invoke(IPC_CHANNELS.DEVICE_AUTH_AUTHENTICATE);
    assert.equal(authResult.success, true);
    assert.equal(authResult.authenticated, true);
    assert.equal(authResult.state, 'authenticated');
    assert.equal(authResult.deviceId, 'dev-desktop-m342-001');
    assert.equal(authResult.deviceGeneration, 2);

    const statusResult = await mockIpc.invoke(IPC_CHANNELS.DEVICE_AUTH_GET_STATUS);
    assert.equal(statusResult.authenticated, true);

    const verifyResult = await mockIpc.invoke(IPC_CHANNELS.DEVICE_AUTH_VERIFY);
    assert.equal(verifyResult.success, true);
    assert.equal(verifyResult.authenticated, true);

    // Strictly guarantee ZERO token leakage in any IPC response or event
    const serialized = JSON.stringify({ authResult, statusResult, verifyResult, emittedEvents });
    assert.equal(serialized.includes(secretDeviceToken), false);
    assert.equal(serialized.includes(secretAccessToken), false);
    assert.equal(serialized.includes(secretRefreshToken), false);

    unregisterIpcHandlers(mockIpc);
  });

  it('automatically refreshes expired access token once during authenticatedFetch', async () => {
    const rotatedAccess = 'rotated_access_token_new_001';
    const rotatedRefresh = 'rotated_refresh_token_new_002';
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
              accessToken: secretAccessToken,
              refreshToken: secretRefreshToken,
              expiresIn: 900,
              expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
              deviceId: 'dev-desktop-m342-001',
              deviceGeneration: 2,
              userId: 'user-owner-001',
            }),
          };
        }

        if (url.endsWith('/api/v1/device/verify')) {
          verifyCalls += 1;
          if (verifyCalls === 1) {
            return {
              ok: false,
              status: 401,
              clone() {
                return this;
              },
              json: async () => ({
                success: false,
                code: 'DEVICE_TOKEN_EXPIRED',
                error: 'Device access token has expired',
              }),
            };
          }
          assert.equal(opts.headers.Authorization, `Bearer ${rotatedAccess}`);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              authenticated: true,
              device: { deviceId: 'dev-desktop-m342-001', deviceGeneration: 2 },
            }),
          };
        }

        if (url.endsWith('/api/v1/device/auth/refresh')) {
          const body = JSON.parse(opts.body);
          assert.equal(body.refreshToken, secretRefreshToken);
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: rotatedAccess,
              refreshToken: rotatedRefresh,
              expiresIn: 900,
              expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
              deviceId: 'dev-desktop-m342-001',
              deviceGeneration: 2,
              userId: 'user-owner-001',
            }),
          };
        }

        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await client.authenticate();
    const verified = await client.verifyDeviceSession();
    assert.equal(verified.authenticated, true);
    assert.equal(verifyCalls, 2);
  });

  it('handles revoked device and unavailable DPAPI errors safely and clears in-memory tokens', async () => {
    const client = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async () => ({
        ok: false,
        status: 403,
        json: async () => ({
          success: false,
          code: 'DEVICE_REVOKED',
          error: 'DEVICE_REVOKED: Device access has been revoked',
        }),
      }),
    });

    await assert.rejects(() => client.authenticate(), /DEVICE_REVOKED/);
    const status = client.getAuthStatus();
    assert.equal(status.state, 'revoked');
    assert.equal(status.authenticated, false);

    // Fails closed if DPAPI encryption is unavailable
    const noDpapiStorage = createMockStorage({ encryptionAvailable: false });
    const lockedClient = new DeviceAuthClient({ storageService: noDpapiStorage });
    await assert.rejects(() => lockedClient.authenticate(), /NEXA_ERR_ENCRYPTION_UNAVAILABLE/);
  });

  it('re-authenticates cleanly after simulated Electron restart using persisted DPAPI vault', async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { SecureStorageService } = require('../main/storage/secureStorage');

    const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-restart-auth-'));
    const mockSafeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (str) => Buffer.from(`dpapi:${Buffer.from(str, 'utf8').toString('base64')}`, 'utf8'),
      decryptString: (buf) => {
        const s = buf.toString('utf8');
        if (!s.startsWith('dpapi:')) throw new Error('Invalid DPAPI envelope');
        return Buffer.from(s.slice(6), 'base64').toString('utf8');
      },
    };

    // Session 1: save paired credentials to disk
    const storage1 = new SecureStorageService({ storageDir, safeStorageInstance: mockSafeStorage });
    storage1.init();
    storage1.saveCredentials({
      deviceId: 'dev-restart-001',
      deviceName: 'Restart-Box',
      deviceToken: secretDeviceToken,
      deviceGeneration: 3,
      userId: 'user-restart-001',
      backendUrl: 'http://127.0.0.1:5000',
    });

    // Session 2: fresh SecureStorageService + fresh DeviceAuthClient (simulates Electron restart)
    const storage2 = new SecureStorageService({ storageDir, safeStorageInstance: mockSafeStorage });
    storage2.init();

    const client2 = new DeviceAuthClient({
      storageService: storage2,
      fetchImpl: async (url, opts) => {
        const body = JSON.parse(opts.body);
        assert.equal(body.deviceId, 'dev-restart-001');
        assert.equal(body.deviceGeneration, 3);
        assert.equal(body.deviceToken, secretDeviceToken);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            accessToken: 'reauth_access_after_restart',
            refreshToken: 'reauth_refresh_after_restart',
            expiresIn: 900,
            expiresAt: new Date(Date.now() + 900 * 1000).toISOString(),
            deviceId: 'dev-restart-001',
            deviceGeneration: 3,
            userId: 'user-restart-001',
          }),
        };
      },
    });

    const res = await client2.authenticate();
    assert.equal(res.success, true);
    assert.equal(res.authenticated, true);
    assert.equal(res.deviceId, 'dev-restart-001');
    assert.equal(res.deviceGeneration, 3);

    fs.rmSync(storageDir, { recursive: true, force: true });
  });
});
