/**
 * NEXA 2.0 Desktop Agent - Storage IPC Integration & Token Redaction Test Suite
 * Phase 6 — Milestone 3.2: Secure Device Storage (Remediated)
 *
 * Verifies:
 * - Storage IPC channels are properly whitelisted
 * - Credential save IPC channel (nexa:storage-save-credentials) is strictly rejected
 * - Preload nexaDesktopAPI.storage does NOT expose saveCredentials
 * - Handlers invoke storage service correctly (read / clear)
 * - IPC bridge NEVER exposes raw deviceToken to renderer
 * - Storage state change events notify renderer
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  isAllowedInvokeChannel,
  isAllowedReceiveChannel,
} = require('../preload/channels');
const { nexaDesktopAPI } = require('../preload/index');

const { registerIpcHandlers } = require('../main/ipc');
const { IPC_CHANNELS, IPC_EVENTS } = require('../main/config');

// Helper to create a mock IPC main
function createMockIpcMain() {
  const handlers = new Map();
  return {
    handle: (channel, handler) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel) => {
      handlers.delete(channel);
    },
    invoke: async (channel, ...args) => {
      const handler = handlers.get(channel);
      if (!handler) {
        throw new Error(`No handler registered for '${channel}'`);
      }
      return await handler({ sender: {} }, ...args);
    },
    hasHandler: (channel) => handlers.has(channel),
    _handlers: handlers,
  };
}

// Mock SecureStorageService for IPC tests
function createMockStorageService({ isPaired = false } = {}) {
  let paired = isPaired;
  let credentials = paired ? {
    deviceId: 'dev-ipc-1',
    deviceName: 'IPC Test PC',
    deviceToken: 'SECRET_BEARER_TOKEN_99999',
    userId: 'user-ipc-123',
    backendUrl: 'https://backend.nexa.ai',
    pairedAt: '2026-11-20T10:00:00.000Z',
  } : null;

  return {
    isEncryptionAvailable: () => true,
    getStatus: () => ({
      encryptionAvailable: true,
      hasVault: paired,
      isPaired: paired,
    }),
    hasCredentials: () => paired,
    getCredentials: () => (credentials ? { ...credentials } : null),
    getDeviceInfo: () => {
      if (!paired || !credentials) {
        return { isPaired: false, deviceId: null, deviceName: null, userId: null, backendUrl: null, pairedAt: null };
      }
      // Redacted metadata
      return {
        isPaired: true,
        deviceId: credentials.deviceId,
        deviceName: credentials.deviceName,
        userId: credentials.userId,
        backendUrl: credentials.backendUrl,
        pairedAt: credentials.pairedAt,
      };
    },
    clearCredentials: () => {
      paired = false;
      credentials = null;
      return { success: true };
    },
  };
}

describe('1. Storage IPC Channel Whitelist Enforcement', () => {
  it('must approve all valid storage invoke channels', () => {
    const storageChannels = [
      'nexa:storage-get-status',
      'nexa:storage-get-device-info',
    ];

    storageChannels.forEach((ch) => {
      assert.equal(isAllowedInvokeChannel(ch), true, `Channel "${ch}" must be whitelisted`);
    });
  });

  it('must approve storage status changed receive channel', () => {
    assert.equal(isAllowedReceiveChannel('nexa:storage-status-changed'), true);
  });

  it('must reject unauthorized storage variants, save-credentials, and clear-credentials channels', () => {
    assert.equal(isAllowedInvokeChannel('nexa:storage-save-credentials'), false, 'nexa:storage-save-credentials MUST NOT be whitelisted');
    assert.equal(isAllowedInvokeChannel('nexa:storage-clear-credentials'), false, 'nexa:storage-clear-credentials MUST NOT be whitelisted');
    assert.equal(isAllowedInvokeChannel('nexa:storage-get-raw-token'), false);
    assert.equal(isAllowedInvokeChannel('nexa:storage-read-file'), false);
    assert.equal(isAllowedInvokeChannel('nexa:storage-delete-file'), false);
  });
});

describe('2. Elimination of Renderer Credential Mutation Interface (Save & Clear)', () => {
  it('nexaDesktopAPI.storage MUST NOT expose saveCredentials', () => {
    assert.equal(nexaDesktopAPI.storage.saveCredentials, undefined, 'saveCredentials MUST NOT exist on storage API');
    assert.equal('saveCredentials' in nexaDesktopAPI.storage, false, 'saveCredentials key MUST NOT exist on storage API');
  });

  it('nexaDesktopAPI.storage MUST NOT expose clearCredentials', () => {
    assert.equal(nexaDesktopAPI.storage.clearCredentials, undefined, 'clearCredentials MUST NOT exist on storage API');
    assert.equal('clearCredentials' in nexaDesktopAPI.storage, false, 'clearCredentials key MUST NOT exist on storage API');
  });

  it('validateStorageSavePayload must NOT be exported from channels or preload', () => {
    const channels = require('../preload/channels');
    const preload = require('../preload/index');
    assert.equal(channels.validateStorageSavePayload, undefined);
    assert.equal(preload.validateStorageSavePayload, undefined);
  });

  it('IPC_CHANNELS MUST NOT define STORAGE_SAVE_CREDENTIALS or STORAGE_CLEAR_CREDENTIALS', () => {
    assert.equal(IPC_CHANNELS.STORAGE_SAVE_CREDENTIALS, undefined);
    assert.equal('STORAGE_SAVE_CREDENTIALS' in IPC_CHANNELS, false);
    assert.equal(IPC_CHANNELS.STORAGE_CLEAR_CREDENTIALS, undefined);
    assert.equal('STORAGE_CLEAR_CREDENTIALS' in IPC_CHANNELS, false);
  });
});

describe('3. Main Process Storage IPC Handlers Execution', () => {
  let mockIpc;
  let mockStorage;
  let sentEvents = [];
  let mockWindow;

  beforeEach(() => {
    sentEvents = [];
    mockIpc = createMockIpcMain();
    mockStorage = createMockStorageService({ isPaired: true });
    mockWindow = {
      isDestroyed: () => false,
      isVisible: () => true,
      webContents: {
        send: (ch, data) => sentEvents.push({ channel: ch, data }),
      },
    };

    registerIpcHandlers({
      getMainWindow: () => mockWindow,
      onQuit: () => {},
      storageService: mockStorage,
      ipc: mockIpc,
    });
  });

  it('nexa:storage-get-status returns storage and DPAPI availability', async () => {
    const status = await mockIpc.invoke(IPC_CHANNELS.STORAGE_GET_STATUS);
    assert.equal(status.encryptionAvailable, true);
    assert.equal(status.isPaired, true);
    assert.equal(status.hasVault, true);
  });

  it('nexa:storage-get-device-info strictly returns redacted metadata (NO TOKEN LEAKAGE)', async () => {
    const info = await mockIpc.invoke(IPC_CHANNELS.STORAGE_GET_DEVICE_INFO);
    assert.equal(info.isPaired, true);
    assert.equal(info.deviceId, 'dev-ipc-1');
    assert.equal(info.deviceName, 'IPC Test PC');
    assert.equal(info.userId, 'user-ipc-123');
    assert.equal(info.backendUrl, 'https://backend.nexa.ai');

    // CRITICAL SECURITY ASSERTION
    assert.equal(info.deviceToken, undefined, 'deviceToken MUST NOT be present in IPC response');
    assert.equal(Object.keys(info).includes('deviceToken'), false);
  });

  it('invoking nexa:storage-save-credentials must be rejected with no handler registered', async () => {
    await assert.rejects(
      async () => {
        await mockIpc.invoke('nexa:storage-save-credentials', {
          deviceId: 'dev-spoof',
          deviceToken: 'secret-token-12345678',
        });
      },
      /No handler registered for 'nexa:storage-save-credentials'/
    );
  });

  it('invoking nexa:storage-clear-credentials must be rejected with no handler registered', async () => {
    await assert.rejects(
      async () => {
        await mockIpc.invoke('nexa:storage-clear-credentials');
      },
      /No handler registered for 'nexa:storage-clear-credentials'/
    );
  });

  it('nexa:get-system-status includes storage encryption status', async () => {
    const status = await mockIpc.invoke(IPC_CHANNELS.GET_SYSTEM_STATUS);
    assert.ok(status.storage, 'System status must include storage metadata');
    assert.equal(status.storage.encryptionAvailable, true);
    assert.equal(status.security.storageEncryptionAvailable, true);
  });
});
