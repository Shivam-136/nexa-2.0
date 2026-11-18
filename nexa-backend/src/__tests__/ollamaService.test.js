import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_TIMEOUT_MS,
  DEFAULT_OLLAMA_MODEL,
  isLocalEndpoint,
  validateOllamaBaseUrl,
  getOllamaBaseUrl,
  getOllamaTimeoutMs,
  getOllamaModel,
} from '../config/ollama.js';
import {
  generateOllamaReply,
  checkOllamaStatus,
  fetchAvailableModels,
  normalizeOllamaError,
  formatOllamaMessages,
} from '../services/ollama.service.js';

describe('NEXA 2.0 Ollama Backend Service & Configuration Suite (Milestone 2.1)', () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = { ...process.env };

  afterEach(() => {
    globalThis.fetch = originalFetch;
    process.env = { ...originalEnv };
  });

  // Helper to mock globalThis.fetch responses
  function mockFetchJson(responseBody, init = {}) {
    const status = init.status ?? 200;
    const statusText = init.statusText ?? (status === 200 ? 'OK' : 'Error');
    const headers = new Headers(init.headers || { 'content-type': 'application/json' });

    globalThis.fetch = async (url, options) => {
      if (init.onRequest) {
        init.onRequest(url, options);
      }
      return new Response(
        typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody),
        { status, statusText, headers }
      );
    };
  }

  describe('1. Ollama Configuration & Local Endpoint Security', () => {
    it('should have standard default constants', () => {
      assert.equal(DEFAULT_OLLAMA_BASE_URL, 'http://127.0.0.1:11434');
      assert.equal(DEFAULT_OLLAMA_TIMEOUT_MS, 60000);
      assert.equal(DEFAULT_OLLAMA_MODEL, 'llama3.2');
    });

    it('should strictly allow ONLY actual local loopback endpoints', () => {
      // Valid loopback destinations
      assert.equal(isLocalEndpoint('localhost'), true);
      assert.equal(isLocalEndpoint('localhost.'), true);
      assert.equal(isLocalEndpoint('127.0.0.1'), true);
      assert.equal(isLocalEndpoint('127.0.1.1'), true);
      assert.equal(isLocalEndpoint('127.255.255.255'), true);
      assert.equal(isLocalEndpoint('::1'), true);
      assert.equal(isLocalEndpoint('[::1]'), true);
      assert.equal(isLocalEndpoint('0000:0000:0000:0000:0000:0000:0000:0001'), true);

      // 0.0.0.0 and meta-addresses MUST be rejected
      assert.equal(isLocalEndpoint('0.0.0.0'), false);
      assert.equal(isLocalEndpoint('0'), false);
      assert.equal(isLocalEndpoint('::'), false);
      assert.equal(isLocalEndpoint('[::]'), false);

      // Private RFC1918 networks, public IPs, and remote hostnames MUST be rejected
      assert.equal(isLocalEndpoint('192.168.1.1'), false);
      assert.equal(isLocalEndpoint('10.0.0.1'), false);
      assert.equal(isLocalEndpoint('172.16.0.1'), false);
      assert.equal(isLocalEndpoint('169.254.169.254'), false);
      assert.equal(isLocalEndpoint('8.8.8.8'), false);
      assert.equal(isLocalEndpoint('example.com'), false);
      assert.equal(isLocalEndpoint('localhost.attacker.com'), false);
      assert.equal(isLocalEndpoint('ollama.ai'), false);
      assert.equal(isLocalEndpoint(''), false);
      assert.equal(isLocalEndpoint(null), false);
    });

    it('should normalize valid local base URLs and strip trailing slashes', () => {
      assert.equal(validateOllamaBaseUrl('http://127.0.0.1:11434/'), 'http://127.0.0.1:11434');
      assert.equal(validateOllamaBaseUrl('http://127.0.0.1:11434'), 'http://127.0.0.1:11434');
      assert.equal(validateOllamaBaseUrl('http://localhost:11434/'), 'http://localhost:11434');
      assert.equal(validateOllamaBaseUrl('http://[::1]:11434/'), 'http://[::1]:11434');
    });

    it('should strictly reject 0.0.0.0 destination URLs', () => {
      assert.throws(
        () => validateOllamaBaseUrl('http://0.0.0.0:11434'),
        /Unsafe Ollama base URL/
      );
      assert.throws(
        () => validateOllamaBaseUrl('http://0:11434'),
        /Unsafe Ollama base URL/
      );
    });

    it('should reject URLs containing embedded credentials', () => {
      assert.throws(
        () => validateOllamaBaseUrl('http://admin:secret@127.0.0.1:11434'),
        /must not contain authentication credentials/
      );
      assert.throws(
        () => validateOllamaBaseUrl('http://localhost@attacker.com:11434'),
        /must not contain authentication credentials/
      );
    });

    it('should reject URLs containing query parameters or fragments', () => {
      assert.throws(
        () => validateOllamaBaseUrl('http://127.0.0.1:11434?probe=true'),
        /must not contain query parameters or fragments/
      );
      assert.throws(
        () => validateOllamaBaseUrl('http://127.0.0.1:11434#section'),
        /must not contain query parameters or fragments/
      );
    });

    it('should reject invalid port numbers', () => {
      assert.throws(
        () => validateOllamaBaseUrl('http://127.0.0.1:70000'),
        /Invalid Ollama base URL format|Port must be between 1 and 65535/
      );
      assert.throws(
        () => validateOllamaBaseUrl('http://127.0.0.1:0'),
        /Invalid Ollama port|Port must be between 1 and 65535/
      );
    });

    it('should reject non-HTTP(S) protocols', () => {
      assert.throws(
        () => validateOllamaBaseUrl('ftp://127.0.0.1:11434'),
        /Invalid Ollama protocol/
      );
      assert.throws(
        () => validateOllamaBaseUrl('file:///etc/passwd'),
        /Invalid Ollama protocol/
      );
      assert.throws(
        () => validateOllamaBaseUrl('ws://127.0.0.1:11434'),
        /Invalid Ollama protocol/
      );
    });

    it('should strictly reject unsafe remote or public endpoints', () => {
      assert.throws(
        () => validateOllamaBaseUrl('http://api.ollama.com:11434'),
        /Unsafe Ollama base URL/
      );
      assert.throws(
        () => validateOllamaBaseUrl('http://8.8.8.8:11434'),
        /Unsafe Ollama base URL/
      );
      assert.throws(
        () => validateOllamaBaseUrl('https://evil-server.org/ollama'),
        /Unsafe Ollama base URL/
      );
      assert.throws(
        () => validateOllamaBaseUrl('http://169.254.169.254:11434'),
        /Unsafe Ollama base URL/
      );
    });

    it('should support configurable environment overrides', () => {
      process.env.OLLAMA_BASE_URL = 'http://localhost:11435';
      assert.equal(getOllamaBaseUrl(), 'http://localhost:11435');

      process.env.OLLAMA_REQUEST_TIMEOUT_MS = '45000';
      assert.equal(getOllamaTimeoutMs(), 45000);

      process.env.OLLAMA_MODEL = 'qwen2.5:7b';
      assert.equal(getOllamaModel(), 'qwen2.5:7b');
    });

    it('should fall back to defaults when environment variables are unset or invalid', () => {
      delete process.env.OLLAMA_BASE_URL;
      delete process.env.OLLAMA_REQUEST_TIMEOUT_MS;
      delete process.env.OLLAMA_MODEL;

      assert.equal(getOllamaBaseUrl(), DEFAULT_OLLAMA_BASE_URL);
      assert.equal(getOllamaTimeoutMs(), DEFAULT_OLLAMA_TIMEOUT_MS);
      assert.equal(getOllamaModel(), DEFAULT_OLLAMA_MODEL);

      process.env.OLLAMA_REQUEST_TIMEOUT_MS = 'not-a-number';
      assert.equal(getOllamaTimeoutMs(), DEFAULT_OLLAMA_TIMEOUT_MS);
    });
  });

  describe('2. Message Formatting for Native Ollama /api/chat', () => {
    it('should format a standalone user message', () => {
      const messages = formatOllamaMessages({ message: 'Hello NEXA' });
      assert.deepEqual(messages, [{ role: 'user', content: 'Hello NEXA' }]);
    });

    it('should include system instruction at the beginning if provided', () => {
      const messages = formatOllamaMessages({
        message: 'Hello',
        systemInstruction: 'You are NEXA.',
      });
      assert.deepEqual(messages, [
        { role: 'system', content: 'You are NEXA.' },
        { role: 'user', content: 'Hello' },
      ]);
    });

    it('should map conversation history roles accurately (model -> assistant)', () => {
      const history = [
        { role: 'user', content: 'Hi' },
        { role: 'model', content: 'Hello there' },
        { role: 'assistant', content: 'How can I assist you?' },
      ];
      const messages = formatOllamaMessages({
        message: 'Tell me a joke',
        conversationHistory: history,
      });

      assert.equal(messages[0].role, 'user');
      assert.equal(messages[0].content, 'Hi');
      assert.equal(messages[1].role, 'assistant');
      assert.ok(messages[1].content.includes('Hello there'));
      assert.ok(messages[1].content.includes('How can I assist you?'));
      assert.equal(messages[2].role, 'user');
      assert.equal(messages[2].content, 'Tell me a joke');
    });

    it('should handle alternative property names like text and sender', () => {
      const history = [
        { sender: 'user', text: 'Turn 1' },
        { sender: 'assistant', text: 'Turn 2' },
      ];
      const messages = formatOllamaMessages({
        message: 'Turn 3',
        conversationHistory: history,
      });

      assert.equal(messages[0].role, 'user');
      assert.equal(messages[0].content, 'Turn 1');
      assert.equal(messages[1].role, 'assistant');
      assert.equal(messages[1].content, 'Turn 2');
      assert.equal(messages[2].role, 'user');
      assert.equal(messages[2].content, 'Turn 3');
    });

    it('should limit historical turns to maxTurns', () => {
      const history = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Turn ${i}`,
      }));

      const messages = formatOllamaMessages({
        message: 'Latest',
        conversationHistory: history,
        maxTurns: 4,
      });

      // Should keep at most 4 history turns + latest user message
      assert.ok(messages.length <= 5);
      assert.equal(messages[messages.length - 1].content, 'Latest');
    });
  });

  describe('3. generateOllamaReply() API Operations', () => {
    it('should successfully execute a chat request and return reply and model', async () => {
      let capturedUrl;
      let capturedBody;
      let capturedRedirect;

      mockFetchJson(
        {
          model: 'llama3.2',
          created_at: '2026-11-17T00:00:00Z',
          message: {
            role: 'assistant',
            content: 'Hello! I am NEXA, running locally on Ollama.',
          },
          done: true,
        },
        {
          onRequest: (url, opts) => {
            capturedUrl = url;
            capturedBody = JSON.parse(opts.body);
            capturedRedirect = opts.redirect;
          },
        }
      );

      const result = await generateOllamaReply({
        message: 'Who are you?',
        model: 'llama3.2',
      });

      assert.equal(result.reply, 'Hello! I am NEXA, running locally on Ollama.');
      assert.equal(result.model, 'llama3.2');
      assert.equal(capturedUrl, 'http://127.0.0.1:11434/api/chat');
      assert.equal(capturedBody.model, 'llama3.2');
      assert.equal(capturedBody.stream, false);
      assert.equal(capturedRedirect, 'manual');
      assert.ok(Array.isArray(capturedBody.messages));
      assert.equal(
        capturedBody.messages[capturedBody.messages.length - 1].content,
        'Who are you?'
      );
    });

    it('should support custom systemInstruction in generateOllamaReply', async () => {
      let capturedBody;
      mockFetchJson(
        {
          model: 'llama3.2',
          message: { role: 'assistant', content: 'Roger that.' },
          done: true,
        },
        {
          onRequest: (_, opts) => {
            capturedBody = JSON.parse(opts.body);
          },
        }
      );

      await generateOllamaReply({
        message: 'Status check',
        systemInstruction: 'Strict test mode system instruction',
      });

      assert.equal(capturedBody.messages[0].role, 'system');
      assert.equal(capturedBody.messages[0].content, 'Strict test mode system instruction');
    });

    it('should reject missing or empty messages with HTTP 400', async () => {
      await assert.rejects(
        () => generateOllamaReply({ message: '' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.ok(err.message.includes('Message cannot be empty'));
          return true;
        }
      );

      await assert.rejects(
        () => generateOllamaReply({ message: '   ' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          return true;
        }
      );

      await assert.rejects(
        () => generateOllamaReply({}),
        (err) => {
          assert.equal(err.statusCode, 400);
          return true;
        }
      );
    });

    it('should reject non-array conversationHistory with HTTP 400', async () => {
      await assert.rejects(
        () => generateOllamaReply({ message: 'Hi', conversationHistory: 'invalid' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.ok(err.message.includes('conversationHistory must be an array'));
          return true;
        }
      );
    });
  });

  describe('4. Error Handling & Normalization', () => {
    it('should map connection refused (ECONNREFUSED) to HTTP 503 with actionable guidance', async () => {
      globalThis.fetch = async () => {
        const err = new TypeError('fetch failed');
        err.cause = { code: 'ECONNREFUSED', message: 'connect ECONNREFUSED 127.0.0.1:11434' };
        err.code = 'ECONNREFUSED';
        throw err;
      };

      await assert.rejects(
        () => generateOllamaReply({ message: 'Hello' }),
        (err) => {
          assert.equal(err.statusCode, 503);
          assert.equal(err.code, 'OLLAMA_UNAVAILABLE');
          assert.ok(err.message.includes('Unable to connect to Ollama service'));
          assert.ok(err.message.includes('ollama serve'));
          return true;
        }
      );
    });

    it('should map missing model (404) to HTTP 404 with pull command instructions', async () => {
      mockFetchJson(
        { error: "model 'llama3.2' not found, try pulling it first" },
        { status: 404, statusText: 'Not Found' }
      );

      await assert.rejects(
        () => generateOllamaReply({ message: 'Hello', model: 'llama3.2' }),
        (err) => {
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, 'OLLAMA_MODEL_NOT_FOUND');
          assert.ok(err.message.includes('Ollama model "llama3.2" is not installed'));
          assert.ok(err.message.includes('ollama pull llama3.2'));
          return true;
        }
      );
    });

    it('should map request timeout to HTTP 504 Gateway Timeout', async () => {
      globalThis.fetch = async () => {
        const err = new Error('The operation was aborted due to timeout');
        err.name = 'AbortError';
        throw err;
      };

      await assert.rejects(
        () => generateOllamaReply({ message: 'Complex task', timeoutMs: 5000 }),
        (err) => {
          assert.equal(err.statusCode, 504);
          assert.equal(err.code, 'OLLAMA_TIMEOUT');
          assert.ok(err.message.includes('timed out'));
          assert.ok(err.message.includes('5 seconds'));
          return true;
        }
      );
    });

    it('should map malformed JSON responses to HTTP 502 Bad Gateway', async () => {
      mockFetchJson('not-valid-json-string', {
        headers: { 'content-type': 'text/plain' },
      });

      await assert.rejects(
        () => generateOllamaReply({ message: 'Hello' }),
        (err) => {
          assert.equal(err.statusCode, 502);
          assert.equal(err.code, 'OLLAMA_MALFORMED_RESPONSE');
          assert.ok(err.message.includes('malformed or invalid response'));
          return true;
        }
      );
    });

    it('should map response with missing message.content to HTTP 502 Bad Gateway', async () => {
      mockFetchJson({
        model: 'llama3.2',
        message: { role: 'assistant' }, // missing content
      });

      await assert.rejects(
        () => generateOllamaReply({ message: 'Hello' }),
        (err) => {
          assert.equal(err.statusCode, 502);
          assert.equal(err.code, 'OLLAMA_MALFORMED_RESPONSE');
          return true;
        }
      );
    });

    it('should normalize direct error objects consistently in normalizeOllamaError', () => {
      // 1. Timeout
      const timeoutErr = normalizeOllamaError(new Error('fetch timed out'), { timeoutMs: 30000 });
      assert.equal(timeoutErr.statusCode, 504);
      assert.equal(timeoutErr.code, 'OLLAMA_TIMEOUT');

      // 2. Connection error
      const connErr = normalizeOllamaError(new Error('connect ECONNREFUSED 127.0.0.1:11434'));
      assert.equal(connErr.statusCode, 503);
      assert.equal(connErr.code, 'OLLAMA_UNAVAILABLE');

      // 3. Model not found
      const modelErr = normalizeOllamaError(new Error('model not found, try pulling it'), {
        model: 'mistral',
      });
      assert.equal(modelErr.statusCode, 404);
      assert.equal(modelErr.code, 'OLLAMA_MODEL_NOT_FOUND');
      assert.ok(modelErr.message.includes('ollama pull mistral'));

      // 4. Malformed syntax
      const syntaxErr = normalizeOllamaError(new SyntaxError('Unexpected token in JSON'));
      assert.equal(syntaxErr.statusCode, 502);
      assert.equal(syntaxErr.code, 'OLLAMA_MALFORMED_RESPONSE');

      // 5. Unsafe config
      const configErr = normalizeOllamaError(new Error('Unsafe Ollama base URL "http://evil.com"'));
      assert.equal(configErr.statusCode, 400);
      assert.equal(configErr.code, 'OLLAMA_INVALID_CONFIG');

      // 6. Unsafe redirect
      const redirectErr = normalizeOllamaError(
        new Error('Unsafe redirect blocked: Ollama requests cannot follow redirects to non-loopback destination')
      );
      assert.equal(redirectErr.statusCode, 400);
      assert.equal(redirectErr.code, 'OLLAMA_UNSAFE_REDIRECT');

      // 7. Null error fallback
      const nullErr = normalizeOllamaError(null);
      assert.equal(nullErr.statusCode, 500);
    });
  });

  describe('5. Status Checking & Model Listing APIs', () => {
    it('checkOllamaStatus should return connected when Ollama is running', async () => {
      mockFetchJson({
        models: [
          { name: 'llama3.2:latest' },
          { name: 'qwen2.5:latest' },
        ],
      });

      const status = await checkOllamaStatus();
      assert.equal(status.isConnected, true);
      assert.equal(status.status, 'connected');
      assert.deepEqual(status.models, ['llama3.2:latest', 'qwen2.5:latest']);
      assert.equal(status.baseUrl, 'http://127.0.0.1:11434');
    });

    it('checkOllamaStatus should safely return disconnected without throwing on network failure', async () => {
      globalThis.fetch = async () => {
        const err = new TypeError('fetch failed');
        err.cause = { code: 'ECONNREFUSED' };
        throw err;
      };

      const status = await checkOllamaStatus();
      assert.equal(status.isConnected, false);
      assert.equal(status.status, 'disconnected');
      assert.ok(status.error.includes('Unable to connect to Ollama service'));
    });

    it('fetchAvailableModels should list available model descriptors from GET /api/tags', async () => {
      let capturedUrl;
      const fakeModels = [
        {
          name: 'llama3.2:latest',
          size: 2019393189,
          details: { family: 'llama', parameter_size: '3B' },
        },
        {
          name: 'mistral:latest',
          size: 4109852672,
          details: { family: 'llama', parameter_size: '7B' },
        },
      ];

      mockFetchJson(
        { models: fakeModels },
        {
          onRequest: (url) => {
            capturedUrl = url;
          },
        }
      );

      const models = await fetchAvailableModels();
      assert.equal(capturedUrl, 'http://127.0.0.1:11434/api/tags');
      assert.equal(models.length, 2);
      assert.equal(models[0].name, 'llama3.2:latest');
      assert.equal(models[1].name, 'mistral:latest');
    });

    it('fetchAvailableModels should reject with HTTP 502 if models array is missing', async () => {
      mockFetchJson({ unexpected: 'payload' });

      await assert.rejects(
        () => fetchAvailableModels(),
        (err) => {
          assert.equal(err.statusCode, 502);
          assert.equal(err.code, 'OLLAMA_MALFORMED_RESPONSE');
          return true;
        }
      );
    });
  });

  describe('6. Security, SSRF & Redirects Guardrails Verification', () => {
    it('should NEVER silently fall back to Gemini on Ollama failure', async () => {
      globalThis.fetch = async () => {
        const err = new TypeError('fetch failed');
        err.cause = { code: 'ECONNREFUSED' };
        throw err;
      };

      // Even if GEMINI_API_KEY is configured, it must throw normalized Ollama error
      process.env.GEMINI_API_KEY = 'test-gemini-key';

      await assert.rejects(
        () => generateOllamaReply({ message: 'Private local data' }),
        (err) => {
          assert.equal(err.statusCode, 503);
          assert.equal(err.code, 'OLLAMA_UNAVAILABLE');
          assert.ok(err.message.includes('ollama serve'));
          return true;
        }
      );
    });

    it('should reject 0.0.0.0 when set in process.env.OLLAMA_BASE_URL', async () => {
      process.env.OLLAMA_BASE_URL = 'http://0.0.0.0:11434';

      await assert.rejects(
        () => generateOllamaReply({ message: 'Hello' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'OLLAMA_INVALID_CONFIG');
          assert.ok(err.message.includes('Unsafe Ollama base URL'));
          return true;
        }
      );

      const status = await checkOllamaStatus();
      assert.equal(status.isConnected, false);
      assert.equal(status.status, 'error');
      assert.ok(status.error.includes('Unsafe Ollama base URL'));
    });

    it('should reject unsafe public endpoints when set in process.env.OLLAMA_BASE_URL', async () => {
      process.env.OLLAMA_BASE_URL = 'http://169.254.169.254/latest/meta-data'; // AWS metadata SSRF target

      await assert.rejects(
        () => generateOllamaReply({ message: 'Hello' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'OLLAMA_INVALID_CONFIG');
          assert.ok(err.message.includes('Unsafe Ollama base URL'));
          return true;
        }
      );
    });

    it('should block redirect attempts to non-loopback destinations in generateOllamaReply', async () => {
      // Mock server attempting to redirect client to AWS metadata service
      globalThis.fetch = async () => {
        return new Response(null, {
          status: 302,
          headers: {
            location: 'http://169.254.169.254/latest/meta-data',
          },
        });
      };

      await assert.rejects(
        () => generateOllamaReply({ message: 'Hello' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'OLLAMA_UNSAFE_REDIRECT');
          assert.ok(err.message.includes('Unsafe redirect blocked'));
          assert.ok(err.message.includes('non-loopback destination'));
          return true;
        }
      );
    });

    it('should block redirect attempts to external domains in generateOllamaReply', async () => {
      // Mock server attempting to redirect client to external domain
      globalThis.fetch = async () => {
        return new Response(null, {
          status: 301,
          headers: {
            location: 'https://attacker.com/data-exfiltration',
          },
        });
      };

      await assert.rejects(
        () => generateOllamaReply({ message: 'Hello' }),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'OLLAMA_UNSAFE_REDIRECT');
          assert.ok(err.message.includes('Unsafe redirect blocked'));
          return true;
        }
      );
    });

    it('should block redirect attempts in fetchAvailableModels', async () => {
      globalThis.fetch = async () => {
        return new Response(null, {
          status: 307,
          headers: {
            location: 'http://192.168.1.1/admin',
          },
        });
      };

      await assert.rejects(
        () => fetchAvailableModels(),
        (err) => {
          assert.equal(err.statusCode, 400);
          assert.equal(err.code, 'OLLAMA_UNSAFE_REDIRECT');
          assert.ok(err.message.includes('Unsafe redirect blocked'));
          return true;
        }
      );
    });

    it('should block redirect attempts safely in checkOllamaStatus without crashing', async () => {
      globalThis.fetch = async () => {
        return new Response(null, {
          status: 302,
          headers: {
            location: 'http://evil.com',
          },
        });
      };

      const status = await checkOllamaStatus();
      assert.equal(status.isConnected, false);
      assert.equal(status.status, 'disconnected');
      assert.ok(status.error.includes('Unsafe redirect blocked'));
    });
  });
});
