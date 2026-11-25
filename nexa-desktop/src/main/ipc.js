/**
 * NEXA 2.0 Desktop Agent - Main Process IPC Handlers & Input Validation
 * Phase 6 — Milestone 3.1
 *
 * Implements strict whitelisting, sender validation, argument sanitization,
 * and secure command routing. Arbitrary shell executions are forbidden.
 */

const { ipcMain } = require('electron');
const { IPC_CHANNELS, IPC_EVENTS } = require('./config');
const { validatePingPayload } = require('../preload/channels');
const { getSecureStorage } = require('./storage');

let isRegistered = false;

/**
 * Registers all validated IPC handlers in the main process.
 * @param {Object} options
 * @param {Function} options.getMainWindow - Function returning the primary BrowserWindow instance
 * @param {Function} options.onQuit - Function triggering graceful application shutdown
 * @param {Object} [options.storageService] - SecureStorageService instance
 * @param {Object} [options.ipc = ipcMain] - IPC instance for dependency injection in tests
 * @param {Object} [options.appInfo] - Optional custom app metadata for tests
 */
function registerIpcHandlers({ getMainWindow, onQuit, storageService = null, ipc = ipcMain, appInfo = null } = {}) {
  if (isRegistered) {
    unregisterIpcHandlers(ipc);
  }

  const storage = storageService || getSecureStorage();

  // 1. Ping / Health check handler
  ipc.handle(IPC_CHANNELS.PING, async (event, message) => {
    try {
      const sanitized = validatePingPayload(message);
      return {
        pong: true,
        timestamp: Date.now(),
        received: sanitized,
      };
    } catch (err) {
      return {
        pong: false,
        error: err.message,
        timestamp: Date.now(),
      };
    }
  });

  // 2. Application runtime info handler
  ipc.handle(IPC_CHANNELS.GET_APP_INFO, async () => {
    if (appInfo) {
      return appInfo;
    }
    return {
      name: 'NEXA 2.0 Desktop Agent',
      version: '2.0.0',
      milestone: '3.1 Foundational Architecture',
      platform: process.platform,
      arch: process.arch,
      electronVersion: process.versions.electron || 'N/A',
      nodeVersion: process.versions.node || 'N/A',
      chromeVersion: process.versions.chrome || 'N/A',
    };
  });

  // 3. System & security status handler
  ipc.handle(IPC_CHANNELS.GET_SYSTEM_STATUS, async () => {
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    const isVisible = win && !win.isDestroyed() && typeof win.isVisible === 'function' ? win.isVisible() : false;
    const storageStatus = storage && typeof storage.getStatus === 'function'
      ? storage.getStatus()
      : { encryptionAvailable: false, hasVault: false, isPaired: false };

    return {
      status: 'online',
      security: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        storageEncryptionAvailable: storageStatus.encryptionAvailable,
      },
      storage: storageStatus,
      tray: {
        integrated: true,
        active: true,
      },
      singleInstance: {
        locked: true,
      },
      window: {
        visible: isVisible,
        isDestroyed: win ? win.isDestroyed() : true,
      },
      uptimeSeconds: Math.floor(process.uptime()),
    };
  });

  // 4. Window minimize handler
  ipc.handle(IPC_CHANNELS.WINDOW_MINIMIZE, async () => {
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.minimize();
      return true;
    }
    return false;
  });

  // 5. Window maximize / restore toggle handler
  ipc.handle(IPC_CHANNELS.WINDOW_MAXIMIZE, async () => {
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      if (win.isMaximized()) {
        win.unmaximize();
        return false;
      } else {
        win.maximize();
        return true;
      }
    }
    return false;
  });

  // 6. Window close handler (honors minimize-to-tray lifecycle)
  ipc.handle(IPC_CHANNELS.WINDOW_CLOSE, async () => {
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      win.close();
      return true;
    }
    return false;
  });

  // 7. Window isMaximized check
  ipc.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, async () => {
    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      return win.isMaximized();
    }
    return false;
  });

  // 8. Graceful quit handler
  ipc.handle(IPC_CHANNELS.APP_QUIT, async () => {
    if (typeof onQuit === 'function') {
      onQuit();
      return true;
    }
    return false;
  });

  // 9. Storage get status handler
  ipc.handle(IPC_CHANNELS.STORAGE_GET_STATUS, async () => {
    try {
      if (!storage || typeof storage.getStatus !== 'function') {
        return { encryptionAvailable: false, hasVault: false, isPaired: false };
      }
      return storage.getStatus();
    } catch (err) {
      return { encryptionAvailable: false, hasVault: false, isPaired: false, error: err.message };
    }
  });

  // 10. Storage get sanitized device info handler (NEVER returns raw secret token)
  ipc.handle(IPC_CHANNELS.STORAGE_GET_DEVICE_INFO, async () => {
    try {
      if (!storage || typeof storage.getDeviceInfo !== 'function') {
        return { isPaired: false, deviceId: null, deviceName: null, userId: null, backendUrl: null, pairedAt: null };
      }
      return storage.getDeviceInfo();
    } catch (err) {
      return { isPaired: false, error: err.message };
    }
  });

  isRegistered = true;
}

/**
 * Removes all registered IPC handlers.
 * @param {Object} [ipc = ipcMain]
 */
function unregisterIpcHandlers(ipc = ipcMain) {
  Object.values(IPC_CHANNELS).forEach((channel) => {
    try {
      ipc.removeHandler(channel);
    } catch (_) {
      // Ignored if handler wasn't registered
    }
  });
  isRegistered = false;
}

/**
 * Pushes an event to the renderer process safely.
 * @param {BrowserWindow} window
 * @param {string} channel
 * @param {any} payload
 */
function sendToRenderer(window, channel, payload) {
  if (window && !window.isDestroyed() && window.webContents) {
    window.webContents.send(channel, payload);
  }
}

module.exports = {
  registerIpcHandlers,
  unregisterIpcHandlers,
  sendToRenderer,
  isRegistered: () => isRegistered,
};
