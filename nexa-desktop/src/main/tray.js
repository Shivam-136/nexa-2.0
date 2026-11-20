/**
 * NEXA 2.0 Desktop Agent - Windows System Tray Integration
 * Phase 6 — Milestone 3.1
 *
 * Implements persistent system tray presence, context menu actions,
 * click-to-toggle, and minimize-to-tray orchestration.
 */

const electron = require('electron');
const fs = require('fs');
const { PATHS, IPC_EVENTS } = require('./config');
const { sendToRenderer } = require('./ipc');

// Safely extract Electron modules (handling both Electron runtime and Node test environments)
const { Tray, Menu, nativeImage } = (typeof electron === 'object' && electron !== null) ? electron : {};

let trayInstance = null;

/**
 * Loads or generates a fallback nativeImage for the system tray icon.
 * @param {string} iconPath
 * @param {Object} [nativeImageModule = nativeImage]
 * @returns {nativeImage|Object}
 */
function getTrayIconImage(iconPath = PATHS.trayIcon, nativeImageModule = nativeImage) {
  if (nativeImageModule && typeof nativeImageModule.createFromPath === 'function' && fs.existsSync(iconPath)) {
    return nativeImageModule.createFromPath(iconPath);
  }
  if (nativeImageModule && typeof nativeImageModule.createEmpty === 'function') {
    return nativeImageModule.createEmpty();
  }
  return { isEmpty: () => false };
}

/**
 * Initializes the Windows System Tray icon and context menu.
 * @param {Object} options
 * @param {Function} options.getMainWindow - Function returning the primary BrowserWindow
 * @param {Function} options.onQuit - Graceful application shutdown function
 * @param {string} [options.iconPath] - Optional override for icon path
 * @param {Object} [options.trayConstructor = Tray] - For test dependency injection
 * @param {Object} [options.menuModule = Menu] - For test dependency injection
 * @param {Object} [options.nativeImageModule = nativeImage] - For test dependency injection
 * @returns {Tray} The created Tray instance
 */
function createTray({
  getMainWindow,
  onQuit,
  iconPath = PATHS.trayIcon,
  trayConstructor = Tray,
  menuModule = Menu,
  nativeImageModule = nativeImage,
} = {}) {
  if (trayInstance) {
    destroyTray();
  }

  const icon = getTrayIconImage(iconPath, nativeImageModule);
  trayInstance = new trayConstructor(icon);

  trayInstance.setToolTip('NEXA 2.0 Desktop Agent');

  const contextMenu = menuModule.buildFromTemplate([
    {
      label: 'Open NEXA 2.0',
      click: () => {
        showAndFocusWindow(getMainWindow);
      },
    },
    {
      label: 'Status: Active (Online)',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: 'Minimize to Tray',
      click: () => {
        hideToTray(getMainWindow);
      },
    },
    { type: 'separator' },
    {
      label: 'Quit NEXA 2.0',
      click: () => {
        if (typeof onQuit === 'function') {
          onQuit();
        }
      },
    },
  ]);

  trayInstance.setContextMenu(contextMenu);

  // Left click toggles visibility
  trayInstance.on('click', () => {
    toggleWindowVisibility(getMainWindow);
  });

  // Double click explicitly opens and focuses
  trayInstance.on('double-click', () => {
    showAndFocusWindow(getMainWindow);
  });

  return trayInstance;
}

/**
 * Shows, un-minimizes, and focuses the main window.
 * @param {Function} getMainWindow
 */
function showAndFocusWindow(getMainWindow) {
  const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) {
      win.restore();
    }
    if (!win.isVisible()) {
      win.show();
    }
    win.focus();
    sendToRenderer(win, IPC_EVENTS.TRAY_EVENT, { action: 'restored-from-tray' });
  }
}

/**
 * Minimizes/hides the main window to the system tray.
 * @param {Function} getMainWindow
 */
function hideToTray(getMainWindow) {
  const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
  if (win && !win.isDestroyed()) {
    win.hide();
    sendToRenderer(win, IPC_EVENTS.TRAY_EVENT, { action: 'minimized-to-tray' });
  }
}

/**
 * Toggles the main window between visible and hidden in tray.
 * @param {Function} getMainWindow
 */
function toggleWindowVisibility(getMainWindow) {
  const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
  if (win && !win.isDestroyed()) {
    if (win.isVisible() && !win.isMinimized()) {
      win.hide();
      sendToRenderer(win, IPC_EVENTS.TRAY_EVENT, { action: 'hidden-to-tray' });
    } else {
      showAndFocusWindow(getMainWindow);
    }
  }
}

/**
 * Displays a balloon notification from the system tray (Windows only).
 * @param {Object} options
 * @param {string} options.title
 * @param {string} options.content
 */
function showTrayBalloon({ title, content }) {
  if (trayInstance && typeof trayInstance.displayBalloon === 'function') {
    trayInstance.displayBalloon({
      title: title || 'NEXA 2.0',
      content: content || 'NEXA Desktop Agent is running in the background.',
      iconType: 'info',
    });
  }
}

/**
 * Destroys the tray instance cleanly.
 */
function destroyTray() {
  if (trayInstance) {
    try {
      if (typeof trayInstance.destroy === 'function') {
        trayInstance.destroy();
      }
    } catch (err) {
      console.warn('[NEXA Tray] Warning destroying tray:', err.message);
    }
    trayInstance = null;
  }
}

/**
 * Returns the active Tray instance.
 * @returns {Tray|null}
 */
function getTray() {
  return trayInstance;
}

module.exports = {
  createTray,
  destroyTray,
  getTray,
  showAndFocusWindow,
  hideToTray,
  toggleWindowVisibility,
  showTrayBalloon,
};
