import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareConversationHistory,
  sendChatMessage,
  checkBackendHealth,
  getAiBrainStatus,
  checkOllamaStatus,
} from '../services/chat.service.js';

describe('NEXA 2.0 Frontend Chat Service Test Suite', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. Conversation History Preparation', () => {
    it('should correctly format messages into user and assistant roles', () => {
      const messages = [
        { id: '1', sender: 'assistant', text: 'Welcome to NEXA!' },
        { id: '2', sender: 'user', text: 'What is Node.js?' },
        { id: '3', sender: 'assistant', text: 'Node.js is a runtime.' },
      ];

      const history = prepareConversationHistory(messages);
      assert.equal(history.length, 3);
      assert.deepEqual(history[0], { role: 'assistant', text: 'Welcome to NEXA!' });
      assert.deepEqual(history[1], { role: 'user', text: 'What is Node.js?' });
      assert.deepEqual(history[2], { role: 'assistant', text: 'Node.js is a runtime.' });
    });

    it('should ignore error messages and empty texts', () => {
      const messages = [
        { id: '1', sender: 'user', text: 'Hi' },
        { id: '2', sender: 'assistant', text: 'Error', isError: true },
        { id: '3', sender: 'user', text: '   ' },
        { id: '4', sender: 'unknown', text: 'Ignore me' },
      ];

      const history = prepareConversationHistory(messages);
      assert.equal(history.length, 1);
      assert.deepEqual(history[0], { role: 'user', text: 'Hi' });
    });

    it('should handle non-array gracefully', () => {
      assert.deepEqual(prepareConversationHistory(null), []);
      assert.deepEqual(prepareConversationHistory(undefined), []);
    });
  });

  describe('2. sendChatMessage Dispatcher', () => {
    it('should reject empty or whitespace-only messages', async () => {
      await assert.rejects(
        async () => {
          await sendChatMessage({ message: '   ' });
        },
        { message: 'Message cannot be empty.' }
      );
    });

    it('should successfully post message and return AI reply on 200 OK', async () => {
      globalThis.fetch = async (url, options) => {
        assert.ok(url.includes('/chat'));
        assert.equal(options.method, 'POST');
        const payload = JSON.parse(options.body);
        assert.equal(payload.message, 'Hello NEXA');
        assert.equal(payload.conversationId, 'conv-test-123');

        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            reply: 'Hello Operator! How can I assist you?',
            conversationId: 'conv-test-123',
            provider: 'ollama',
            model: 'llama3.2',
            fallbackUsed: false,
          }),
        };
      };

      const result = await sendChatMessage({
        message: 'Hello NEXA',
        conversationId: 'conv-test-123',
      });

      assert.equal(result.success, true);
      assert.equal(result.reply, 'Hello Operator! How can I assist you?');
      assert.equal(result.provider, 'ollama');
      assert.equal(result.model, 'llama3.2');
      assert.equal(result.fallbackUsed, false);
      assert.equal(result.conversationId, 'conv-test-123');
    });

    it('should preserve fallbackUsed true and provider metadata when Gemini fallback occurred', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          reply: 'Response generated via cloud fallback.',
          conversationId: 'conv-fallback-456',
          provider: 'gemini',
          model: 'gemini-1.5-flash',
          fallbackUsed: true,
        }),
      });

      const result = await sendChatMessage({
        message: 'Compute complex task',
        conversationId: 'conv-fallback-456',
      });

      assert.equal(result.success, true);
      assert.equal(result.provider, 'gemini');
      assert.equal(result.model, 'gemini-1.5-flash');
      assert.equal(result.fallbackUsed, true);
    });

    it('should throw descriptive error on backend 400 or 500 response', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        json: async () => ({
          success: false,
          error: 'Field "message" is required',
        }),
      });

      await assert.rejects(
        async () => {
          await sendChatMessage({ message: 'Valid string' });
        },
        (err) => {
          assert.equal(err.status, 400);
          assert.equal(err.message, 'Field "message" is required');
          return true;
        }
      );
    });

    it('should identify network disconnection errors', async () => {
      globalThis.fetch = async () => {
        throw new TypeError('Failed to fetch');
      };

      await assert.rejects(
        async () => {
          await sendChatMessage({ message: 'Test network error' });
        },
        (err) => {
          assert.equal(err.isNetworkError, true);
          assert.ok(err.message.includes('Unable to connect to NEXA backend'));
          return true;
        }
      );
    });
  });

  describe('3. checkBackendHealth & getAiBrainStatus', () => {
    it('should parse healthy backend response accurately', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          status: 'ok',
          service: 'NEXA 2.0 AI Brain Core',
          gemini: {
            configured: true,
            model: 'gemini-2.5-flash',
          },
        }),
      });

      const health = await checkBackendHealth();
      assert.equal(health.isOnline, true);
      assert.equal(health.geminiConfigured, true);
      assert.equal(health.model, 'gemini-2.5-flash');
    });

    it('should return isOnline false when backend fetch fails', async () => {
      globalThis.fetch = async () => {
        throw new Error('Connection refused');
      };

      const health = await checkBackendHealth();
      assert.equal(health.isOnline, false);
      assert.equal(health.geminiConfigured, false);
      assert.equal(health.model, 'unknown');
    });
  });

  describe('4. checkOllamaStatus Service Method', () => {
    it('should query /chat/ollama/status and return connection telemetry and models', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.includes('/chat/ollama/status'));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            isConnected: true,
            status: 'connected',
            baseUrl: 'http://127.0.0.1:11434',
            models: ['llama3.2:latest', 'mistral:latest'],
          }),
        };
      };

      const status = await checkOllamaStatus();
      assert.equal(status.isConnected, true);
      assert.equal(status.status, 'connected');
      assert.equal(status.baseUrl, 'http://127.0.0.1:11434');
      assert.deepEqual(status.models, ['llama3.2:latest', 'mistral:latest']);
    });

    it('should append custom baseUrl as encoded query parameter', async () => {
      globalThis.fetch = async (url) => {
        assert.ok(url.includes('baseUrl=http%3A%2F%2Flocalhost%3A11434'));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            isConnected: true,
            status: 'connected',
            baseUrl: 'http://localhost:11434',
            models: ['qwen2.5:latest'],
          }),
        };
      };

      const status = await checkOllamaStatus({ baseUrl: 'http://localhost:11434' });
      assert.equal(status.isConnected, true);
      assert.equal(status.baseUrl, 'http://localhost:11434');
    });

    it('should safely return disconnected when backend returns non-ok status', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          success: false,
          isConnected: false,
          status: 'disconnected',
          error: 'Ollama daemon is offline',
        }),
      });

      const status = await checkOllamaStatus();
      assert.equal(status.isConnected, false);
      assert.equal(status.status, 'error');
      assert.ok(status.error.includes('Ollama daemon is offline'));
    });

    it('should catch fetch exceptions and return disconnected without throwing', async () => {
      globalThis.fetch = async () => {
        throw new Error('Network timeout');
      };

      const status = await checkOllamaStatus();
      assert.equal(status.isConnected, false);
      assert.equal(status.status, 'disconnected');
      assert.ok(status.error.includes('Network timeout'));
    });
  });
});
