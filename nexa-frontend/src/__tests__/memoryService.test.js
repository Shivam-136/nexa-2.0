import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchMemories,
  createMemory,
  deleteMemory,
  clearAllMemories,
  fetchConversations,
  fetchConversation,
  deleteConversation,
} from '../services/memory.service.js';

describe('NEXA 2.0 Frontend Memory Service Test Suite', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. fetchMemories', () => {
    it('should query /memories endpoint with params and return JSON', async () => {
      let calledUrl = '';
      globalThis.fetch = async (url) => {
        calledUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            memories: [{ _id: '1', key: 'preferred_language', value: 'User prefers Hindi' }],
            total: 1,
          }),
        };
      };

      const result = await fetchMemories({ category: 'preference', search: 'Hindi' });
      assert.ok(calledUrl.includes('/memories'));
      assert.ok(calledUrl.includes('category=preference'));
      assert.ok(calledUrl.includes('search=Hindi'));
      assert.equal(result.success, true);
      assert.equal(result.memories.length, 1);
      assert.equal(result.memories[0].key, 'preferred_language');
    });

    it('should throw error when backend returns non-ok status', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Database error' }),
      });

      await assert.rejects(
        async () => fetchMemories(),
        /Database error/
      );
    });
  });

  describe('2. createMemory', () => {
    it('should reject empty or whitespace value', async () => {
      await assert.rejects(
        async () => createMemory({ value: '   ' }),
        /cannot be empty/
      );
    });

    it('should send POST request with trimmed value and category', async () => {
      let capturedBody = null;
      let capturedMethod = '';

      globalThis.fetch = async (url, options) => {
        capturedMethod = options.method;
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            isNew: true,
            memory: { _id: '123', value: 'Dark mode' },
          }),
        };
      };

      const res = await createMemory({
        value: '  Dark mode preference  ',
        category: 'preference',
        key: 'theme_mode',
      });

      assert.equal(capturedMethod, 'POST');
      assert.equal(capturedBody.value, 'Dark mode preference');
      assert.equal(capturedBody.category, 'preference');
      assert.equal(capturedBody.key, 'theme_mode');
      assert.equal(res.isNew, true);
    });
  });

  describe('3. deleteMemory & clearAllMemories', () => {
    it('should send DELETE request to /memories/:id', async () => {
      let calledUrl = '';
      let calledMethod = '';

      globalThis.fetch = async (url, options) => {
        calledUrl = url;
        calledMethod = options.method;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: 'Deleted' }),
        };
      };

      const res = await deleteMemory('mem_999');
      assert.ok(calledUrl.endsWith('/memories/mem_999'));
      assert.equal(calledMethod, 'DELETE');
      assert.equal(res.success, true);
    });

    it('should require memory ID for deletion', async () => {
      await assert.rejects(
        async () => deleteMemory(''),
        /ID is required/
      );
    });

    it('clearAllMemories should call DELETE /memories', async () => {
      let calledMethod = '';
      globalThis.fetch = async (url, options) => {
        calledMethod = options.method;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, deletedCount: 5 }),
        };
      };

      const res = await clearAllMemories();
      assert.equal(calledMethod, 'DELETE');
      assert.equal(res.deletedCount, 5);
    });
  });

  describe('4. fetchConversations & fetchConversation', () => {
    it('fetchConversations should query /conversations with pagination', async () => {
      let calledUrl = '';
      globalThis.fetch = async (url) => {
        calledUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            conversations: [{ conversationId: 'c1', title: 'Intro' }],
            total: 1,
          }),
        };
      };

      const res = await fetchConversations({ page: 2, limit: 10 });
      assert.ok(calledUrl.includes('/conversations'));
      assert.ok(calledUrl.includes('page=2'));
      assert.ok(calledUrl.includes('limit=10'));
      assert.equal(res.total, 1);
    });

    it('fetchConversation should load single conversation with messages', async () => {
      let calledUrl = '';
      globalThis.fetch = async (url) => {
        calledUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            conversation: {
              conversationId: 'c123',
              messages: [{ sender: 'user', text: 'Hi' }],
            },
          }),
        };
      };

      const res = await fetchConversation('c123');
      assert.ok(calledUrl.endsWith('/conversations/c123'));
      assert.equal(res.conversation.messages.length, 1);
    });
  });
});
