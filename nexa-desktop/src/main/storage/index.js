/**
 * NEXA 2.0 Desktop Agent - Secure Storage Module Barrel Export
 * Phase 6 — Milestone 3.2: Secure Device Storage
 */

const { SecureStorageService, VAULT_FILE_NAME, VAULT_FORMAT_HEADER, VAULT_VERSION } = require('./secureStorage');
const { validateCredentialPayload, redactDeviceCredentials } = require('./storageSchema');

let defaultInstance = null;

/**
 * Returns the active singleton SecureStorageService instance.
 * @param {Object} [options] - Initial configuration options if creating new instance
 * @returns {SecureStorageService}
 */
function getSecureStorage(options) {
  if (!defaultInstance) {
    defaultInstance = new SecureStorageService(options);
  }
  return defaultInstance;
}

/**
 * Overrides or resets the singleton instance (primarily for tests).
 * @param {SecureStorageService|null} instance
 */
function setSecureStorage(instance) {
  defaultInstance = instance;
}

module.exports = {
  SecureStorageService,
  getSecureStorage,
  setSecureStorage,
  validateCredentialPayload,
  redactDeviceCredentials,
  VAULT_FILE_NAME,
  VAULT_FORMAT_HEADER,
  VAULT_VERSION,
};
