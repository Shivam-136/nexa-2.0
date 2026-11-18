import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  routeChatRequest,
  resolveProvider,
  SUPPORTED_PROVIDERS,
  DEFAULT_PROVIDER,
} from '../services/aiProvider.service.js';
import { handleChatMessage, getChatStatus, getOllamaConnectionStatus } from '../controllers/chat.controller.js';
import { errorHandler } from '../middleware/error.middleware.js';
import { detectMemoryIntent } from '../services/memory.service.js';

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
  };
  return res;
}

describe('NEXA 2.0 AI Provider Orchestration Suite (Milestone 2.3)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // =========================================================================
  // 1. Provider Preference Security & Resolution
  // =========================================================================
  describe('1. Provider Preference Security & Resolution', () => {
    it('should have standard default provider constants', () => {
      assert.equal(DEFAULT_PROVIDER, 'ollama');
      assert.deepEqual(SUPPORTED_PROVIDERS, ['ollama', 'gemini']);
    });

    it('should default strictly to "ollama" when user is missing or undefined', () => {
      assert.equal(resolveProvider(), 'ollama');
      assert.equal(resolveProvider(null), 'ollama');
      assert.equal(resolveProvider({}), 'ollama');
      assert.equal(resolveProvider({ aiProvider: undefined }), 'ollama');
      assert.equal(resolveProvider({ aiProvider: null }), 'ollama');
      assert.equal(resolveProvider({ aiProvider: '' }), 'ollama');
    });

    it('should correctly normalize valid case-insensitive provider values', () => {
      assert.equal(resolveProvider({ aiProvider: 'ollama' }), 'ollama');
      assert.equal(resolveProvider({ aiProvider: 'OLLAMA' }), 'ollama');
      assert.equal(resolveProvider({ aiProvider: '  ollama  ' }), 'ollama');
      assert.equal(resolveProvider({ aiProvider: 'gemini' }), 'gemini');
      assert.equal(resolveProvider({ aiProvider: 'GEMINI' }), 'gemini');
      assert.equal(resolveProvider({ aiProvider: '  Gemini  ' }), 'gemini');
    });

    it('should reject invalid provider strings safely with HTTP 400', () => {
      assert.throws(
        () => resolveProvider({ aiProvider: 'claude' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'INVALID_AI_PROVIDER');
          assert.ok(err.message.includes('Invalid AI provider: "claude"'));
          return true;
        }
      );

      assert.throws(
        () => resolveProvider({ aiProvider: 'openai' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'INVALID_AI_PROVIDER');
          return true;
        }
      );
    });

    it('should reject non-string provider types safely with HTTP 400', () => {
      assert.throws(
        () => resolveProvider({ aiProvider: 1234 }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'INVALID_AI_PROVIDER');
          assert.ok(err.message.includes('Expected string'));
          return true;
        }
      );

      assert.throws(
        () => resolveProvider({ aiProvider: true }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'INVALID_AI_PROVIDER');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // 2. Ollama Provider Routing
  // =========================================================================
  describe('2. Ollama Provider Routing', () => {
    it('should route to Ollama by default and return correct response metadata', async () => {
      let calledOllama = false;
      let passedParams = null;

      const mockOllama = async (params) => {
        calledOllama = true;
        passedParams = params;
        return {
          reply: 'Hello from local Ollama!',
          model: params.model,
        };
      };

      const result = await routeChatRequest({
        user: { id: 'u1', aiProvider: 'ollama', ollamaModel: 'llama3.2' },
        message: 'Hello NEXA',
        conversationHistory: [{ role: 'user', content: 'Hi' }],
        userContext: { userName: 'Shivam' },
        sessionId: 'session_123',
        memories: [{ category: 'preference', value: 'I speak English' }],
        _deps: { generateOllamaReply: mockOllama },
      });

      assert.equal(calledOllama, true);
      assert.equal(result.reply, 'Hello from local Ollama!');
      assert.equal(result.provider, 'ollama');
      assert.equal(result.model, 'llama3.2');
      assert.equal(result.fallbackUsed, false);

      assert.equal(passedParams.message, 'Hello NEXA');
      assert.equal(passedParams.model, 'llama3.2');
      assert.equal(passedParams.sessionId, 'session_123');
      assert.equal(passedParams.conversationHistory.length, 1);
      assert.equal(passedParams.memories.length, 1);
    });

    it('should respect authenticated user custom ollamaModel (e.g. qwen2.5, mistral)', async () => {
      let passedModel = null;
      const mockOllama = async (params) => {
        passedModel = params.model;
        return { reply: 'Local reply', model: params.model };
      };

      const result = await routeChatRequest({
        user: { id: 'u1', aiProvider: 'ollama', ollamaModel: 'qwen2.5:7b' },
        message: 'Compute code',
        _deps: { generateOllamaReply: mockOllama },
      });

      assert.equal(passedModel, 'qwen2.5:7b');
      assert.equal(result.model, 'qwen2.5:7b');
      assert.equal(result.provider, 'ollama');
      assert.equal(result.fallbackUsed, false);
    });

    it('should fallback to default Ollama model if user ollamaModel is unset', async () => {
      let passedModel = null;
      const mockOllama = async (params) => {
        passedModel = params.model;
        return { reply: 'Default model reply', model: params.model };
      };

      const result = await routeChatRequest({
        user: { id: 'u1', aiProvider: 'ollama' }, // no ollamaModel specified
        message: 'Hello',
        _deps: {
          generateOllamaReply: mockOllama,
          getOllamaModel: () => 'llama3.2',
        },
      });

      assert.equal(passedModel, 'llama3.2');
      assert.equal(result.model, 'llama3.2');
      assert.equal(result.provider, 'ollama');
      assert.equal(result.fallbackUsed, false);
    });
  });

  // =========================================================================
  // 3. Gemini Provider Routing
  // =========================================================================
  describe('3. Gemini Provider Routing', () => {
    it('should route to Gemini ONLY when explicitly selected', async () => {
      let calledGemini = false;
      let calledOllama = false;

      const mockGemini = async (params) => {
        calledGemini = true;
        return { reply: 'Hello from Google Gemini Cloud!', model: 'gemini-2.5-flash' };
      };

      const mockOllama = async () => {
        calledOllama = true;
        return { reply: 'From Ollama', model: 'llama3.2' };
      };

      const result = await routeChatRequest({
        user: { id: 'u2', aiProvider: 'gemini' },
        message: 'Explain quantum computing',
        _deps: {
          generateAiReply: mockGemini,
          generateOllamaReply: mockOllama,
        },
      });

      assert.equal(calledGemini, true);
      assert.equal(calledOllama, false);
      assert.equal(result.reply, 'Hello from Google Gemini Cloud!');
      assert.equal(result.provider, 'gemini');
      assert.equal(result.model, 'gemini-2.5-flash');
      assert.equal(result.fallbackUsed, false);
    });

    it('should NEVER silently switch from Gemini to Ollama if Gemini fails', async () => {
      let calledOllama = false;

      const mockGemini = async () => {
        const err = new Error('Gemini API rate limit exceeded.');
        err.statusCode = 429;
        throw err;
      };

      const mockOllama = async () => {
        calledOllama = true;
        return { reply: 'Silently switched', model: 'llama3.2' };
      };

      await assert.rejects(
        () =>
          routeChatRequest({
            user: { id: 'u2', aiProvider: 'gemini' },
            message: 'Hello',
            _deps: {
              generateAiReply: mockGemini,
              generateOllamaReply: mockOllama,
            },
          }),
        (err) => {
          assert.equal(err.statusCode, 429);
          assert.ok(err.message.includes('rate limit'));
          return true;
        }
      );

      assert.equal(calledOllama, false);
    });
  });

  // =========================================================================
  // 4. Ollama Failure Without Fallback
  // =========================================================================
  describe('4. Ollama Failure Without Fallback', () => {
    it('should throw clear Ollama 503 error when Ollama is unavailable and geminiFallback is false', async () => {
      let calledGemini = false;

      const mockOllama = async () => {
        const err = new Error('Unable to connect to Ollama service at http://127.0.0.1:11434.');
        err.statusCode = 503;
        err.code = 'OLLAMA_UNAVAILABLE';
        throw err;
      };

      const mockGemini = async () => {
        calledGemini = true;
        return { reply: 'Gemini reply', model: 'gemini-2.5-flash' };
      };

      await assert.rejects(
        () =>
          routeChatRequest({
            user: { id: 'u1', aiProvider: 'ollama', geminiFallback: false },
            message: 'Hello',
            _deps: {
              generateOllamaReply: mockOllama,
              generateAiReply: mockGemini,
              isGeminiConfigured: () => true, // Gemini is configured, but must NOT be touched
            },
          }),
        (err) => {
          assert.equal(err.statusCode, 503);
          assert.equal(err.code, 'OLLAMA_UNAVAILABLE');
          assert.ok(err.message.includes('connect to Ollama'));
          return true;
        }
      );

      assert.equal(calledGemini, false, 'Gemini must NEVER be called when geminiFallback is false');
    });

    it('should throw clear Ollama 404 error when requested model is missing', async () => {
      let calledGemini = false;

      const mockOllama = async () => {
        const err = new Error('Ollama model "llama3.2" is not installed or not found.');
        err.statusCode = 404;
        err.code = 'OLLAMA_MODEL_NOT_FOUND';
        throw err;
      };

      await assert.rejects(
        () =>
          routeChatRequest({
            user: { id: 'u1', aiProvider: 'ollama', geminiFallback: false },
            message: 'Hello',
            _deps: {
              generateOllamaReply: mockOllama,
              generateAiReply: async () => {
                calledGemini = true;
              },
              isGeminiConfigured: () => true,
            },
          }),
        (err) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, 'OLLAMA_MODEL_NOT_FOUND');
          return true;
        }
      );

      assert.equal(calledGemini, false);
    });

    it('should throw clear Ollama 504 error on inference timeout when fallback is disabled', async () => {
      const mockOllama = async () => {
        const err = new Error('Ollama request timed out after 60 seconds.');
        err.statusCode = 504;
        err.code = 'OLLAMA_TIMEOUT';
        throw err;
      };

      await assert.rejects(
        () =>
          routeChatRequest({
            user: { id: 'u1', aiProvider: 'ollama', geminiFallback: false },
            message: 'Complex query',
            _deps: { generateOllamaReply: mockOllama },
          }),
        (err) => {
          assert.equal(err.statusCode, 504);
          assert.equal(err.code, 'OLLAMA_TIMEOUT');
          return true;
        }
      );
    });
  });

  // =========================================================================
  // 5. Explicit Gemini Fallback
  // =========================================================================
  describe('5. Explicit Gemini Fallback', () => {
    it('should fall back to Gemini when Ollama fails and geminiFallback is true and Gemini is configured', async () => {
      let calledGemini = false;
      let passedGeminiParams = null;

      const mockOllama = async () => {
        const err = new Error('Unable to connect to Ollama service (ECONNREFUSED).');
        err.statusCode = 503;
        err.code = 'OLLAMA_UNAVAILABLE';
        throw err;
      };

      const mockGemini = async (params) => {
        calledGemini = true;
        passedGeminiParams = params;
        return {
          reply: 'Fallback response from Gemini Brain',
          model: 'gemini-2.5-flash',
        };
      };

      const result = await routeChatRequest({
        user: { id: 'u1', aiProvider: 'ollama', geminiFallback: true },
        message: 'Help with my project',
        conversationHistory: [{ role: 'user', content: 'Turn 1' }],
        userContext: { userName: 'Shivam' },
        sessionId: 'session_fb',
        memories: [{ category: 'fact', value: 'Project is NEXA 2.0' }],
        _deps: {
          generateOllamaReply: mockOllama,
          generateAiReply: mockGemini,
          isGeminiConfigured: () => true,
        },
      });

      assert.equal(calledGemini, true);
      assert.equal(result.reply, 'Fallback response from Gemini Brain');
      assert.equal(result.provider, 'gemini');
      assert.equal(result.model, 'gemini-2.5-flash');
      assert.equal(result.fallbackUsed, true);

      // Verify conversation context was passed to fallback provider
      assert.equal(passedGeminiParams.message, 'Help with my project');
      assert.equal(passedGeminiParams.conversationHistory.length, 1);
      assert.equal(passedGeminiParams.sessionId, 'session_fb');
      assert.equal(passedGeminiParams.memories.length, 1);
    });

    it('should NOT fall back to Gemini if Gemini is not configured, returning clear Ollama error', async () => {
      let calledGemini = false;

      const mockOllama = async () => {
        const err = new Error('Unable to connect to Ollama service.');
        err.statusCode = 503;
        err.code = 'OLLAMA_UNAVAILABLE';
        throw err;
      };

      const mockGemini = async () => {
        calledGemini = true;
        return { reply: 'Should not run' };
      };

      await assert.rejects(
        () =>
          routeChatRequest({
            user: { id: 'u1', aiProvider: 'ollama', geminiFallback: true }, // fallback enabled, but key missing!
            message: 'Hello',
            _deps: {
              generateOllamaReply: mockOllama,
              generateAiReply: mockGemini,
              isGeminiConfigured: () => false, // unconfigured
            },
          }),
        (err) => {
          assert.equal(err.statusCode, 503);
          assert.equal(err.code, 'OLLAMA_UNAVAILABLE');
          return true;
        }
      );

      assert.equal(calledGemini, false);
    });

    it('should NEVER fall back to Gemini on security violations (SSRF / Unsafe redirects)', async () => {
      let calledGemini = false;

      const mockOllama = async () => {
        const err = new Error('Unsafe redirect blocked: non-loopback destination.');
        err.statusCode = 400;
        err.code = 'OLLAMA_UNSAFE_REDIRECT';
        throw err;
      };

      await assert.rejects(
        () =>
          routeChatRequest({
            user: { id: 'u1', aiProvider: 'ollama', geminiFallback: true },
            message: 'Malicious redirect prompt',
            _deps: {
              generateOllamaReply: mockOllama,
              generateAiReply: async () => {
                calledGemini = true;
              },
              isGeminiConfigured: () => true,
            },
          }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'OLLAMA_UNSAFE_REDIRECT');
          return true;
        }
      );

      assert.equal(calledGemini, false, 'Security violation must never trigger fallback');
    });
  });

  // =========================================================================
  // 6. Response Metadata Conformance
  // =========================================================================
  describe('6. Response Metadata Conformance', () => {
    it('Ollama direct response must return exact metadata structure', async () => {
      const mockOllama = async () => ({
        reply: 'Direct reply',
        model: 'llama3.2',
      });

      const res = await routeChatRequest({
        user: { aiProvider: 'ollama', ollamaModel: 'llama3.2' },
        message: 'Test',
        _deps: { generateOllamaReply: mockOllama },
      });

      assert.deepEqual(
        {
          provider: res.provider,
          model: res.model,
          fallbackUsed: res.fallbackUsed,
        },
        {
          provider: 'ollama',
          model: 'llama3.2',
          fallbackUsed: false,
        }
      );
    });

    it('Gemini direct response must return exact metadata structure', async () => {
      const mockGemini = async () => ({
        reply: 'Cloud reply',
        model: 'gemini-2.5-flash',
      });

      const res = await routeChatRequest({
        user: { aiProvider: 'gemini' },
        message: 'Test',
        _deps: { generateAiReply: mockGemini },
      });

      assert.deepEqual(
        {
          provider: res.provider,
          model: res.model,
          fallbackUsed: res.fallbackUsed,
        },
        {
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          fallbackUsed: false,
        }
      );
    });

    it('Gemini fallback response must return exact fallbackUsed: true metadata', async () => {
      const mockOllama = async () => {
        const err = new Error('Ollama offline');
        err.statusCode = 503;
        throw err;
      };

      const mockGemini = async () => ({
        reply: 'Fallback reply',
        model: 'gemini-2.5-flash',
      });

      const res = await routeChatRequest({
        user: { aiProvider: 'ollama', geminiFallback: true },
        message: 'Test',
        _deps: {
          generateOllamaReply: mockOllama,
          generateAiReply: mockGemini,
          isGeminiConfigured: () => true,
        },
      });

      assert.deepEqual(
        {
          provider: res.provider,
          model: res.model,
          fallbackUsed: res.fallbackUsed,
        },
        {
          provider: 'gemini',
          model: 'gemini-2.5-flash',
          fallbackUsed: true,
        }
      );
    });
  });

  // =========================================================================
  // 7. Multi-User Isolation & Provider Preference Security
  // =========================================================================
  describe('7. Multi-User Isolation & Provider Preference Security', () => {
    it('should cleanly isolate preferences and routing between concurrent users', async () => {
      const userA = {
        id: 'user_alpha',
        email: 'alpha@nexa.ai',
        aiProvider: 'ollama',
        ollamaModel: 'llama3.2',
        geminiFallback: false,
      };

      const userB = {
        id: 'user_beta',
        email: 'beta@nexa.ai',
        aiProvider: 'gemini',
      };

      const userC = {
        id: 'user_gamma',
        email: 'gamma@nexa.ai',
        aiProvider: 'ollama',
        ollamaModel: 'mistral:latest',
        geminiFallback: true,
      };

      let ollamaCalls = 0;
      let geminiCalls = 0;

      const mockOllama = async (params) => {
        ollamaCalls++;
        if (params.model === 'mistral:latest') {
          // User C's Ollama model fails
          const err = new Error('Mistral timed out');
          err.statusCode = 504;
          throw err;
        }
        return { reply: `Ollama reply for ${params.model}`, model: params.model };
      };

      const mockGemini = async () => {
        geminiCalls++;
        return { reply: 'Gemini reply', model: 'gemini-2.5-flash' };
      };

      const deps = {
        generateOllamaReply: mockOllama,
        generateAiReply: mockGemini,
        isGeminiConfigured: () => true,
      };

      // 1. User A (Ollama)
      const resA = await routeChatRequest({
        user: userA,
        message: 'Hello A',
        _deps: deps,
      });
      assert.equal(resA.provider, 'ollama');
      assert.equal(resA.model, 'llama3.2');
      assert.equal(resA.fallbackUsed, false);

      // 2. User B (Gemini)
      const resB = await routeChatRequest({
        user: userB,
        message: 'Hello B',
        _deps: deps,
      });
      assert.equal(resB.provider, 'gemini');
      assert.equal(resB.model, 'gemini-2.5-flash');
      assert.equal(resB.fallbackUsed, false);

      // 3. User C (Ollama fails -> Fallback Gemini)
      const resC = await routeChatRequest({
        user: userC,
        message: 'Hello C',
        _deps: deps,
      });
      assert.equal(resC.provider, 'gemini');
      assert.equal(resC.model, 'gemini-2.5-flash');
      assert.equal(resC.fallbackUsed, true);

      // Verify total calls
      assert.equal(ollamaCalls, 2); // User A and User C
      assert.equal(geminiCalls, 2); // User B and User C (fallback)
    });

    it('should NEVER trust provider or userId supplied in request body', async () => {
      // Attacker sends { provider: "gemini", aiProvider: "gemini", userId: "victim" } in body
      // but authenticated req.user has { id: "real_user", aiProvider: "ollama" }
      const req = {
        user: {
          id: 'real_user',
          email: 'real@nexa.ai',
          displayName: 'Real User',
          aiProvider: 'ollama',
          ollamaModel: 'llama3.2',
          geminiFallback: false,
        },
        body: {
          message: 'Can I force Gemini?',
          userId: 'victim_user',
          provider: 'gemini',
          aiProvider: 'gemini',
          geminiFallback: true,
        },
      };
      const res = createMockRes();

      // Mock fetch so Ollama succeeds
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            message: { role: 'assistant', content: 'Local Ollama execution.' },
            model: 'llama3.2',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      try {
        await handleChatMessage(req, res, () => {});

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        // The provider MUST be ollama as dictated by req.user, NOT gemini as attempted in body!
        assert.equal(res.body.provider, 'ollama');
        assert.equal(res.body.fallbackUsed, false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // =========================================================================
  // 8. Integration with Chat Controller & Status Endpoint
  // =========================================================================
  describe('8. Integration with Chat Controller & Status Endpoint', () => {
    it('handleChatMessage should return compatible 200 payload with provider and fallback metadata', async () => {
      const req = {
        user: {
          id: 'test_user_1',
          email: 'user1@nexa.ai',
          aiProvider: 'ollama',
          ollamaModel: 'llama3.2',
          geminiFallback: false,
        },
        body: {
          message: 'What is your name?',
        },
      };
      const res = createMockRes();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            message: { role: 'assistant', content: 'My name is NEXA.' },
            model: 'llama3.2',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      try {
        await handleChatMessage(req, res, () => {});

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.reply, 'My name is NEXA.');
        assert.equal(res.body.provider, 'ollama');
        assert.equal(res.body.model, 'llama3.2');
        assert.equal(res.body.fallbackUsed, false);
        assert.ok(typeof res.body.conversationId === 'string');
        assert.ok(typeof res.body.timestamp === 'string');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('handleChatMessage should safely reject invalid provider via error middleware with HTTP 400', async () => {
      const req = {
        user: {
          id: 'test_user_2',
          email: 'user2@nexa.ai',
          aiProvider: 'unsupported_model_provider',
        },
        body: {
          message: 'Hello',
        },
      };
      const res = createMockRes();
      let caughtError = null;

      await handleChatMessage(req, res, (err) => {
        caughtError = err;
      });

      assert.ok(caughtError !== null);
      assert.equal(caughtError.statusCode, 400);
      assert.equal(caughtError.code, 'INVALID_AI_PROVIDER');

      // Test that errorHandler correctly renders this
      errorHandler(caughtError, req, res, () => {});
      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
      assert.ok(res.body.error.includes('unsupported_model_provider'));
    });

    it('handleChatMessage should continue to execute remember/forget intents deterministically', async () => {
      const intent = detectMemoryIntent('Remember that I prefer dark theme.');
      assert.equal(intent.isIntent, true);
      assert.equal(intent.type, 'remember');
      assert.ok(intent.target.includes('dark theme'));

      const req = {
        user: {
          id: 'test_user_memory',
          email: 'mem@nexa.ai',
          aiProvider: 'ollama',
          ollamaModel: 'llama3.2',
        },
        body: {
          message: 'Remember that I prefer dark theme.',
        },
      };
      const res = createMockRes();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            message: { role: 'assistant', content: 'Noted.' },
            model: 'llama3.2',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      try {
        await handleChatMessage(req, res, () => {});

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        if (mongoose.connection.readyState === 1) {
          assert.equal(res.body.memoryAction, 'remembered');
          assert.equal(res.body.model, 'NEXA Memory Engine');
        } else {
          assert.ok(res.body.reply !== undefined);
        }
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('getChatStatus should return 200 with default provider info and model info', () => {
      const req = {};
      const res = createMockRes();

      getChatStatus(req, res);

      assert.equal(res.statusCode, 200);
      assert.ok('status' in res.body);
      assert.ok('model' in res.body);
      assert.ok('geminiConfigured' in res.body);
      assert.equal(res.body.defaultProvider, 'ollama');
    });

    it('getOllamaConnectionStatus should return 200 with isConnected true and models when online', async () => {
      const req = { user: { ollamaBaseUrl: 'http://127.0.0.1:11434' }, query: {} };
      const res = createMockRes();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        return new Response(
          JSON.stringify({
            models: [
              { name: 'llama3.2:latest', size: 2000000 },
              { name: 'mistral:latest', size: 4000000 },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      };

      try {
        await getOllamaConnectionStatus(req, res, () => {});

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.isConnected, true);
        assert.equal(res.body.status, 'connected');
        assert.ok(Array.isArray(res.body.models));
        assert.ok(res.body.models.includes('llama3.2:latest'));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('getOllamaConnectionStatus should safely return 200 with isConnected false when offline', async () => {
      const req = { user: {}, query: {} };
      const res = createMockRes();

      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:11434');
        err.code = 'ECONNREFUSED';
        throw err;
      };

      try {
        await getOllamaConnectionStatus(req, res, () => {});

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.isConnected, false);
        assert.equal(res.body.status, 'disconnected');
        assert.ok(res.body.error);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('getOllamaConnectionStatus should reject non-loopback baseUrl with HTTP 400', async () => {
      const req = { query: { baseUrl: 'http://external-malicious-site.com' }, user: {} };
      const res = createMockRes();

      await getOllamaConnectionStatus(req, res, () => {});

      assert.equal(res.statusCode, 400);
      assert.equal(res.body.success, false);
      assert.equal(res.body.isConnected, false);
      assert.ok(res.body.error);
    });
  });
});
