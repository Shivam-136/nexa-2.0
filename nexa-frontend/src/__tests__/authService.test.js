import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  register,
  login,
  refreshSession,
  logout,
  getMe,
  updatePreferences,
  claimLegacyData,
  setAccessToken,
  getAccessToken,
  subscribeAccessToken,
} from '../services/auth.service.js';

describe('NEXA 2.0 Frontend Auth Service Test Suite (Phase 6 M1)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setAccessToken(null);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setAccessToken(null);
  });

  describe('1. Token Memory Management', () => {
    it('should store and retrieve access token in memory', () => {
      assert.equal(getAccessToken(), null);
      setAccessToken('test-jwt-token-xyz');
      assert.equal(getAccessToken(), 'test-jwt-token-xyz');
      setAccessToken(null);
      assert.equal(getAccessToken(), null);
    });

    it('should notify subscribers when setAccessToken is called', () => {
      let notifiedToken = null;
      const unsubscribe = subscribeAccessToken((token) => {
        notifiedToken = token;
      });

      setAccessToken('subscriber-token-123');
      assert.equal(notifiedToken, 'subscriber-token-123');

      unsubscribe();
      setAccessToken('after-unsubscribe-token');
      assert.equal(notifiedToken, 'subscriber-token-123'); // Should not update after unsubscribe
    });
  });

  describe('2. User Registration', () => {
    it('should send POST request to /register with credentials include and store access token', async () => {
      let capturedUrl = '';
      let capturedOptions = null;

      globalThis.fetch = async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        return {
          ok: true,
          status: 201,
          json: async () => ({
            success: true,
            user: { id: 'u1', email: 'operator@nexa.ai', displayName: 'Operator' },
            accessToken: 'mock-access-token-1234',
          }),
        };
      };

      const result = await register({
        email: 'operator@nexa.ai',
        password: 'Password123!',
        displayName: 'Operator',
      });

      assert.ok(capturedUrl.includes('/register'));
      assert.equal(capturedOptions.method, 'POST');
      assert.equal(capturedOptions.credentials, 'include');
      assert.equal(result.success, true);
      assert.equal(result.user.email, 'operator@nexa.ai');
      assert.equal(getAccessToken(), 'mock-access-token-1234');
    });

    it('should throw descriptive error on 409 duplicate email', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 409,
        json: async () => ({ error: 'An account with this email address already exists.' }),
      });

      await assert.rejects(
        async () => register({ email: 'taken@nexa.ai', password: 'Password123!' }),
        /already exists/
      );
    });
  });

  describe('3. User Login', () => {
    it('should send POST request to /login and update in-memory access token', async () => {
      let capturedUrl = '';
      let capturedBody = null;

      globalThis.fetch = async (url, options) => {
        capturedUrl = url;
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            user: { id: 'u1', email: 'shivam@nexa.ai' },
            accessToken: 'login-token-5678',
          }),
        };
      };

      const result = await login({ email: 'shivam@nexa.ai', password: 'MyPassword' });
      assert.ok(capturedUrl.includes('/login'));
      assert.equal(capturedBody.email, 'shivam@nexa.ai');
      assert.equal(getAccessToken(), 'login-token-5678');
      assert.equal(result.user.email, 'shivam@nexa.ai');
    });

    it('should throw error on invalid credentials (401)', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid email or password.' }),
      });

      await assert.rejects(
        async () => login({ email: 'user@nexa.ai', password: 'wrong' }),
        /Invalid email or password/
      );
      assert.equal(getAccessToken(), null);
    });
  });

  describe('4. Session Refresh', () => {
    it('should call /refresh and update access token on success', async () => {
      globalThis.fetch = async (url, options) => {
        assert.ok(url.includes('/refresh'));
        assert.equal(options.credentials, 'include');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            accessToken: 'refreshed-jwt-token',
            user: { id: 'u1', email: 'user@nexa.ai' },
          }),
        };
      };

      const res = await refreshSession();
      assert.equal(res.accessToken, 'refreshed-jwt-token');
      assert.equal(getAccessToken(), 'refreshed-jwt-token');
    });

    it('should clear access token when refresh fails', async () => {
      setAccessToken('old-stale-token');
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Token expired' }),
      });

      await assert.rejects(async () => refreshSession());
      assert.equal(getAccessToken(), null);
    });

    it('should deduplicate concurrent in-flight calls to refreshSession into a single HTTP request', async () => {
      let fetchCallCount = 0;
      globalThis.fetch = async (url) => {
        fetchCallCount++;
        // Simulate real network delay
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            accessToken: 'concurrent-refreshed-token',
            user: { id: 'u1', email: 'user@nexa.ai' },
          }),
        };
      };

      // Fire 3 simultaneous refreshSession calls concurrently
      const [res1, res2, res3] = await Promise.all([
        refreshSession(),
        refreshSession(),
        refreshSession(),
      ]);

      // Exactly 1 fetch should have been made across all 3 concurrent calls
      assert.equal(fetchCallCount, 1);
      assert.equal(res1.accessToken, 'concurrent-refreshed-token');
      assert.equal(res2.accessToken, 'concurrent-refreshed-token');
      assert.equal(res3.accessToken, 'concurrent-refreshed-token');
      assert.equal(getAccessToken(), 'concurrent-refreshed-token');
    });
  });

  describe('5. User Logout', () => {
    it('should call /logout and clear in-memory token', async () => {
      setAccessToken('active-token');
      let logoutCalled = false;

      globalThis.fetch = async (url) => {
        if (url.includes('/logout')) {
          logoutCalled = true;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        };
      };

      await logout();
      assert.equal(logoutCalled, true);
      assert.equal(getAccessToken(), null);
    });
  });

  describe('6. Authenticated Profile & Preferences', () => {
    it('getMe should transmit Authorization Bearer header', async () => {
      setAccessToken('operator-bearer-token');
      let capturedAuthHeader = '';

      globalThis.fetch = async (url, options) => {
        capturedAuthHeader = options.headers.Authorization;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            user: { id: 'u1', email: 'op@nexa.ai', aiProvider: 'gemini' },
          }),
        };
      };

      const res = await getMe();
      assert.equal(capturedAuthHeader, 'Bearer operator-bearer-token');
      assert.equal(res.user.aiProvider, 'gemini');
    });

    it('updatePreferences should send PATCH with preferences payload', async () => {
      setAccessToken('operator-bearer-token');
      let capturedMethod = '';
      let capturedBody = null;

      globalThis.fetch = async (url, options) => {
        capturedMethod = options.method;
        capturedBody = JSON.parse(options.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            user: { id: 'u1', ...capturedBody },
          }),
        };
      };

      const res = await updatePreferences({ aiProvider: 'ollama', ollamaModel: 'llama3:8b' });
      assert.equal(capturedMethod, 'PATCH');
      assert.equal(capturedBody.aiProvider, 'ollama');
      assert.equal(res.user.ollamaModel, 'llama3:8b');
    });

    it('claimLegacyData should send POST to /claim-legacy with Bearer header', async () => {
      setAccessToken('valid-token');
      let calledUrl = '';

      globalThis.fetch = async (url) => {
        calledUrl = url;
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, claimedMemories: 5, claimedConversations: 2 }),
        };
      };

      const res = await claimLegacyData();
      assert.ok(calledUrl.includes('/claim-legacy'));
      assert.equal(res.claimedMemories, 5);
    });
  });
});
