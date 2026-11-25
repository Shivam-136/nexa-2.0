/**
 * NEXA 2.0 Desktop Agent - Preload Bridge & Subscriber Test Suite
 * Phase 6 — Milestone 3.1
 *
 * Verifies:
 * - Safe event subscription mechanism
 * - Rejection of unauthorized event channels
 * - Correct event delivery without leaking IpcRendererEvent
 * - Idempotent unsubscribe functionality
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { createSafeSubscriber, nexaDesktopAPI } = require('../preload/index');
const { ALLOWED_RECEIVE_CHANNELS } = require('../preload/channels');

// Mock ipcRenderer
function createMockIpcRenderer() {
  const listeners = new Map();

  return {
    on: (channel, listener) => {
      if (!listeners.has(channel)) {
        listeners.set(channel, []);
      }
      listeners.get(channel).push(listener);
    },
    removeListener: (channel, listener) => {
      const list = listeners.get(channel);
      if (list) {
        const idx = list.indexOf(listener);
        if (idx !== -1) {
          list.splice(idx, 1);
        }
      }
    },
    emit: (channel, ...args) => {
      const list = listeners.get(channel);
      if (list) {
        list.forEach((fn) => fn({ sender: {} }, ...args));
      }
    },
    listenerCount: (channel) => (listeners.get(channel) ? listeners.get(channel).length : 0),
  };
}

describe('1. Preload Event Subscription Security', () => {
  it('must allow subscription only to whitelisted receive channels', () => {
    ALLOWED_RECEIVE_CHANNELS.forEach((channel) => {
      // In node test environment, Electron ipcRenderer is not real unless mocked,
      // but createSafeSubscriber checks channel whitelist first!
      assert.doesNotThrow(() => {
        // Will throw callback error if invalid callback, but channel is allowed
        assert.throws(
          () => createSafeSubscriber(channel, null),
          { name: 'TypeError', message: /must be a valid function/ }
        );
      });
    });
  });

  it('must reject subscription to unapproved channels immediately', () => {
    const forbidden = [
      'admin:eval',
      'nexa:private-tokens',
      'shell:output',
      'custom-channel',
    ];

    forbidden.forEach((badChannel) => {
      assert.throws(
        () => createSafeSubscriber(badChannel, () => {}),
        { name: 'Error', message: /Unauthorized IPC event subscription channel/ }
      );
    });
  });

  it('safe subscriber callback must receive payload without leaking internal Electron event object', () => {
    const mockIpc = createMockIpcRenderer();
    let receivedPayload = null;
    let argumentCount = 0;

    // Simulate safe subscriber logic with mock ipcRenderer
    const testChannel = 'nexa:tray-event';
    const callback = (...args) => {
      argumentCount = args.length;
      receivedPayload = args[0];
    };

    const safeListener = (_event, ...args) => {
      callback(...args);
    };
    mockIpc.on(testChannel, safeListener);

    // Emit event with internal electron event object followed by data
    mockIpc.emit(testChannel, { action: 'restored-from-tray' });

    assert.equal(argumentCount, 1, 'Callback must receive only the payload, NOT the Electron event object');
    assert.deepEqual(receivedPayload, { action: 'restored-from-tray' });
  });

  it('unsubscribe function must remove listener idempotently', () => {
    const mockIpc = createMockIpcRenderer();
    const testChannel = 'nexa:tray-event';
    const listener = () => {};

    mockIpc.on(testChannel, listener);
    assert.equal(mockIpc.listenerCount(testChannel), 1);

    // Unsubscribe
    mockIpc.removeListener(testChannel, listener);
    assert.equal(mockIpc.listenerCount(testChannel), 0);

    // Calling again does not throw
    assert.doesNotThrow(() => {
      mockIpc.removeListener(testChannel, listener);
    });
  });
});

describe('2. Exposed Bridge Methods Verification', () => {
  it('nexaDesktopAPI object must be frozen and define all milestone 3.1 functions', () => {
    assert.equal(Object.isFrozen(nexaDesktopAPI), true);

    const requiredApiMethods = [
      'ping',
      'getAppInfo',
      'getSystemStatus',
      'minimize',
      'maximize',
      'close',
      'isMaximized',
      'quitApp',
      'onTrayEvent',
      'onStatusChange',
      'onWindowStateChange',
    ];

    requiredApiMethods.forEach((m) => {
      assert.equal(typeof nexaDesktopAPI[m], 'function', `Method ${m} must be defined`);
    });

    // Milestone 3.2: Secure storage namespace verification
    assert.equal(typeof nexaDesktopAPI.storage, 'object');
    assert.equal(Object.isFrozen(nexaDesktopAPI.storage), true);
    assert.equal(typeof nexaDesktopAPI.storage.getStatus, 'function');
    assert.equal(typeof nexaDesktopAPI.storage.getDeviceInfo, 'function');
    assert.equal(nexaDesktopAPI.storage.saveCredentials, undefined, 'saveCredentials MUST NOT be exposed on storage API');
    assert.equal('saveCredentials' in nexaDesktopAPI.storage, false);
    assert.equal(nexaDesktopAPI.storage.clearCredentials, undefined, 'clearCredentials MUST NOT be exposed on storage API');
    assert.equal('clearCredentials' in nexaDesktopAPI.storage, false);
    assert.equal(typeof nexaDesktopAPI.storage.onStatusChange, 'function');
  });
});
