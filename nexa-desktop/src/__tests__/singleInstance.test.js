/**
 * NEXA 2.0 Desktop Agent - Single Instance Lock Test Suite
 * Phase 6 — Milestone 3.1
 *
 * Verifies:
 * - Single instance lock acquisition
 * - Immediate termination of secondary instances
 * - Second-instance event restoration and foreground focus
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { initSingleInstanceLock } = require('../main/singleInstance');

// Mock Electron App
function createMockApp(lockGranted = true) {
  const listeners = new Map();
  let quitCalled = false;

  return {
    requestSingleInstanceLock: () => lockGranted,
    on: (event, handler) => {
      listeners.set(event, handler);
    },
    emit: (event, ...args) => {
      const handler = listeners.get(event);
      if (handler) handler({}, ...args);
    },
    hasListener: (event) => listeners.has(event),
    quit: () => {
      quitCalled = true;
    },
    isQuitCalled: () => quitCalled,
  };
}

// Mock BrowserWindow
function createMockWindow({ isMinimized = false, isVisible = true } = {}) {
  let minimized = isMinimized;
  let visible = isVisible;
  let focused = false;
  let restored = false;

  return {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    isVisible: () => visible,
    restore: () => {
      restored = true;
      minimized = false;
    },
    show: () => {
      visible = true;
    },
    focus: () => {
      focused = true;
    },
    getFlags: () => ({ minimized, visible, focused, restored }),
  };
}

describe('1. Single Instance Lock - Primary Instance', () => {
  it('should acquire lock and attach second-instance event listener', () => {
    const mockApp = createMockApp(true);
    const mockWin = createMockWindow();

    const acquired = initSingleInstanceLock({
      appInstance: mockApp,
      getMainWindow: () => mockWin,
    });

    assert.equal(acquired, true);
    assert.equal(mockApp.hasListener('second-instance'), true);
    assert.equal(mockApp.isQuitCalled(), false);
  });

  it('second-instance event should restore, show, and focus minimized window', () => {
    const mockApp = createMockApp(true);
    const mockWin = createMockWindow({ isMinimized: true, isVisible: false });

    let callbackTriggered = false;
    initSingleInstanceLock({
      appInstance: mockApp,
      getMainWindow: () => mockWin,
      onSecondInstance: (cmdLine) => {
        callbackTriggered = true;
      },
    });

    // Simulate second instance launch
    mockApp.emit('second-instance', ['--test'], 'C:\\');

    const flags = mockWin.getFlags();
    assert.equal(flags.restored, true, 'Window must be restored from minimized state');
    assert.equal(flags.visible, true, 'Window must be visible');
    assert.equal(flags.focused, true, 'Window must receive focus');
    assert.equal(callbackTriggered, true, 'Second-instance callback must execute');
  });

  it('second-instance event should show and focus hidden window', () => {
    const mockApp = createMockApp(true);
    const mockWin = createMockWindow({ isMinimized: false, isVisible: false });

    initSingleInstanceLock({
      appInstance: mockApp,
      getMainWindow: () => mockWin,
    });

    mockApp.emit('second-instance', [], 'C:\\');

    const flags = mockWin.getFlags();
    assert.equal(flags.visible, true);
    assert.equal(flags.focused, true);
  });
});

describe('2. Single Instance Lock - Secondary Instance Rejection', () => {
  it('should deny execution and immediately call app.quit() if lock already held', () => {
    const mockApp = createMockApp(false); // Lock denied!
    const mockWin = createMockWindow();

    const acquired = initSingleInstanceLock({
      appInstance: mockApp,
      getMainWindow: () => mockWin,
    });

    assert.equal(acquired, false, 'Secondary instance must return false');
    assert.equal(mockApp.isQuitCalled(), true, 'Secondary instance must call app.quit() immediately');
    assert.equal(mockApp.hasListener('second-instance'), false, 'Must not attach listener on secondary instance');
  });
});
