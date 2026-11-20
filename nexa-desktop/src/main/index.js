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
    console.info(' Milestone 3.1: Foundational Windows Agent          ');
    console.info(' Security: ContextIsolation=ON | Sandbox=ON        ');
    console.info(' NodeIntegration: OFF | SingleInstance: LOCKED      ');
    console.info('====================================================');

    // Register validated IPC handlers
    registerIpcHandlers({
      getMainWindow,
      onQuit: () => gracefulShutdown(app),
    });

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
