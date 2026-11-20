/**
 * NEXA 2.0 Desktop Agent - Application Lifecycle & Graceful Shutdown
 * Phase 6 — Milestone 3.1
 *
 * Coordinates startup, background daemon persistence, minimize-to-tray,
 * and orderly process teardown.
 */

const electron = require('electron');
const { destroyTray } = require('./tray');
const { unregisterIpcHandlers } = require('./ipc');
const { getMainWindow } = require('./window');

const { app } = (typeof electron === 'object' && electron !== null) ? electron : {};

let isQuittingState = false;

/**
 * Checks whether the application is currently in an orderly shutdown process.
 * @returns {boolean}
 */
function isQuitting() {
  return isQuittingState;
}

/**
 * Sets the quitting flag.
 * @param {boolean} value
 */
function setQuitting(value = true) {
  isQuittingState = Boolean(value);
}

/**
 * Initiates graceful application shutdown:
 * 1. Sets isQuitting = true so window close handler permits destruction
 * 2. Destroys system tray icon cleanly
 * 3. Unregisters all IPC handlers
 * 4. Destroys or closes the main BrowserWindow
 * 5. Calls app.quit()
 * @param {Object} [appInstance = app]
 */
function gracefulShutdown(appInstance = app) {
  if (isQuittingState) {
    return;
  }
  console.info('[NEXA Main] Commencing graceful application shutdown...');
  isQuittingState = true;

  // 1. Destroy system tray icon
  try {
    destroyTray();
  } catch (err) {
    console.warn('[NEXA Main] Warning destroying tray during shutdown:', err.message);
  }

  // 2. Unregister IPC handlers
  try {
    unregisterIpcHandlers();
  } catch (err) {
    console.warn('[NEXA Main] Warning unregistering IPC during shutdown:', err.message);
  }

  // 3. Destroy main window if open
  try {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      if (typeof win.destroy === 'function') {
        win.destroy();
      } else if (typeof win.close === 'function') {
        win.close();
      }
    }
  } catch (err) {
    console.warn('[NEXA Main] Warning destroying window during shutdown:', err.message);
  }

  // 4. Terminate Electron process
  try {
    if (appInstance && typeof appInstance.quit === 'function') {
      appInstance.quit();
    }
  } catch (err) {
    console.error('[NEXA Main] Error calling app.quit():', err.message);
  }
}

/**
 * Resets lifecycle state (useful for tests).
 */
function resetLifecycleState() {
  isQuittingState = false;
}

module.exports = {
  isQuitting,
  setQuitting,
  gracefulShutdown,
  resetLifecycleState,
};
