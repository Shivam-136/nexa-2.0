/**
 * NEXA 2.0 Desktop Agent - Secure Preload Bridge
 * Phase 6 — Milestone 3.1
 *
 * Implements contextBridge exposure with strict context isolation,
 * zero Node.js integration, and validated IPC channels.
 * Raw ipcRenderer is strictly encapsulated and NEVER exposed.
 */

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Whitelisted IPC channels & input validation for sandboxed preload execution.
 * Preload scripts running with sandbox: true cannot resolve relative module dependencies (require('./channels')).
 * All channel whitelists and validation utilities are self-contained here to ensure seamless sandboxed execution.
 */
const ALLOWED_INVOKE_CHANNELS = new Set([
  'nexa:ping',
  'nexa:get-app-info',
  'nexa:get-system-status',
  'nexa:window-minimize',
  'nexa:window-maximize',
  'nexa:window-close',
  'nexa:window-is-maximized',
  'nexa:app-quit',
  'nexa:storage-get-status',
  'nexa:storage-get-device-info',
  'nexa:pairing-claim',
  'nexa:pairing-cancel',
  'nexa:pairing-get-status',
  'nexa:device-auth-get-status',
  'nexa:device-auth-authenticate',
  'nexa:device-auth-verify',
  'nexa:heartbeat-get-status',
  'nexa:heartbeat-start',
  'nexa:heartbeat-stop',
  'nexa:heartbeat-send-now',
]);

const ALLOWED_RECEIVE_CHANNELS = new Set([
  'nexa:tray-event',
  'nexa:status-changed',
  'nexa:window-state-changed',
  'nexa:storage-status-changed',
  'nexa:pairing-status-changed',
  'nexa:device-auth-status-changed',
  'nexa:heartbeat-status-changed',
]);

const MAX_PAYLOAD_STRING_LENGTH = 1024;

/**
 * Validates whether an IPC invoke channel is whitelisted.
 * @param {string} channel
 * @returns {boolean}
 */
function isAllowedInvokeChannel(channel) {
  return typeof channel === 'string' && ALLOWED_INVOKE_CHANNELS.has(channel);
}

/**
 * Validates whether an IPC receive channel is whitelisted.
 * @param {string} channel
 * @returns {boolean}
 */
function isAllowedReceiveChannel(channel) {
  return typeof channel === 'string' && ALLOWED_RECEIVE_CHANNELS.has(channel);
}

/**
 * Validates and sanitizes a ping payload string.
 * @param {any} input
 * @returns {string} Sanitized string
 * @throws {TypeError|RangeError} If input is invalid
 */
function validatePingPayload(input) {
  if (input === undefined || input === null) {
    return 'ping';
  }
  if (typeof input !== 'string') {
    throw new TypeError('Ping payload must be a string');
  }
  if (input.length > MAX_PAYLOAD_STRING_LENGTH) {
    throw new RangeError(`Ping payload exceeds maximum permitted length of ${MAX_PAYLOAD_STRING_LENGTH} characters`);
  }
  // Sanitize control characters
  return input.replace(/[\x00-\x1F\x7F]/g, '').trim();
}

/**
 * Validates an event callback function.
 * @param {any} callback
 * @throws {TypeError} If callback is not a function
 */
function validateCallback(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('IPC listener callback must be a valid function');
  }
}


/**
 * Creates a safe, filtered event subscriber.
 * @param {string} channel
 * @param {Function} callback
 * @returns {Function} Unsubscribe function
 */
function createSafeSubscriber(channel, callback) {
  validateCallback(callback);

  if (!isAllowedReceiveChannel(channel)) {
    throw new Error(`Unauthorized IPC event subscription channel: ${channel}`);
  }

  const safeListener = (_event, ...args) => {
    // Deliver sanitized arguments to callback, never exposing the internal IpcRendererEvent
    try {
      callback(...args);
    } catch (err) {
      console.error(`[NEXA Bridge] Error in IPC event handler for "${channel}":`, err);
    }
  };

  ipcRenderer.on(channel, safeListener);

  // Return idempotent cleanup function
  let cleanedUp = false;
  return () => {
    if (!cleanedUp) {
      ipcRenderer.removeListener(channel, safeListener);
      cleanedUp = true;
    }
  };
}

/**
 * Secure desktop agent API exposed to the renderer window.
 */
const nexaDesktopAPI = Object.freeze({
  /**
   * Health and round-trip verification ping.
   * @param {string} [message]
   * @returns {Promise<{ pong: boolean, timestamp: number, received: string }>}
   */
  ping: async (message = 'ping') => {
    const sanitized = validatePingPayload(message);
    return await ipcRenderer.invoke('nexa:ping', sanitized);
  },

  /**
   * Retrieves sanitized application and runtime metadata.
   * @returns {Promise<{ name: string, version: string, platform: string, arch: string, electronVersion: string, nodeVersion: string }>}
   */
  getAppInfo: async () => {
    return await ipcRenderer.invoke('nexa:get-app-info');
  },

  /**
   * Retrieves live system and agent security telemetry.
   * @returns {Promise<{ status: string, singleInstanceLocked: boolean, sandboxActive: boolean, contextIsolationActive: boolean, trayActive: boolean, uptime: number }>}
   */
  getSystemStatus: async () => {
    return await ipcRenderer.invoke('nexa:get-system-status');
  },

  /**
   * Minimizes the desktop window.
   * @returns {Promise<boolean>}
   */
  minimize: async () => {
    return await ipcRenderer.invoke('nexa:window-minimize');
  },

  /**
   * Toggles maximization of the desktop window.
   * @returns {Promise<boolean>} Current maximized state
   */
  maximize: async () => {
    return await ipcRenderer.invoke('nexa:window-maximize');
  },

  /**
   * Triggers window close (honors minimize-to-tray policy).
   * @returns {Promise<boolean>}
   */
  close: async () => {
    return await ipcRenderer.invoke('nexa:window-close');
  },

  /**
   * Checks whether the desktop window is currently maximized.
   * @returns {Promise<boolean>}
   */
  isMaximized: async () => {
    return await ipcRenderer.invoke('nexa:window-is-maximized');
  },

  /**
   * Requests graceful application shutdown.
   * @returns {Promise<boolean>}
   */
  quitApp: async () => {
    return await ipcRenderer.invoke('nexa:app-quit');
  },

  /**
   * Subscribes to system tray events (e.g. restore, minimize-to-tray).
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onTrayEvent: (callback) => {
    return createSafeSubscriber('nexa:tray-event', callback);
  },

  /**
   * Subscribes to status changes from the main process daemon.
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onStatusChange: (callback) => {
    return createSafeSubscriber('nexa:status-changed', callback);
  },

  /**
   * Subscribes to window state changes (e.g. maximized, restored).
   * @param {Function} callback
   * @returns {Function} Unsubscribe function
   */
  onWindowStateChange: (callback) => {
    return createSafeSubscriber('nexa:window-state-changed', callback);
  },

  /**
   * Secure Device Storage API backed by Windows DPAPI.
   * Encryption occurs strictly in Main Process. Raw device tokens are NEVER exposed.
   */
  storage: Object.freeze({
    /**
     * Checks storage status and safeStorage encryption availability.
     * @returns {Promise<{ encryptionAvailable: boolean, hasVault: boolean, isPaired: boolean }>}
     */
    getStatus: async () => {
      return await ipcRenderer.invoke('nexa:storage-get-status');
    },

    /**
     * Retrieves sanitized device metadata (GUARANTEE: deviceToken is strictly omitted).
     * @returns {Promise<{ isPaired: boolean, deviceId: string|null, deviceName: string|null, userId: string|null, backendUrl: string|null, pairedAt: string|null }>}
     */
    getDeviceInfo: async () => {
      return await ipcRenderer.invoke('nexa:storage-get-device-info');
    },

    /**
     * Subscribes to storage status change events.
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    onStatusChange: (callback) => {
      return createSafeSubscriber('nexa:storage-status-changed', callback);
    },
  }),

  /**
   * Device Pairing API (M3.4.1).
   * Pairing claim executes strictly in Main Process; deviceToken is NEVER exposed.
   */
  pairing: Object.freeze({
    /**
     * Claims a pairing code with the backend and stores credentials in DPAPI storage.
     * @param {{ pairingCode: string, deviceName?: string, backendUrl?: string }} payload
     * @returns {Promise<{ success: boolean, status?: string, deviceInfo?: Object, error?: string }>}
     */
    claim: async (payload) => {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new TypeError('Pairing claim payload must be an object');
      }
      if (typeof payload.pairingCode !== 'string' || !payload.pairingCode.trim()) {
        throw new TypeError('pairingCode must be a non-empty string');
      }
      const sanitized = {
        pairingCode: payload.pairingCode.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 32),
      };
      if (typeof payload.deviceName === 'string' && payload.deviceName.trim()) {
        sanitized.deviceName = payload.deviceName.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 100);
      }
      if (typeof payload.backendUrl === 'string' && payload.backendUrl.trim()) {
        sanitized.backendUrl = payload.backendUrl.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 512);
      }
      return await ipcRenderer.invoke('nexa:pairing-claim', sanitized);
    },

    /**
     * Cancels an in-flight pairing attempt.
     * @returns {Promise<{ success: boolean, cancelled: boolean, status: string }>}
     */
    cancel: async () => {
      return await ipcRenderer.invoke('nexa:pairing-cancel');
    },

    /**
     * Retrieves sanitized pairing status and connected account metadata.
     * @returns {Promise<{ state: string, isPaired: boolean, encryptionAvailable: boolean, deviceInfo: Object, lastError: string|null }>}
     */
    getStatus: async () => {
      return await ipcRenderer.invoke('nexa:pairing-get-status');
    },

    /**
     * Subscribes to pairing status change events.
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    onStatusChange: (callback) => {
      return createSafeSubscriber('nexa:pairing-status-changed', callback);
    },
  }),

  /**
   * Device Authentication Status API (M3.4.2).
   * Authentication & token rotation execute strictly in Main Process;
   * deviceToken, accessToken, and refreshToken are NEVER exposed.
   */
  deviceAuth: Object.freeze({
    /**
     * Retrieves sanitized device authentication status.
     * @returns {Promise<{ state: string, isPaired: boolean, authenticated: boolean, deviceId: string|null, deviceGeneration: number|null, userId: string|null, expiresAt: string|null, lastError: string|null }>}
     */
    getStatus: async () => {
      return await ipcRenderer.invoke('nexa:device-auth-get-status');
    },

    /**
     * Triggers device-to-backend authentication in the Main Process.
     * @returns {Promise<{ success: boolean, authenticated?: boolean, state?: string, error?: string }>}
     */
    authenticate: async () => {
      return await ipcRenderer.invoke('nexa:device-auth-authenticate');
    },

    /**
     * Verifies the active device session against the backend.
     * @returns {Promise<{ success: boolean, authenticated?: boolean, device?: Object, error?: string }>}
     */
    verify: async () => {
      return await ipcRenderer.invoke('nexa:device-auth-verify');
    },

    /**
     * Subscribes to device authentication status change events.
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    onStatusChange: (callback) => {
      return createSafeSubscriber('nexa:device-auth-status-changed', callback);
    },
  }),

  /**
   * Device Heartbeat & Connection State API (M3.4.3).
   * Heartbeat executes strictly in Main Process; tokens are NEVER exposed.
   */
  heartbeat: Object.freeze({
    /**
     * Retrieves sanitized connection status and heartbeat metadata.
     * @returns {Promise<{ state: string, isOnline: boolean, isRunning: boolean, deviceId: string|null, lastSuccessfulHeartbeatAt: string|null, lastError: string|null }>}
     */
    getStatus: async () => {
      return await ipcRenderer.invoke('nexa:heartbeat-get-status');
    },

    /**
     * Starts the periodic heartbeat loop in Main Process.
     * @returns {Promise<Object>}
     */
    start: async () => {
      return await ipcRenderer.invoke('nexa:heartbeat-start');
    },

    /**
     * Stops the periodic heartbeat loop in Main Process.
     * @returns {Promise<Object>}
     */
    stop: async () => {
      return await ipcRenderer.invoke('nexa:heartbeat-stop');
    },

    /**
     * Triggers an immediate authenticated heartbeat.
     * @returns {Promise<Object>}
     */
    sendNow: async () => {
      return await ipcRenderer.invoke('nexa:heartbeat-send-now');
    },

    /**
     * Subscribes to heartbeat connection state change events.
     * @param {Function} callback
     * @returns {Function} Unsubscribe function
     */
    onStatusChange: (callback) => {
      return createSafeSubscriber('nexa:heartbeat-status-changed', callback);
    },
  }),
});

// Expose strictly inside isolated world
try {
  contextBridge.exposeInMainWorld('nexaDesktop', nexaDesktopAPI);
} catch (error) {
  // If not running in Electron renderer (e.g. unit tests without Electron runtime), log safely
  console.warn('[NEXA Preload] contextBridge exposure skipped:', error.message);
}

// Export for unit test verification
module.exports = {
  nexaDesktopAPI,
  createSafeSubscriber,
  ALLOWED_INVOKE_CHANNELS,
  ALLOWED_RECEIVE_CHANNELS,
  MAX_PAYLOAD_STRING_LENGTH,
  isAllowedInvokeChannel,
  isAllowedReceiveChannel,
  validatePingPayload,
  validateCallback,
};
