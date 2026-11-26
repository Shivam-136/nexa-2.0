/**
 * NEXA 2.0 Desktop Agent - PairingClient & Pairing IPC Regression Tests (M3.4.1)
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { PairingClient } = require('../main/pairing/pairingClient');
const { nexaDesktopAPI } = require('../preload/index');
const { isAllowedInvokeChannel, isAllowedReceiveChannel } = require('../preload/channels');
const { registerIpcHandlers } = require('../main/ipc');
const { IPC_CHANNELS } = require('../main/config');

function createMockStorage({ encryptionAvailable = true } = {}) {
  let stored = null;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-pairing-test-'));

  return {
    getStorageDir: () => tmpDir,
    isEncryptionAvailable: () => encryptionAvailable,
    hasCredentials: () => Boolean(stored),
    getStatus: () => ({
      encryptionAvailable,
      hasVault: Boolean(stored),
      isPaired: Boolean(stored),
    }),
    saveCredentials: (payload) => {
      stored = { ...payload };
      return { success: true };
    },
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
    _getRawStored: () => stored,
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

describe('NEXA 2.0 Desktop Agent — M3.4.1 Device Pairing Client & IPC', () => {
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage({ encryptionAvailable: true });
  });

  it('whitelists pairing IPC channels and freezes nexaDesktopAPI.pairing', () => {
    assert.equal(isAllowedInvokeChannel('nexa:pairing-claim'), true);
    assert.equal(isAllowedInvokeChannel('nexa:pairing-cancel'), true);
    assert.equal(isAllowedInvokeChannel('nexa:pairing-get-status'), true);
    assert.equal(isAllowedReceiveChannel('nexa:pairing-status-changed'), true);

    assert.equal(typeof nexaDesktopAPI.pairing, 'object');
    assert.equal(Object.isFrozen(nexaDesktopAPI.pairing), true);
    assert.equal(typeof nexaDesktopAPI.pairing.claim, 'function');
    assert.equal(typeof nexaDesktopAPI.pairing.cancel, 'function');
    assert.equal(typeof nexaDesktopAPI.pairing.getStatus, 'function');
    assert.equal(typeof nexaDesktopAPI.pairing.onStatusChange, 'function');
  });

  it('claims pairing code in Main Process, stores token in DPAPI storage, and NEVER leaks token', async () => {
    const secretToken = 'super_secret_device_token_abcdef1234567890';
    const client = new PairingClient({
      storageService: mockStorage,
      fetchImpl: async (url, opts) => {
        assert.equal(url, 'http://127.0.0.1:5000/api/v1/pairing/claim');
        const body = JSON.parse(opts.body);
        assert.equal(body.pairingCode, 'ABCD-2345');
        assert.equal(body.deviceName, 'Test-Workstation');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            deviceId: body.deviceId,
            deviceName: body.deviceName,
            deviceToken: secretToken,
            userId: 'user-12345',
            pairedAt: '2026-11-26T10:00:00.000Z',
          }),
        };
      },
    });

    const result = await client.claimPairing({
      pairingCode: 'abcd2345',
      deviceName: 'Test-Workstation',
      backendUrl: 'http://127.0.0.1:5000',
    });

    assert.equal(result.success, true);
    assert.equal(result.status, 'paired');
    assert.equal(result.deviceToken, undefined);
    assert.equal(result.deviceInfo.deviceToken, undefined);
    assert.equal(JSON.stringify(result).includes(secretToken), false);

    // Raw token is stored strictly in Main Process storage
    assert.equal(mockStorage._getRawStored().deviceToken, secretToken);
  });

  it('fails closed when OS DPAPI encryption is unavailable', async () => {
    const unencryptedStorage = createMockStorage({ encryptionAvailable: false });
    let fetchCalled = false;
    const client = new PairingClient({
      storageService: unencryptedStorage,
      fetchImpl: async () => {
        fetchCalled = true;
        throw new Error('Should not reach backend');
      },
    });

    await assert.rejects(
      () => client.claimPairing({ pairingCode: 'ABCD-2345' }),
      /NEXA_ERR_ENCRYPTION_UNAVAILABLE/
    );
    assert.equal(fetchCalled, false);
  });

  it('rejects invalid backendUrl with embedded credentials or invalid protocol', () => {
    const client = new PairingClient({ storageService: mockStorage });
    assert.throws(() => client.validateBackendUrl('ftp://localhost:5000'), /Protocol must be http: or https:/);
    assert.throws(() => client.validateBackendUrl('http://user:pass@localhost:5000'), /Embedded credentials/);
  });

  it('cancels an in-flight pairing request cleanly', async () => {
    const client = new PairingClient({
      storageService: mockStorage,
      fetchImpl: (_url, opts) =>
        new Promise((_resolve, reject) => {
          opts.signal.addEventListener('abort', () => {
            const err = new Error('Aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    });

    const pendingPromise = client.claimPairing({ pairingCode: 'ABCD-2345' });
    const cancelResult = client.cancelPairing();
    assert.equal(cancelResult.cancelled, true);
    assert.equal(cancelResult.status, 'cancelled');

    await assert.rejects(() => pendingPromise, /PAIRING_CANCELLED/);
  });

  it('IPC pairing handlers execute safely and redact deviceToken', async () => {
    const mockIpc = createMockIpcMain();
    const secretToken = 'ipc_secret_device_token_9876543210abcdef';
    const client = new PairingClient({
      storageService: mockStorage,
      fetchImpl: async (_url, opts) => {
        const body = JSON.parse(opts.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            deviceId: body.deviceId,
            deviceName: body.deviceName,
            deviceToken: secretToken,
            userId: 'user-ipc-1',
            pairedAt: '2026-11-26T10:00:00.000Z',
          }),
        };
      },
    });

    registerIpcHandlers({
      getMainWindow: () => null,
      onQuit: () => {},
      storageService: mockStorage,
      pairingClient: client,
      ipc: mockIpc,
    });

    const claimRes = await mockIpc.invoke(IPC_CHANNELS.PAIRING_CLAIM, {
      pairingCode: 'WXYZ-2345',
      deviceName: 'IPC-PC',
    });
    assert.equal(claimRes.success, true);
    assert.equal(JSON.stringify(claimRes).includes(secretToken), false);

    const statusRes = await mockIpc.invoke(IPC_CHANNELS.PAIRING_GET_STATUS);
    assert.equal(statusRes.isPaired, true);
    assert.equal(JSON.stringify(statusRes).includes(secretToken), false);
  });
});
