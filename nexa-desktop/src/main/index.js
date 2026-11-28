/**
 * NEXA 2.0 Desktop Agent - Main Process Entry Point
 * Phase 6 — Milestone 3.1: Foundational Electron Windows Desktop Agent
 *
 * Architecture Highlights:
 * - Single Instance Lock enforcement
 * - Secure Preload with Context Isolation & Sandbox enabled
 * - Node integration strictly disabled
 * - Whitelisted & input-validated IPC communication
 * - Windows System Tray integration with minimize-to-tray
 * - Graceful application lifecycle shutdown
 */

const { app } = require('electron');
const { initSingleInstanceLock } = require('./singleInstance');
const { createMainWindow, getMainWindow } = require('./window');
const { createTray } = require('./tray');
const { registerIpcHandlers } = require('./ipc');
const { isQuitting, setQuitting, gracefulShutdown } = require('./lifecycle');
const { getSecureStorage } = require('./storage');
const { PairingClient } = require('./pairing/pairingClient');
const { DeviceAuthClient } = require('./auth/deviceAuthClient');
const { HeartbeatClient } = require('./heartbeat/heartbeatClient');

/**
 * Bootstrap the NEXA 2.0 Desktop Agent application.
 */
function bootstrap() {
  // Step 1: Single Instance Lock
  const hasLock = initSingleInstanceLock({
    appInstance: app,
    getMainWindow,
  });

  if (!hasLock) {
    // Secondary instance has called app.quit() and will terminate
    return;
  }

  // Step 2: Lifecycle hook before-quit
  app.on('before-quit', () => {
    setQuitting(true);
  });

  // Step 3: Handle window-all-closed (Windows tray daemon pattern)
  app.on('window-all-closed', () => {
    if (isQuitting()) {
      app.quit();
    }
    // Otherwise keep the process active in the system tray
  });

  // Step 4: Handle activate (re-open window if clicked or activated)
  app.on('activate', () => {
    const win = getMainWindow();
    if (!win) {
      createMainWindow({ isQuitting });
    } else if (!win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    }
  });

  // Step 5: Application initialization when Electron is ready
  app.whenReady().then(() => {
    console.info('====================================================');
    console.info(' NEXA 2.0 Desktop Agent - Core Daemon Starting...  ');
    console.info(' Milestone 3.2: Secure Device Storage (DPAPI)       ');
    console.info(' Security: ContextIsolation=ON | Sandbox=ON        ');
    console.info(' NodeIntegration: OFF | SingleInstance: LOCKED      ');
    console.info('====================================================');

    // Initialize Secure Device Storage service (safeStorage / DPAPI check)
    const storageService = getSecureStorage();
    storageService.init();

    // Initialize Device Pairing Client (Main Process only)
    const { sendToRenderer } = require('./ipc');
    const { IPC_EVENTS } = require('./config');
    const pairingClient = new PairingClient({
      storageService,
      onStatusChange: (statusPayload) => {
        sendToRenderer(getMainWindow(), IPC_EVENTS.PAIRING_STATUS_CHANGED, statusPayload);
      },
    });

    // Initialize Device Authentication Client (Main Process only)
    let heartbeatClient = null;
    const deviceAuthClient = new DeviceAuthClient({
      storageService,
      onStatusChange: (statusPayload) => {
        sendToRenderer(getMainWindow(), IPC_EVENTS.DEVICE_AUTH_STATUS_CHANGED, statusPayload);
        if (heartbeatClient && statusPayload?.state === 'authenticated' && !heartbeatClient.getStatus().isRunning) {
          heartbeatClient.start();
        } else if (heartbeatClient && statusPayload?.state === 'revoked') {
          heartbeatClient.stop({ nextState: 'REVOKED' });
        }
      },
    });

    // Initialize Heartbeat Client (Main Process only)
    heartbeatClient = new HeartbeatClient({
      deviceAuthClient,
      onStateChange: (statusPayload) => {
        sendToRenderer(getMainWindow(), IPC_EVENTS.HEARTBEAT_STATUS_CHANGED, statusPayload);
      },
    });

    app.on('before-quit', () => {
      heartbeatClient.stop();
      deviceAuthClient.clearSession();
    });

    // Register validated IPC handlers
    registerIpcHandlers({
      getMainWindow,
      onQuit: () => gracefulShutdown(app),
      storageService,
      pairingClient,
      deviceAuthClient,
      heartbeatClient,
    });

    // Automatically authenticate & start heartbeat if device is already paired;
    // on recoverable startup outage, start HeartbeatClient so exponential backoff recovers automatically.
    if (storageService.hasCredentials()) {
      deviceAuthClient.authenticate().catch((err) => {
        console.warn('[NEXA Main] Startup device authentication deferred:', err.message);
        const code = err?.code || '';
        const isPermanentStop =
          code === 'DEVICE_REVOKED' ||
          code === 'DEVICE_QUARANTINED' ||
          String(err?.message || '').includes('NEXA_ERR_ENCRYPTION_UNAVAILABLE');
        if (!isPermanentStop && heartbeatClient && !heartbeatClient.getStatus().isRunning) {
          heartbeatClient.start();
        }
      });
    }

    // Initialize Windows System Tray
    createTray({
      getMainWindow,
      onQuit: () => gracefulShutdown(app),
    });

    // Create the primary desktop window
    createMainWindow({
      isQuitting,
    });
  }).catch((err) => {
    console.error('[NEXA Main] Fatal initialization error:', err);
    app.quit();
  });
}

// Start application
bootstrap();

module.exports = {
  bootstrap,
};
