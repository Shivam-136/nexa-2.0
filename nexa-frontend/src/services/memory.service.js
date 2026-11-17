import { API_ENDPOINTS } from '../utils/constants.js';

const BASE_URL = API_ENDPOINTS.BASE_URL;

/**
 * Retrieves saved persistent memories from the backend.
 *
 * @param {Object} [params]
 * @param {string} [params.category] - Filter by category
 * @param {string} [params.search] - Search keyword
 * @param {number} [params.page=1]
 * @param {number} [params.limit=50]
 * @returns {Promise<{ success: boolean, memories: Array, total: number, page: number, totalPages: number }>}
 */
export async function fetchMemories({ category, search, page = 1, limit = 50 } = {}) {
  const query = new URLSearchParams();
  if (category && category !== 'All') query.set('category', category);
  if (search && search.trim()) query.set('search', search.trim());
  if (page) query.set('page', String(page));
  if (limit) query.set('limit', String(limit));

  const url = `${BASE_URL}/memories?${query.toString()}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || `Failed to fetch memories (${response.status})`);
    }

    return await response.json();
  } catch (err) {
    console.error('[Memory Service Fetch Error]:', err.message);
    throw err;
  }
}

/**
 * Manually creates or saves a new memory.
 *
 * @param {Object} params
 * @param {string} params.value - Memory statement or preference
 * @param {string} [params.category='preference']
 * @param {string} [params.key]
 * @returns {Promise<{ success: boolean, memory: Object, isNew: boolean, message: string }>}
 */
export async function createMemory({ value, category = 'preference', key, rawInput }) {
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new Error('Memory value cannot be empty.');
  }

  const url = `${BASE_URL}/memories`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        value: value.trim(),
        category,
        key: key?.trim(),
        rawInput: rawInput || value.trim(),
      }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Failed to save memory (${response.status})`);
    }

    return data;
  } catch (err) {
    console.error('[Memory Service Create Error]:', err.message);
    throw err;
  }
}

/**
 * Deletes an individual memory by ID.
 *
 * @param {string} id
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function deleteMemory(id) {
  if (!id) throw new Error('Memory ID is required.');

  const url = `${BASE_URL}/memories/${id}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Failed to delete memory (${response.status})`);
    }

    return data;
  } catch (err) {
    console.error('[Memory Service Delete Error]:', err.message);
    throw err;
  }
}

/**
 * Clears all memories for the current user.
 *
 * @returns {Promise<{ success: boolean, deletedCount: number }>}
 */
export async function clearAllMemories() {
  const url = `${BASE_URL}/memories`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || `Failed to clear memories (${response.status})`);
    }

    return data;
  } catch (err) {
    console.error('[Memory Service Clear Error]:', err.message);
    throw err;
  }
}

/**
 * Retrieves persisted conversation sessions.
 *
 * @param {Object} [params]
 * @param {number} [params.page=1]
 * @param {number} [params.limit=30]
 * @returns {Promise<{ success: boolean, conversations: Array, total: number }>}
 */
export async function fetchConversations({ page = 1, limit = 30 } = {}) {
  const url = `${BASE_URL}/conversations?page=${page}&limit=${limit}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to fetch conversations (${response.status})`);
    }

    return await response.json();
  } catch (err) {
    console.error('[Conversations Fetch Error]:', err.message);
    throw err;
  }
}

/**
 * Retrieves a single conversation session with all messages.
 *
 * @param {string} id - Conversation ID
 * @returns {Promise<{ success: boolean, conversation: Object }>}
 */
export async function fetchConversation(id) {
  if (!id) throw new Error('Conversation ID is required.');
  const url = `${BASE_URL}/conversations/${id}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to load conversation (${response.status})`);
    }

    return await response.json();
  } catch (err) {
    console.error('[Conversation Detail Error]:', err.message);
    throw err;
  }
}

/**
 * Deletes a conversation session by ID.
 *
 * @param {string} id
 * @returns {Promise<{ success: boolean, message: string }>}
 */
export async function deleteConversation(id) {
  if (!id) throw new Error('Conversation ID is required.');
  const url = `${BASE_URL}/conversations/${id}`;

  try {
    const response = await fetch(url, {
      method: 'DELETE',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || `Failed to delete conversation (${response.status})`);
    }

    return await response.json();
  } catch (err) {
    console.error('[Conversation Delete Error]:', err.message);
    throw err;
  }
}

export default {
  fetchMemories,
  createMemory,
  deleteMemory,
  clearAllMemories,
  fetchConversations,
  fetchConversation,
  deleteConversation,
};
