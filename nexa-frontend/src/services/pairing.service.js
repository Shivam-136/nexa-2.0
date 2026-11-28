import apiClient from './apiClient.js';
import { API_ENDPOINTS } from '../utils/constants.js';

const PAIRING_BASE = API_ENDPOINTS.PAIRING || '/v1/pairing';

/**
 * Initiates a new short-lived device pairing session for the authenticated user.
 * @returns {Promise<{ success: boolean, sessionId: string, pairingCode: string, expiresAt: string, ttlSeconds: number, status: string }>}
 */
export async function initiatePairing() {
  return await apiClient.post(`${PAIRING_BASE}/initiate`, {});
}

/**
 * Fetches current pairing session status and connected devices from the backend.
 * @param {string|null} [sessionId]
 * @returns {Promise<{ success: boolean, activeSession: Object|null, connectedDevices: Array }>}
 */
export async function getPairingStatus(sessionId = null) {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : '';
  return await apiClient.get(`${PAIRING_BASE}/status${query}`);
}

/**
 * Cancels an active pending pairing session.
 * @param {string|null} [sessionId]
 * @returns {Promise<{ success: boolean, cancelled: boolean, sessionId: string|null, status: string }>}
 */
export async function cancelPairing(sessionId = null) {
  return await apiClient.post(`${PAIRING_BASE}/cancel`, sessionId ? { sessionId } : {});
}

/**
 * Securely unpairs and revokes an owned paired device.
 * @param {string} deviceId
 * @returns {Promise<{ success: boolean, unpaired: boolean, alreadyUnpaired?: boolean, deviceId: string, deviceGeneration: number, unpairedAt?: string }>}
 */
export async function unpairDevice(deviceId) {
  if (typeof deviceId !== 'string' || !deviceId.trim()) {
    throw new Error('Device ID is required to unpair a device');
  }
  const deviceBase = API_ENDPOINTS.DEVICE || '/v1/device';
  return await apiClient.delete(`${deviceBase}/${encodeURIComponent(deviceId.trim())}/unpair`);
}

export default {
  initiatePairing,
  getPairingStatus,
  cancelPairing,
  unpairDevice,
};
