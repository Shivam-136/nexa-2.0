import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AI_PROVIDER,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_GEMINI_FALLBACK,
  SUPPORTED_AI_PROVIDERS,
} from '../utils/constants.js';
import { updatePreferences, getMe } from '../services/auth.service.js';

/**
 * Loopback URL validator matching SettingsPage.jsx logic
 */
function validateLoopbackUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string' || !urlStr.trim()) {
    return 'Ollama Base URL cannot be empty.';
  }
  let parsed;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    return 'Invalid URL format. Expected e.g. http://127.0.0.1:11434';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only HTTP and HTTPS protocols are supported.';
  }
  if (parsed.username || parsed.password) {
    return 'Base URL must not contain embedded credentials.';
  }
  if (parsed.search || parsed.hash) {
    return 'Base URL must not contain query parameters or fragments.';
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/.test(host);
  if (!isLoopback) {
    return 'Security restriction: Only local loopback endpoints (127.0.0.1, localhost, ::1) are permitted.';
  }
  return '';
}

describe('NEXA 2.0 Frontend Provider Settings & Preferences Suite', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('1. Ollama-First System Defaults', () => {
    it('should have standard Ollama-first default constants', () => {
      assert.equal(DEFAULT_AI_PROVIDER, 'ollama');
      assert.equal(DEFAULT_OLLAMA_MODEL, 'llama3.2');
      assert.equal(DEFAULT_OLLAMA_BASE_URL, 'http://127.0.0.1:11434');
      assert.equal(DEFAULT_GEMINI_FALLBACK, false);
    });

    it('should include supported providers with Ollama as recommended', () => {
      assert.ok(Array.isArray(SUPPORTED_AI_PROVIDERS));
      const ollama = SUPPORTED_AI_PROVIDERS.find((p) => p.id === 'ollama');
      const gemini = SUPPORTED_AI_PROVIDERS.find((p) => p.id === 'gemini');

      assert.ok(ollama);
      assert.ok(gemini);
      assert.equal(ollama.recommended, true);
      assert.equal(gemini.recommended, false);
    });
  });

  describe('2. Loopback Endpoint URL Validation', () => {
    it('should approve valid local IPv4, IPv6, and localhost loopback URLs', () => {
      assert.equal(validateLoopbackUrl('http://127.0.0.1:11434'), '');
      assert.equal(validateLoopbackUrl('http://localhost:11434'), '');
      assert.equal(validateLoopbackUrl('http://[::1]:11434'), '');
      assert.equal(validateLoopbackUrl('http://127.0.0.2:8000'), '');
      assert.equal(validateLoopbackUrl('https://localhost:11434'), '');
    });

    it('should reject non-loopback IPs and public domains', () => {
      assert.ok(validateLoopbackUrl('http://example.com:11434').includes('Only local loopback endpoints'));
      assert.ok(validateLoopbackUrl('http://192.168.1.100:11434').includes('Only local loopback endpoints'));
      assert.ok(validateLoopbackUrl('http://10.0.0.1:11434').includes('Only local loopback endpoints'));
      assert.ok(validateLoopbackUrl('http://0.0.0.0:11434').includes('Only local loopback endpoints'));
    });

    it('should reject URLs with embedded credentials or query parameters', () => {
      assert.ok(validateLoopbackUrl('http://admin:pass@127.0.0.1:11434').includes('embedded credentials'));
      assert.ok(validateLoopbackUrl('http://127.0.0.1:11434?param=1').includes('query parameters'));
      assert.ok(validateLoopbackUrl('http://127.0.0.1:11434#hash').includes('query parameters'));
    });

    it('should reject non-HTTP protocols', () => {
      assert.ok(validateLoopbackUrl('ftp://127.0.0.1:11434').includes('Only HTTP and HTTPS'));
      assert.ok(validateLoopbackUrl('ws://127.0.0.1:11434').includes('Only HTTP and HTTPS'));
    });

    it('should reject empty or malformed inputs', () => {
      assert.ok(validateLoopbackUrl('').includes('cannot be empty'));
      assert.ok(validateLoopbackUrl('not-a-valid-url').includes('Invalid URL format'));
    });
  });

  describe('3. Preference Loading & Updating', () => {
    it('should send PATCH request with updated AI provider preferences', async () => {
      let capturedMethod = null;
      let capturedPayload = null;

      globalThis.fetch = async (url, options) => {
        capturedMethod = options.method;
        capturedPayload = JSON.parse(options.body);

        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            user: {
              id: 'user-123',
              email: 'operator@nexa.ai',
              displayName: 'Lead Operator',
              aiProvider: 'ollama',
              ollamaModel: 'llama3.2',
              ollamaBaseUrl: 'http://127.0.0.1:11434',
              geminiFallback: false,
              voiceLanguage: 'en-US',
            },
            message: 'Preferences updated successfully.',
          }),
        };
      };

      const result = await updatePreferences({
        displayName: 'Lead Operator',
        aiProvider: 'ollama',
        ollamaModel: 'llama3.2',
        ollamaBaseUrl: 'http://127.0.0.1:11434',
        geminiFallback: false,
      });

      assert.equal(capturedMethod, 'PATCH');
      assert.equal(capturedPayload.aiProvider, 'ollama');
      assert.equal(capturedPayload.ollamaModel, 'llama3.2');
      assert.equal(capturedPayload.geminiFallback, false);
      assert.equal(result.success, true);
      assert.equal(result.user.aiProvider, 'ollama');
    });

    it('getMe should retrieve safe profile with user AI preferences', async () => {
      globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          user: {
            id: 'user-789',
            email: 'admin@nexa.ai',
            displayName: 'Admin',
            aiProvider: 'ollama',
            ollamaModel: 'mistral:latest',
            ollamaBaseUrl: 'http://127.0.0.1:11434',
            geminiFallback: true,
          },
        }),
      });

      const res = await getMe();
      assert.equal(res.success, true);
      assert.equal(res.user.aiProvider, 'ollama');
      assert.equal(res.user.ollamaModel, 'mistral:latest');
      assert.equal(res.user.geminiFallback, true);
    });
  });
});
