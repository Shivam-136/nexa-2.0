import { API_ENDPOINTS } from '../utils/constants.js';
import { getAccessToken } from './auth.service.js';

const BASE_URL = API_ENDPOINTS.BASE_URL;

/**
 * Prepares the conversation history array for the backend API.
 * Maps application message models to clean `{ role: 'user' | 'assistant', text: string }` entries.
 *
 * @param {Array} messages - Chat messages from context state
 * @returns {Array} Sanitized history array
 */
export function prepareConversationHistory(messages = []) {
  if (!Array.isArray(messages)) return [];

  return messages
    .filter(
      (msg) =>
        msg &&
        (msg.sender === 'user' || msg.sender === 'assistant') &&
        typeof msg.text === 'string' &&
        msg.text.trim().length > 0 &&
        !msg.isError
    )
    .map((msg) => ({
      role: msg.sender === 'assistant' ? 'assistant' : 'user',
      text: msg.text.trim(),
    }));
}

/**
 * Dispatches a chat query to the NEXA 2.0 Gemini backend brain.
 *
 * @param {Object} options
 * @param {string} options.message - The user prompt or spoken query.
 * @param {Array} [options.conversationHistory=[]] - Historical session turns.
 * @param {string} [options.conversationId=null] - Persistent conversation thread ID.
 * @param {AbortSignal} [options.signal=null] - Optional abort signal for cancellations.
 * @returns {Promise<{ success: boolean, reply: string, conversationId: string, model: string }>}
 */
export async function sendChatMessage({
  message,
  conversationHistory = [],
  conversationId = null,
  signal = null,
}) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('Message cannot be empty.');
  }

  const endpoint = `${BASE_URL}/chat`;
  const sanitizedHistory = prepareConversationHistory(conversationHistory);

  const payload = {
    message: message.trim(),
    conversationHistory: sanitizedHistory,
  };

  if (conversationId) {
    payload.conversationId = conversationId;
  }

  try {
    const token = typeof getAccessToken === 'function' ? getAccessToken() : null;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify(payload),
      signal,
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const errorMessage =
        data.error ||
        data.message ||
        `Backend returned status ${response.status} (${response.statusText})`;
      const err = new Error(errorMessage);
      err.status = response.status;
      err.data = data;
      throw err;
    }

    if (!data.success || !data.reply) {
      throw new Error(data.error || 'Received an invalid response from the NEXA AI brain.');
    }

    return {
      success: true,
      reply: data.reply,
      conversationId: data.conversationId || conversationId,
      model: data.model || 'Gemini',
      memoryAction: data.memoryAction,
      memoriesUsed: data.memoriesUsed,
      memory: data.memory,
      timestamp: data.timestamp || new Date().toISOString(),
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('Request was canceled by the user.');
    }

    // Network level failure (e.g. backend server is not running)
    if (error instanceof TypeError && error.message.includes('fetch')) {
      const netErr = new Error(
        'Unable to connect to NEXA backend server (http://localhost:5000). Please start the backend service.'
      );
      netErr.isNetworkError = true;
      throw netErr;
    }

    throw error;
  }
}

/**
 * Queries the backend service health and Gemini configuration status.
 *
 * @returns {Promise<{ isOnline: boolean, geminiConfigured: boolean, model: string, details?: any, error?: string }>}
 */
export async function checkBackendHealth() {
  const endpoint = `${BASE_URL}/health`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        isOnline: false,
        geminiConfigured: false,
        model: 'unknown',
        error: `Health check failed with status ${response.status}`,
      };
    }

    const data = await response.json();
    return {
      isOnline: true,
      geminiConfigured: Boolean(data.gemini?.configured),
      model: data.gemini?.model || 'gemini-2.5-flash',
      details: data,
    };
  } catch (error) {
    return {
      isOnline: false,
      geminiConfigured: false,
      model: 'unknown',
      error: error.message || 'Backend unreachable',
    };
  }
}

/**
 * Retrieves AI Brain service readiness status.
 *
 * @returns {Promise<{ status: string, model: string, geminiConfigured: boolean }>}
 */
export async function getAiBrainStatus() {
  const endpoint = `${BASE_URL}/chat/status`;
  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      return { status: 'error', model: 'unknown', geminiConfigured: false };
    }
    return await response.json();
  } catch {
    return { status: 'offline', model: 'unknown', geminiConfigured: false };
  }
}

export default {
  sendChatMessage,
  checkBackendHealth,
  getAiBrainStatus,
  prepareConversationHistory,
};
