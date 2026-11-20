/**
 * NEXA 2.0 Desktop Agent - System Tray Test Suite
 * Phase 6 — Milestone 3.1
 *
 * Verifies:
 * - Tray creation, tooltip, and icon assignment
 * - Context menu composition and action handlers
 * - Tray click toggling between hidden and visible
 * - Double-click window focus
 * - Clean destruction of tray instance
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  createTray,
  destroyTray,
  getTray,
  showAndFocusWindow,
  hideToTray,
  toggleWindowVisibility,
} = require('../main/tray');

// Mock Tray Constructor
class MockTray {
  constructor(icon) {
    this.icon = icon;
    this.tooltip = '';
    this.contextMenu = null;
    this.listeners = new Map();
    this.destroyed = false;
  }

  setToolTip(tip) {
    this.tooltip = tip;
  }

  setContextMenu(menu) {
    this.contextMenu = menu;
  }

  on(event, handler) {
    this.listeners.set(event, handler);
  }

  emit(event, ...args) {
    const fn = this.listeners.get(event);
    if (fn) fn(...args);
  }

  destroy() {
    this.destroyed = true;
  }
}

// Mock Menu Module
const mockMenuModule = {
  buildFromTemplate: (template) => {
    return {
      template,
      getMenuItemByLabel: (label) => template.find((item) => item.label === label),
    };
  },
};

// Mock Window
function createMockWindow({ isVisible = true, isMinimized = false } = {}) {
  let visible = isVisible;
  let minimized = isMinimized;
  let focused = false;
  let restored = false;

  return {
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => minimized,
    show: () => { visible = true; },
    hide: () => { visible = false; },
    restore: () => { restored = true; minimized = false; },
    focus: () => { focused = true; },
    webContents: { send: () => {} },
    getState: () => ({ visible, minimized, focused, restored }),
  };
}

describe('1. System Tray Creation & Configuration', () => {
  beforeEach(() => {
    destroyTray();
  });

  it('should initialize Tray with tooltip and context menu', () => {
    let quitCalled = false;
    const mockWin = createMockWindow();

    const tray = createTray({
      getMainWindow: () => mockWin,
      onQuit: () => { quitCalled = true; },
      trayConstructor: MockTray,
      menuModule: mockMenuModule,
    });

    assert.equal(getTray(), tray);
    assert.equal(tray.tooltip, 'NEXA 2.0 Desktop Agent');
    assert.ok(tray.contextMenu, 'Context menu should be set');
  });

  it('context menu should contain required options: Open, Status, Minimize, Quit', () => {
    let quitTriggered = false;
    const mockWin = createMockWindow();

    const tray = createTray({
      getMainWindow: () => mockWin,
      onQuit: () => { quitTriggered = true; },
      trayConstructor: MockTray,
      menuModule: mockMenuModule,
    });

    const menu = tray.contextMenu;
    const openItem = menu.getMenuItemByLabel('Open NEXA 2.0');
    const statusItem = menu.getMenuItemByLabel('Status: Active (Online)');
    const minimizeItem = menu.getMenuItemByLabel('Minimize to Tray');
    const quitItem = menu.getMenuItemByLabel('Quit NEXA 2.0');

    assert.ok(openItem, 'Open NEXA 2.0 menu item must exist');
    assert.ok(statusItem, 'Status item must exist');
    assert.equal(statusItem.enabled, false, 'Status indicator should not be clickable');
    assert.ok(minimizeItem, 'Minimize to Tray item must exist');
    assert.ok(quitItem, 'Quit NEXA 2.0 item must exist');

    // Trigger Open action
    openItem.click();
    assert.equal(mockWin.getState().visible, true);
    assert.equal(mockWin.getState().focused, true);

    // Trigger Minimize action
    minimizeItem.click();
    assert.equal(mockWin.getState().visible, false);

    // Trigger Quit action
    quitItem.click();
    assert.equal(quitTriggered, true, 'Quit action must call onQuit callback');
  });
});

describe('2. System Tray Interaction & Toggling', () => {
  let mockWin;
  let tray;

  beforeEach(() => {
    destroyTray();
    mockWin = createMockWindow({ isVisible: true, isMinimized: false });
    tray = createTray({
      getMainWindow: () => mockWin,
      onQuit: () => {},
      trayConstructor: MockTray,
      menuModule: mockMenuModule,
    });
  });

  it('left-click on tray should hide window when currently visible', () => {
    assert.equal(mockWin.getState().visible, true);
    tray.emit('click');
    assert.equal(mockWin.getState().visible, false, 'Window should hide on tray click if visible');
  });

  it('left-click on tray should show and focus window when currently hidden', () => {
    mockWin.hide();
    assert.equal(mockWin.getState().visible, false);

    tray.emit('click');
    assert.equal(mockWin.getState().visible, true, 'Window should show on tray click if hidden');
    assert.equal(mockWin.getState().focused, true, 'Window should focus on tray click');
  });

  it('double-click on tray should always restore, show, and focus window', () => {
    mockWin.hide();
    tray.emit('double-click');
    assert.equal(mockWin.getState().visible, true);
    assert.equal(mockWin.getState().focused, true);
  });

  it('destroyTray should call destroy() on native Tray and reset instance', () => {
    destroyTray();
    assert.equal(tray.destroyed, true);
    assert.equal(getTray(), null);
  });
});
