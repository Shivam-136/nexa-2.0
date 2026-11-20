/**
 * NEXA 2.0 Desktop Agent - Application Lifecycle & Shutdown Test Suite
 * Phase 6 — Milestone 3.1
 *
 * Verifies:
 * - Minimize-to-tray interception on window close event
 * - Distinguishing between user close (minimize) vs application quit
 * - Orderly, idempotent gracefulShutdown teardown sequence
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  isQuitting,
  setQuitting,
  gracefulShutdown,
  resetLifecycleState,
} = require('../main/lifecycle');

const { createMainWindow, setMainWindow } = require('../main/window');
const { createTray, destroyTray, getTray } = require('../main/tray');
const { registerIpcHandlers, unregisterIpcHandlers, isRegistered } = require('../main/ipc');

// Mock BrowserWindow
class MockBrowserWindow {
  constructor(options) {
    this.options = options;
    this.listeners = new Map();
    this.visible = false;
    this.destroyed = false;
    this.webContents = {
      on: () => {},
      setWindowOpenHandler: () => {},
      send: () => {},
    };
  }

  loadFile(path) { this.loadedPath = path; }
  once(event, fn) { if (event === 'ready-to-show') fn(); }
  on(event, fn) { this.listeners.set(event, fn); }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  isVisible() { return this.visible; }
  isDestroyed() { return this.destroyed; }
  isMaximized() { return false; }
  isMinimized() { return false; }
  destroy() { this.destroyed = true; }
  close() {
    const closeHandler = this.listeners.get('close');
    let prevented = false;
    const event = {
      preventDefault: () => { prevented = true; },
      isDefaultPrevented: () => prevented,
    };
    if (closeHandler) closeHandler(event);
    if (!prevented) {
      this.destroyed = true;
    }
  }
}

// Mock App
function createMockApp() {
  let quitCalled = false;
  return {
    quit: () => { quitCalled = true; },
    isQuitCalled: () => quitCalled,
  };
}

// Mock Tray Constructor
class MockTray {
  constructor() { this.destroyed = false; }
  setToolTip() {}
  setContextMenu() {}
  on() {}
  destroy() { this.destroyed = true; }
}

describe('1. Minimize-to-Tray Window Interception', () => {
  beforeEach(() => {
    resetLifecycleState();
    destroyTray();
  });

  it('window close event should prevent default and hide to tray when isQuitting is false', () => {
    let prevented = false;
    const mockWin = createMainWindow({
      isQuitting,
      windowConstructor: MockBrowserWindow,
    });
    setMainWindow(mockWin);

    mockWin.show();
    assert.equal(mockWin.isVisible(), true);

    // Trigger close when not quitting
    const closeHandler = mockWin.listeners.get('close');
    assert.ok(closeHandler, 'Window must have a close event listener');

    const mockEvent = {
      preventDefault: () => { prevented = true; },
    };
    closeHandler(mockEvent);

    assert.equal(prevented, true, 'Window close must be intercepted via preventDefault()');
    assert.equal(mockWin.isVisible(), false, 'Window must be hidden to tray');
    assert.equal(mockWin.isDestroyed(), false, 'Window must NOT be destroyed when minimized to tray');
  });

  it('window close event should allow close to proceed when isQuitting is true', () => {
    let prevented = false;
    const mockWin = createMainWindow({
      isQuitting,
      windowConstructor: MockBrowserWindow,
    });
    setMainWindow(mockWin);

    // Set quitting mode
    setQuitting(true);
    assert.equal(isQuitting(), true);

    const closeHandler = mockWin.listeners.get('close');
    const mockEvent = {
      preventDefault: () => { prevented = true; },
    };
    closeHandler(mockEvent);

    assert.equal(prevented, false, 'preventDefault must NOT be called when application is quitting');
  });
});

describe('2. Graceful Shutdown Flow', () => {
  beforeEach(() => {
    resetLifecycleState();
    destroyTray();
  });

  it('gracefulShutdown should set isQuitting, clean up tray, unregister IPC, and quit app', () => {
    const mockApp = createMockApp();
    const mockWin = createMainWindow({
      isQuitting,
      windowConstructor: MockBrowserWindow,
    });
    setMainWindow(mockWin);

    // Create tray
    createTray({
      getMainWindow: () => mockWin,
      onQuit: () => {},
      trayConstructor: MockTray,
      menuModule: { buildFromTemplate: () => ({}) },
    });
    assert.ok(getTray(), 'Tray should be initialized');

    // Register IPC
    registerIpcHandlers({
      getMainWindow: () => mockWin,
      onQuit: () => {},
      ipc: { handle: () => {}, removeHandler: () => {} },
    });
    assert.equal(isRegistered(), true);

    // Execute graceful shutdown
    gracefulShutdown(mockApp);

    assert.equal(isQuitting(), true, 'isQuitting must be set to true');
    assert.equal(getTray(), null, 'System tray must be destroyed and cleared');
    assert.equal(isRegistered(), false, 'IPC handlers must be unregistered');
    assert.equal(mockWin.isDestroyed(), true, 'Window must be destroyed');
    assert.equal(mockApp.isQuitCalled(), true, 'app.quit() must be invoked');
  });

  it('gracefulShutdown should be idempotent and not crash if called multiple times', () => {
    const mockApp = createMockApp();
    gracefulShutdown(mockApp);
    assert.equal(isQuitting(), true);

    // Second call should return early without error
    assert.doesNotThrow(() => {
      gracefulShutdown(mockApp);
    });
  });
});
