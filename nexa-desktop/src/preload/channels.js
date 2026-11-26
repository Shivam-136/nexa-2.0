/**
 * NEXA 2.0 Desktop Agent - Whitelisted Channels & IPC Validation
 * Phase 6 — Milestone 3.1
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

module.exports = {
  ALLOWED_INVOKE_CHANNELS,
  ALLOWED_RECEIVE_CHANNELS,
  MAX_PAYLOAD_STRING_LENGTH,
  isAllowedInvokeChannel,
  isAllowedReceiveChannel,
  validatePingPayload,
  validateCallback,
};
