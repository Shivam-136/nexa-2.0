/**
 * NEXA 2.0 Desktop Agent - IPC Whitelist & Input Validation Test Suite
 * Phase 6 — Milestone 3.1
 *
 * Verifies:
 * - Allowed channels whitelisting
 * - Rejection of unwhitelisted channels
 * - Ping input validation and sanitization
 * - Execution of all registered IPC handlers with input validation
 * - Unregistering and cleanup
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  isAllowedInvokeChannel,
  isAllowedReceiveChannel,
  validatePingPayload,
  validateCallback,
  MAX_PAYLOAD_STRING_LENGTH,
} = require('../preload/channels');

const {
  registerIpcHandlers,
  unregisterIpcHandlers,
  sendToRenderer,
} = require('../main/ipc');

const { IPC_CHANNELS } = require('../main/config');

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

describe('1. IPC Channel Whitelist Enforcement', () => {
  it('must approve all valid invoke channels', () => {
    const validChannels = [
      'nexa:ping',
      'nexa:get-app-info',
      'nexa:get-system-status',
      'nexa:window-minimize',
      'nexa:window-maximize',
      'nexa:window-close',
      'nexa:window-is-maximized',
      'nexa:app-quit',
    ];

    validChannels.forEach((ch) => {
      assert.equal(isAllowedInvokeChannel(ch), true, `Channel "${ch}" should be allowed`);
    });
  });

  it('must reject unauthorized invoke channels', () => {
    const dangerousChannels = [
      'shell:execute',
      'fs:readFile',
      'child_process:exec',
      'nexa:arbitrary-eval',
      'process:kill',
      'electron:remote',
      '',
      null,
      undefined,
      123,
    ];

    dangerousChannels.forEach((ch) => {
      assert.equal(isAllowedInvokeChannel(ch), false, `Unauthorized channel "${ch}" must be rejected`);
    });
  });

  it('must approve all valid receive channels', () => {
    const validReceives = [
      'nexa:tray-event',
      'nexa:status-changed',
      'nexa:window-state-changed',
    ];

    validReceives.forEach((ch) => {
      assert.equal(isAllowedReceiveChannel(ch), true, `Receive channel "${ch}" should be allowed`);
    });
  });

  it('must reject unauthorized receive channels', () => {
    assert.equal(isAllowedReceiveChannel('nexa:secret-leak'), false);
    assert.equal(isAllowedReceiveChannel('nexa:eval-code'), false);
  });
});

describe('2. IPC Input Validation & Sanitization', () => {
  it('should default null or undefined ping payload to "ping"', () => {
    assert.equal(validatePingPayload(null), 'ping');
    assert.equal(validatePingPayload(undefined), 'ping');
  });

  it('should sanitize control characters and trim whitespace', () => {
    const dirty = '  hello\x00\x07world\x1F  ';
    const clean = validatePingPayload(dirty);
    assert.equal(clean, 'helloworld');
  });

  it('should throw TypeError on non-string ping payload', () => {
    assert.throws(
      () => validatePingPayload(12345),
      { name: 'TypeError', message: /must be a string/ }
    );
    assert.throws(
      () => validatePingPayload({ malicious: 'object' }),
      { name: 'TypeError', message: /must be a string/ }
    );
    assert.throws(
      () => validatePingPayload(['array']),
      { name: 'TypeError', message: /must be a string/ }
    );
  });

  it('should throw RangeError if ping payload exceeds 1024 characters', () => {
    const oversized = 'A'.repeat(MAX_PAYLOAD_STRING_LENGTH + 1);
    assert.throws(
      () => validatePingPayload(oversized),
      { name: 'RangeError', message: /exceeds maximum permitted length/ }
    );
  });

  it('validateCallback should reject non-functions', () => {
    assert.throws(() => validateCallback(null), { name: 'TypeError' });
    assert.throws(() => validateCallback('not-a-fn'), { name: 'TypeError' });
    assert.doesNotThrow(() => validateCallback(() => {}));
  });
});

describe('3. Main Process IPC Handlers Execution & Security', () => {
  let mockIpc;
  let mockWindow;
  let quitCalled = false;

  beforeEach(() => {
    quitCalled = false;
    mockIpc = createMockIpcMain();
    mockWindow = {
      isDestroyed: () => false,
      isVisible: () => true,
      isMinimized: () => false,
      _maximized: false,
      isMaximized() { return this._maximized; },
      minimize: () => {},
      maximize() { this._maximized = true; },
      unmaximize() { this._maximized = false; },
      close: () => {},
      webContents: {
        send: () => {},
      },
    };

    registerIpcHandlers({
      getMainWindow: () => mockWindow,
      onQuit: () => { quitCalled = true; },
      ipc: mockIpc,
      appInfo: {
        name: 'NEXA 2.0 Desktop Agent',
        version: '2.0.0',
        platform: 'win32',
        arch: 'x64',
        electronVersion: '24.22.3',
        nodeVersion: '24.14.0',
      },
    });
  });

  it('nexa:ping handler should echo sanitized input and timestamp', async () => {
    const result = await mockIpc.invoke(IPC_CHANNELS.PING, ' test-agent \x00 ');
    assert.equal(result.pong, true);
    assert.equal(result.received, 'test-agent');
    assert.equal(typeof result.timestamp, 'number');
  });

  it('nexa:ping handler should safely catch and report validation errors', async () => {
    const result = await mockIpc.invoke(IPC_CHANNELS.PING, 99999);
    assert.equal(result.pong, false);
    assert.match(result.error, /must be a string/);
  });

  it('nexa:get-app-info handler should return sanitized app metadata', async () => {
    const info = await mockIpc.invoke(IPC_CHANNELS.GET_APP_INFO);
    assert.equal(info.name, 'NEXA 2.0 Desktop Agent');
    assert.equal(info.version, '2.0.0');
    assert.equal(info.platform, 'win32');
    assert.equal(info.arch, 'x64');
  });

  it('nexa:get-system-status handler should return system & security telemetry', async () => {
    const status = await mockIpc.invoke(IPC_CHANNELS.GET_SYSTEM_STATUS);
    assert.equal(status.status, 'online');
    assert.equal(status.security.contextIsolation, true);
    assert.equal(status.security.nodeIntegration, false);
    assert.equal(status.security.sandbox, true);
    assert.equal(status.tray.active, true);
    assert.equal(status.window.visible, true);
  });

  it('nexa:window-minimize handler should invoke window.minimize()', async () => {
    let minimized = false;
    mockWindow.minimize = () => { minimized = true; };

    const res = await mockIpc.invoke(IPC_CHANNELS.WINDOW_MINIMIZE);
    assert.equal(res, true);
    assert.equal(minimized, true);
  });

  it('nexa:window-maximize handler should toggle maximized state', async () => {
    assert.equal(mockWindow.isMaximized(), false);

    // First invoke maximizes
    const res1 = await mockIpc.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE);
    assert.equal(res1, true);
    assert.equal(mockWindow.isMaximized(), true);

    // Second invoke restores
    const res2 = await mockIpc.invoke(IPC_CHANNELS.WINDOW_MAXIMIZE);
    assert.equal(res2, false);
    assert.equal(mockWindow.isMaximized(), false);
  });

  it('nexa:window-close handler should invoke window.close()', async () => {
    let closed = false;
    mockWindow.close = () => { closed = true; };

    const res = await mockIpc.invoke(IPC_CHANNELS.WINDOW_CLOSE);
    assert.equal(res, true);
    assert.equal(closed, true);
  });

  it('nexa:app-quit handler should trigger graceful shutdown callback', async () => {
    const res = await mockIpc.invoke(IPC_CHANNELS.APP_QUIT);
    assert.equal(res, true);
    assert.equal(quitCalled, true);
  });

  it('unregisterIpcHandlers should cleanly remove all registered handlers', () => {
    unregisterIpcHandlers(mockIpc);
    assert.equal(mockIpc._handlers.size, 0);
  });
});
