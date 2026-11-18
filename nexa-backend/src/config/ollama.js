import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Resolve .env path from nexa-backend root regardless of current working directory
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Default Ollama service configuration constants.
 */
export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_OLLAMA_TIMEOUT_MS = 60000;
export const DEFAULT_OLLAMA_MODEL = 'llama3.2';

/**
 * Checks whether a given hostname is a safe local loopback endpoint.
 * Restricts network access strictly to actual loopback addresses:
 * 127.0.0.1 (and 127.0.0.0/8), localhost, and ::1.
 * Destination 0.0.0.0, non-loopback IPs, and external domains are strictly prohibited.
 *
 * @param {string} hostname
 * @returns {boolean} True if strictly a local loopback address, false otherwise
 */
export function isLocalEndpoint(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const clean = hostname.trim().toLowerCase();
  const host = clean.endsWith('.') ? clean.slice(0, -1) : clean;

  // 0.0.0.0 and 0 are meta-addresses / non-routable interfaces, NEVER valid loopback destinations
  if (host === '0.0.0.0' || host === '0') return false;

  // localhost check
  if (host === 'localhost') return true;

  // IPv6 loopback check (::1) - bracketed or unbracketed
  const unbracketed = host.replace(/^\[|\]$/g, '');
  if (
    unbracketed === '::1' ||
    unbracketed === '0000:0000:0000:0000:0000:0000:0000:0001' ||
    unbracketed === '0:0:0:0:0:0:0:1'
  ) {
    return true;
  }

  // IPv4 loopback check (strictly 127.0.0.0/8)
  if (/^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/.test(host)) {
    return true;
  }

  return false;
}

/**
 * Validates an Ollama base URL and ensures it points strictly to an authorized loopback endpoint.
 * Prevents hostname tricks, embedded credentials, query/fragment manipulation, and SSRF.
 *
 * @param {string} urlString
 * @returns {string} Normalized base URL (e.g. "http://127.0.0.1:11434")
 * @throws {Error} If URL is invalid, non-http(s), contains credentials/queries, or points to a non-loopback destination.
 */
export function validateOllamaBaseUrl(urlString) {
  if (!urlString || typeof urlString !== 'string') {
    throw new Error('Ollama base URL must be a non-empty string.');
  }

  let parsed;
  try {
    parsed = new URL(urlString.trim());
  } catch {
    throw new Error(`Invalid Ollama base URL format: "${urlString}". Must be a valid URL.`);
  }

  // Enforce protocol
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Invalid Ollama protocol: "${parsed.protocol}". Only HTTP and HTTPS protocols are supported.`
    );
  }

  // Prevent credential leakage or embedding tricks (e.g. http://localhost@attacker.com)
  if (parsed.username || parsed.password) {
    throw new Error('Ollama base URL must not contain authentication credentials.');
  }

  // Prevent query parameter or fragment injection
  if (parsed.search || parsed.hash) {
    throw new Error('Ollama base URL must not contain query parameters or fragments.');
  }

  // Validate port range if specified
  if (parsed.port) {
    const portNum = Number(parsed.port);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      throw new Error(`Invalid Ollama port: "${parsed.port}". Port must be between 1 and 65535.`);
    }
  }

  // Strictly verify destination is a valid loopback address (rejects 0.0.0.0, private RFC1918, public IPs, and external domains)
  if (!isLocalEndpoint(parsed.hostname)) {
    throw new Error(
      `Unsafe Ollama base URL "${urlString}". Only local loopback endpoints (e.g. 127.0.0.1, localhost, ::1) are permitted in local-only configuration (0.0.0.0 and remote destinations are strictly prohibited).`
    );
  }

  // Return standard normalized origin (protocol + host, e.g. "http://127.0.0.1:11434")
  return `${parsed.protocol}//${parsed.host}`;
}

/**
 * Retrieves the validated Ollama base URL from environment or default.
 *
 * @returns {string} Normalized base URL
 */
export function getOllamaBaseUrl() {
  const configured = process.env.OLLAMA_BASE_URL || DEFAULT_OLLAMA_BASE_URL;
  return validateOllamaBaseUrl(configured);
}

/**
 * Retrieves the configured Ollama request timeout in milliseconds.
 *
 * @returns {number} Timeout in milliseconds
 */
export function getOllamaTimeoutMs() {
  const val = process.env.OLLAMA_REQUEST_TIMEOUT_MS;
  if (val) {
    const parsed = parseInt(val, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_OLLAMA_TIMEOUT_MS;
}

/**
 * Retrieves the default or configured Ollama model name.
 *
 * @returns {string} Model identifier
 */
export function getOllamaModel() {
  return process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
}

export default {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  DEFAULT_OLLAMA_MODEL,
  isLocalEndpoint,
  validateOllamaBaseUrl,
  getOllamaBaseUrl,
  getOllamaTimeoutMs,
  getOllamaModel,
};
