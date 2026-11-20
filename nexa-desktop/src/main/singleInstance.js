/**
 * NEXA 2.0 Desktop Agent - Single Instance Lock Management
 * Phase 6 — Milestone 3.1
 *
 * Ensures only one running instance of NEXA 2.0 Desktop Agent exists.
 * When a secondary instance attempts to launch, the primary instance
 * is restored, un-minimized, and brought to foreground focus.
 */

const { app } = require('electron');

/**
 * Initializes the single instance lock for the application.
 * @param {Object} options
 * @param {Object} [options.appInstance = app] - Electron app instance
 * @param {Function} options.getMainWindow - Function returning the primary BrowserWindow
 * @param {Function} [options.onSecondInstance] - Optional callback when second instance is detected
 * @returns {boolean} True if this process acquired the single instance lock; false otherwise
 */
function initSingleInstanceLock({
  appInstance = app,
  getMainWindow,
  onSecondInstance = null,
} = {}) {
  const gotTheLock = appInstance.requestSingleInstanceLock();

  if (!gotTheLock) {
    console.warn('[NEXA Main] Another instance of NEXA 2.0 Desktop Agent is already running. Exiting secondary instance.');
    appInstance.quit();
    return false;
  }

  appInstance.on('second-instance', (event, commandLine, workingDirectory) => {
    console.info('[NEXA Main] Second instance launch detected. Focusing primary window.');

    const win = typeof getMainWindow === 'function' ? getMainWindow() : null;
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) {
        win.restore();
      }
      if (!win.isVisible()) {
        win.show();
      }
      win.focus();
    }

    if (typeof onSecondInstance === 'function') {
      try {
        onSecondInstance(commandLine, workingDirectory);
      } catch (err) {
        console.error('[NEXA Main] Error in second-instance callback:', err);
      }
    }
  });

  return true;
}

module.exports = {
  initSingleInstanceLock,
};
