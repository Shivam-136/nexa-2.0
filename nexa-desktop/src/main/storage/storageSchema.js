/**
 * NEXA 2.0 Desktop Agent - Secure Storage Schema & Redaction Guards
 * Phase 6 — Milestone 3.2: Secure Device Storage
 *
 * Implements strict payload validation, type/length guards, and
 * token redaction to ensure secret device tokens are NEVER leaked to the renderer.
 */

const MAX_STRING_LENGTH = 1024;
const MAX_ID_LENGTH = 128;
const MAX_NAME_LENGTH = 100;

/**
 * Validates and sanitizes device credentials before storage.
 * @param {any} payload
 * @returns {Object} Sanitized credentials object
 * @throws {TypeError|Error} If validation fails
 */
function validateCredentialPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Credential payload must be a non-null object');
  }

  const { deviceId, deviceName, deviceToken, userId, backendUrl, pairedAt } = payload;

  if (typeof deviceId !== 'string' || !deviceId.trim() || deviceId.trim().length > MAX_ID_LENGTH) {
    throw new Error(`Invalid deviceId: must be a non-empty string up to ${MAX_ID_LENGTH} characters`);
  }

  if (typeof deviceName !== 'string' || !deviceName.trim() || deviceName.trim().length > MAX_NAME_LENGTH) {
    throw new Error(`Invalid deviceName: must be a non-empty string up to ${MAX_NAME_LENGTH} characters`);
  }

  if (typeof deviceToken !== 'string' || !deviceToken.trim() || deviceToken.trim().length < 16 || deviceToken.trim().length > MAX_STRING_LENGTH) {
    throw new Error(`Invalid deviceToken: must be a string between 16 and ${MAX_STRING_LENGTH} characters`);
  }

  if (typeof userId !== 'string' || !userId.trim() || userId.trim().length > MAX_ID_LENGTH) {
    throw new Error(`Invalid userId: must be a non-empty string up to ${MAX_ID_LENGTH} characters`);
  }

  if (typeof backendUrl !== 'string' || !backendUrl.trim() || backendUrl.trim().length > MAX_STRING_LENGTH) {
    throw new Error('Invalid backendUrl: must be a non-empty valid URL string');
  }

  try {
    const parsed = new URL(backendUrl.trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('Protocol must be http: or https:');
    }
  } catch (err) {
    throw new Error(`Invalid backendUrl: ${err.message}`);
  }

  let sanitizedPairedAt = pairedAt;
  if (!sanitizedPairedAt || typeof sanitizedPairedAt !== 'string') {
    sanitizedPairedAt = new Date().toISOString();
  } else {
    sanitizedPairedAt = sanitizedPairedAt.trim();
  }

  return {
    deviceId: deviceId.trim(),
    deviceName: deviceName.trim(),
    deviceToken: deviceToken.trim(),
    userId: userId.trim(),
    backendUrl: backendUrl.trim(),
    pairedAt: sanitizedPairedAt,
  };
}

/**
 * Strips secret tokens and returns only safe, public device metadata.
 * Strictly guarantees deviceToken is NEVER returned to the Renderer.
 * @param {Object|null} credentials
 * @returns {Object} Redacted device metadata
 */
function redactDeviceCredentials(credentials) {
  if (!credentials || typeof credentials !== 'object') {
    return {
      isPaired: false,
      deviceId: null,
      deviceName: null,
      userId: null,
      backendUrl: null,
      pairedAt: null,
    };
  }

  return {
    isPaired: true,
    deviceId: credentials.deviceId || null,
    deviceName: credentials.deviceName || null,
    userId: credentials.userId || null,
    backendUrl: credentials.backendUrl || null,
    pairedAt: credentials.pairedAt || null,
  };
}

module.exports = {
  validateCredentialPayload,
  redactDeviceCredentials,
  MAX_STRING_LENGTH,
  MAX_ID_LENGTH,
  MAX_NAME_LENGTH,
};
