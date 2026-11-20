/**
 * NEXA 2.0 Desktop Agent - BrowserWindow Manager
 * Phase 6 — Milestone 3.1
 *
 * Implements hardened security configurations:
 * - contextIsolation: true
 * - nodeIntegration: false
 * - sandbox: true
 * - minimize-to-tray on close
 * - navigation and window-open guardrails
 */

const electron = require('electron');
const path = require('path');
const { WINDOW_CONFIG, SECURITY_CONFIG, PATHS, IPC_EVENTS } = require('./config');
const { sendToRenderer } = require('./ipc');

const { BrowserWindow, shell } = (typeof electron === 'object' && electron !== null) ? electron : {};

let mainWindow = null;

/**
 * Creates and configures the primary application BrowserWindow.
 * @param {Object} options
 * @param {Function} options.isQuitting - Function returning boolean whether app is shutting down
 * @param {Object} [options.windowConstructor = BrowserWindow] - For dependency injection in tests
 * @param {string} [options.htmlPath = PATHS.rendererHtml] - HTML file to load
 * @returns {BrowserWindow}
 */
function createMainWindow({
  isQuitting = () => false,
  windowConstructor = BrowserWindow,
  htmlPath = PATHS.rendererHtml,
} = {}) {
  const windowOptions = {
    ...WINDOW_CONFIG,
    icon: PATHS.icon,
    webPreferences: {
      ...SECURITY_CONFIG,
      preload: PATHS.preload,
    },
  };

  mainWindow = new windowConstructor(windowOptions);

  // Load the hardened local renderer HTML
  if (typeof mainWindow.loadFile === 'function') {
    mainWindow.loadFile(htmlPath);
  }

  // Smooth appearance when ready to prevent white flash
  if (typeof mainWindow.once === 'function') {
    mainWindow.once('ready-to-show', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.show();
      }
    });
  }

  // Minimize-to-tray behavior on close button
  if (typeof mainWindow.on === 'function') {
    mainWindow.on('close', (event) => {
      if (!isQuitting()) {
        if (event && typeof event.preventDefault === 'function') {
          event.preventDefault();
        }
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.hide();
          sendToRenderer(mainWindow, IPC_EVENTS.TRAY_EVENT, { action: 'minimized-to-tray' });
        }
      }
      // When isQuitting() === true, default close proceeds naturally
    });

    // Relay window state changes to renderer for custom titlebar updates
    const notifyWindowState = () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        sendToRenderer(mainWindow, IPC_EVENTS.WINDOW_STATE_CHANGED, {
          isMaximized: typeof mainWindow.isMaximized === 'function' ? mainWindow.isMaximized() : false,
          isMinimized: typeof mainWindow.isMinimized === 'function' ? mainWindow.isMinimized() : false,
        });
      }
    };

    mainWindow.on('maximize', notifyWindowState);
    mainWindow.on('unmaximize', notifyWindowState);
    mainWindow.on('minimize', notifyWindowState);
    mainWindow.on('restore', notifyWindowState);
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
  }

  // Hardened Navigation Security Guardrails:
  // 1. Prevent in-window navigation away from local bundle
  if (mainWindow.webContents && typeof mainWindow.webContents.on === 'function') {
    mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
      try {
        const parsedUrl = new URL(navigationUrl);
        const isFileProtocol = parsedUrl.protocol === 'file:';
        if (!isFileProtocol) {
          event.preventDefault();
          console.warn(`[NEXA Security] Blocked external in-window navigation to: ${navigationUrl}`);
        }
      } catch (_) {
        event.preventDefault();
      }
    });

    // 2. Safely delegate window.open / external links to system browser
    if (typeof mainWindow.webContents.setWindowOpenHandler === 'function') {
      mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        try {
          const parsed = new URL(url);
          if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
            if (shell && typeof shell.openExternal === 'function') {
              shell.openExternal(url);
            }
          }
        } catch (err) {
          console.warn('[NEXA Security] Malformed external link prevented:', url);
        }
        return { action: 'deny' };
      });
    }
  }

  return mainWindow;
}

/**
 * Returns the current primary window instance.
 * @returns {BrowserWindow|null}
 */
function getMainWindow() {
  return mainWindow;
}

/**
 * Sets the main window reference (useful for testing).
 * @param {BrowserWindow|null} win
 */
function setMainWindow(win) {
  mainWindow = win;
}

module.exports = {
  createMainWindow,
  getMainWindow,
  setMainWindow,
};
