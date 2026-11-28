/**
 * NEXA 2.0 Desktop Agent - Configuration & Security Constants
 * Phase 6 — Milestone 3.1
 */

const path = require('path');

// Permitted IPC channels for renderer-to-main communication
const IPC_CHANNELS = Object.freeze({
  PING: 'nexa:ping',
  GET_APP_INFO: 'nexa:get-app-info',
  GET_SYSTEM_STATUS: 'nexa:get-system-status',
  WINDOW_MINIMIZE: 'nexa:window-minimize',
  WINDOW_MAXIMIZE: 'nexa:window-maximize',
  WINDOW_CLOSE: 'nexa:window-close',
  WINDOW_IS_MAXIMIZED: 'nexa:window-is-maximized',
  APP_QUIT: 'nexa:app-quit',
  STORAGE_GET_STATUS: 'nexa:storage-get-status',
  STORAGE_GET_DEVICE_INFO: 'nexa:storage-get-device-info',
  PAIRING_CLAIM: 'nexa:pairing-claim',
  PAIRING_CANCEL: 'nexa:pairing-cancel',
  PAIRING_GET_STATUS: 'nexa:pairing-get-status',
  DEVICE_AUTH_GET_STATUS: 'nexa:device-auth-get-status',
  DEVICE_AUTH_AUTHENTICATE: 'nexa:device-auth-authenticate',
  DEVICE_AUTH_VERIFY: 'nexa:device-auth-verify',
  DEVICE_AUTH_UNPAIR: 'nexa:device-auth-unpair',
  HEARTBEAT_GET_STATUS: 'nexa:heartbeat-get-status',
  HEARTBEAT_START: 'nexa:heartbeat-start',
  HEARTBEAT_STOP: 'nexa:heartbeat-stop',
  HEARTBEAT_SEND_NOW: 'nexa:heartbeat-send-now',
});

// Permitted IPC channels for main-to-renderer push events
const IPC_EVENTS = Object.freeze({
  TRAY_EVENT: 'nexa:tray-event',
  STATUS_CHANGED: 'nexa:status-changed',
  WINDOW_STATE_CHANGED: 'nexa:window-state-changed',
  STORAGE_STATUS_CHANGED: 'nexa:storage-status-changed',
  PAIRING_STATUS_CHANGED: 'nexa:pairing-status-changed',
  DEVICE_AUTH_STATUS_CHANGED: 'nexa:device-auth-status-changed',
  HEARTBEAT_STATUS_CHANGED: 'nexa:heartbeat-status-changed',
});

// Window geometry and presentation defaults matching NEXA 2.0 design
const WINDOW_CONFIG = Object.freeze({
  width: 1040,
  height: 720,
  minWidth: 840,
  minHeight: 580,
  title: 'NEXA 2.0 Desktop Agent',
  backgroundColor: '#070a12',
  show: false, // Prevents white flash before content loads
  frame: false, // Custom frameless titlebar matching NEXA 2.0 styling
  titleBarStyle: 'hidden',
});

// Strict security preferences for webPreferences
const SECURITY_CONFIG = Object.freeze({
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInWorker: false,
  nodeIntegrationInSubFrames: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
});

// System paths
const PATHS = Object.freeze({
  preload: path.join(__dirname, '..', 'preload', 'index.js'),
  rendererHtml: path.join(__dirname, '..', 'renderer', 'index.html'),
  icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
  trayIcon: path.join(__dirname, '..', '..', 'assets', 'tray-icon.png'),
});

module.exports = {
  IPC_CHANNELS,
  IPC_EVENTS,
  WINDOW_CONFIG,
  SECURITY_CONFIG,
  PATHS,
};
