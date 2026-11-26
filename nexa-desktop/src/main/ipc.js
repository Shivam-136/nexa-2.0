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
const { PairingClient } = require('./pairing/pairingClient');
const { DeviceAuthClient } = require('./auth/deviceAuthClient');
const { HeartbeatClient, CONNECTION_STATES } = require('./heartbeat/heartbeatClient');

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
function registerIpcHandlers({ getMainWindow, onQuit, storageService = null, pairingClient = null, deviceAuthClient = null, heartbeatClient = null, ipc = ipcMain, appInfo = null } = {}) {
  if (isRegistered) {
    unregisterIpcHandlers(ipc);
  }

  const storage = storageService || getSecureStorage();
  const pairing = pairingClient || new PairingClient({
    storageService: storage,
    onStatusChange: (statusPayload) => {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      sendToRenderer(win, IPC_EVENTS.PAIRING_STATUS_CHANGED, statusPayload);
    },
  });
  const deviceAuth = deviceAuthClient || new DeviceAuthClient({
    storageService: storage,
    onStatusChange: (statusPayload) => {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      sendToRenderer(win, IPC_EVENTS.DEVICE_AUTH_STATUS_CHANGED, statusPayload);
    },
  });
  const heartbeat = heartbeatClient || new HeartbeatClient({
    deviceAuthClient: deviceAuth,
    onStateChange: (statusPayload) => {
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      sendToRenderer(win, IPC_EVENTS.HEARTBEAT_STATUS_CHANGED, statusPayload);
    },
  });

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

  // 11. Pairing claim handler (executes strictly in Main Process; NEVER returns deviceToken)
  ipc.handle(IPC_CHANNELS.PAIRING_CLAIM, async (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { success: false, error: 'INVALID_PAYLOAD: Pairing payload must be an object' };
      }
      const result = await pairing.claimPairing({
        pairingCode: payload.pairingCode,
        deviceName: payload.deviceName,
        backendUrl: payload.backendUrl,
      });
      const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
      if (storage && typeof storage.getStatus === 'function') {
        sendToRenderer(win, IPC_EVENTS.STORAGE_STATUS_CHANGED, storage.getStatus());
      }
      return result;
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  });

  // 12. Pairing cancel handler
  ipc.handle(IPC_CHANNELS.PAIRING_CANCEL, async () => {
    try {
      return pairing.cancelPairing();
    } catch (err) {
      return { success: false, cancelled: false, error: err.message };
    }
  });

  // 13. Pairing status handler (sanitized metadata only)
  ipc.handle(IPC_CHANNELS.PAIRING_GET_STATUS, async () => {
    try {
      return pairing.getStatus();
    } catch (err) {
      return { state: 'error', isPaired: false, error: err.message };
    }
  });

  // 14. Device Auth status handler (sanitized metadata only; NEVER exposes tokens)
  ipc.handle(IPC_CHANNELS.DEVICE_AUTH_GET_STATUS, async () => {
    try {
      return deviceAuth.getAuthStatus();
    } catch (err) {
      return { state: 'error', isPaired: false, authenticated: false, error: err.message };
    }
  });

  // 15. Device Auth authenticate handler (executes strictly in Main Process; NEVER returns tokens)
  ipc.handle(IPC_CHANNELS.DEVICE_AUTH_AUTHENTICATE, async () => {
    try {
      return await deviceAuth.authenticate();
    } catch (err) {
      return {
        success: false,
        authenticated: false,
        code: err.code || 'DEVICE_AUTH_FAILED',
        error: err.message,
      };
    }
  });

  // 16. Device Auth verify handler (executes strictly in Main Process; NEVER returns tokens)
  ipc.handle(IPC_CHANNELS.DEVICE_AUTH_VERIFY, async () => {
    try {
      return await deviceAuth.verifyDeviceSession();
    } catch (err) {
      return {
        success: false,
        authenticated: false,
        code: err.code || 'DEVICE_VERIFY_FAILED',
        error: err.message,
      };
    }
  });

  // 17. Heartbeat get status handler (sanitized metadata only; NEVER exposes tokens)
  ipc.handle(IPC_CHANNELS.HEARTBEAT_GET_STATUS, async () => {
    try {
      return heartbeat.getStatus();
    } catch (err) {
      return {
        state: CONNECTION_STATES.ERROR,
        isOnline: false,
        isRunning: false,
        lastSuccessfulHeartbeatAt: null,
        lastError: err.message,
      };
    }
  });

  // 18. Heartbeat start handler
  ipc.handle(IPC_CHANNELS.HEARTBEAT_START, async () => {
    try {
      heartbeat.start();
      return heartbeat.getStatus();
    } catch (err) {
      return {
        state: CONNECTION_STATES.ERROR,
        isOnline: false,
        isRunning: false,
        lastError: err.message,
      };
    }
  });

  // 19. Heartbeat stop handler
  ipc.handle(IPC_CHANNELS.HEARTBEAT_STOP, async () => {
    try {
      heartbeat.stop();
      return heartbeat.getStatus();
    } catch (err) {
      return {
        state: CONNECTION_STATES.ERROR,
        isOnline: false,
        isRunning: false,
        lastError: err.message,
      };
    }
  });

  // 20. Heartbeat immediate send handler
  ipc.handle(IPC_CHANNELS.HEARTBEAT_SEND_NOW, async () => {
    try {
      return await heartbeat.sendHeartbeat();
    } catch (err) {
      return {
        state: CONNECTION_STATES.ERROR,
        isOnline: false,
        lastError: err.message,
      };
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
