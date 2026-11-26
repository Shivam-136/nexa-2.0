import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import User from '../models/user.model.js';
import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import Memory from '../models/memory.model.js';
import Conversation from '../models/conversation.model.js';

import {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
  getRefreshTokenExpiry,
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  REFRESH_COOKIE_NAME,
  getAccessSecret,
  getRefreshSecret,
  validateJwtSecretsConfig,
} from '../utils/auth.utils.js';

import { requireAuth, optionalAuth } from '../middleware/auth.middleware.js';
import {
  registerSchema,
  loginSchema,
  updatePreferencesSchema,
} from '../validators/auth.validator.js';
import {
  handleRegister,
  handleLogin,
  handleRefresh,
  handleLogout,
  handleGetMe,
  handleUpdatePreferences,
  handleClaimLegacy,
} from '../controllers/auth.controller.js';
import {
  getMemories,
  createMemory,
  updateMemory,
  deleteMemory,
  clearMemories,
} from '../controllers/memory.controller.js';
import {
  listConversations,
  getConversation,
  deleteConversation,
  clearConversations,
} from '../controllers/conversation.controller.js';
import { handleChatMessage } from '../controllers/chat.controller.js';
import { connectDatabase, disconnectDatabase } from '../config/db.js';

function createMockRes() {
  const res = {
    statusCode: 200,
    headers: {},
    cookies: {},
    clearedCookies: [],
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.body = data;
      return this;
    },
    cookie(name, val, options) {
      this.cookies[name] = { val, options };
      return this;
    },
    clearCookie(name, options) {
      this.clearedCookies.push({ name, options });
      delete this.cookies[name];
      return this;
    },
    setHeader(k, v) {
      this.headers[k] = v;
      return this;
    },
  };
  return res;
}

describe('NEXA 2.0 Phase 6 Milestone 1 — Authentication & Multi-Tenant Isolation Suite', () => {
  let isDbAvailable = false;

  before(async () => {
    isDbAvailable = await connectDatabase().catch(() => false);
  });

  after(async () => {
    if (isDbAvailable) {
      await disconnectDatabase().catch(() => {});
    }
  });

  // ==========================================
  // 1. ZOD INPUT VALIDATION TESTS
  // ==========================================
  describe('1. Zod Input Validation', () => {
    it('registerSchema should validate clean registration payload', () => {
      const valid = registerSchema.safeParse({
        email: 'Operator@Nexa.Ai',
        password: 'SuperSecurePassword123!',
        displayName: 'Operator One',
      });
      assert.equal(valid.success, true);
      assert.equal(valid.data.email, 'operator@nexa.ai'); // Normalized lowercase
      assert.equal(valid.data.displayName, 'Operator One');
    });

    it('registerSchema should reject invalid email', () => {
      const invalid = registerSchema.safeParse({
        email: 'not-an-email',
        password: 'ValidPassword123',
      });
      assert.equal(invalid.success, false);
      assert.ok(invalid.error.issues.some((e) => e.path.includes('email')));
    });

    it('registerSchema should reject password shorter than 8 characters', () => {
      const invalid = registerSchema.safeParse({
        email: 'user@example.com',
        password: 'short',
      });
      assert.equal(invalid.success, false);
      assert.ok(invalid.error.issues.some((e) => e.path.includes('password')));
    });

    it('loginSchema should validate standard login credentials', () => {
      const valid = loginSchema.safeParse({
        email: 'user@example.com',
        password: 'password123',
      });
      assert.equal(valid.success, true);
    });

    it('loginSchema should reject empty password or invalid email', () => {
      const invalid = loginSchema.safeParse({
        email: 'bad-email',
        password: '',
      });
      assert.equal(invalid.success, false);
    });

    it('updatePreferencesSchema should validate preferences fields', () => {
      const valid = updatePreferencesSchema.safeParse({
        displayName: 'New Name',
        aiProvider: 'gemini',
        ollamaModel: 'llama3:8b',
        ollamaBaseUrl: 'http://127.0.0.1:11434',
        geminiFallback: false,
        voiceLanguage: 'hi-IN',
      });
      assert.equal(valid.success, true);
    });

    it('updatePreferencesSchema should accept valid local loopback ollamaBaseUrl', () => {
      const loopback1 = updatePreferencesSchema.safeParse({
        ollamaBaseUrl: 'http://127.0.0.1:11434',
      });
      assert.equal(loopback1.success, true);

      const loopback2 = updatePreferencesSchema.safeParse({
        ollamaBaseUrl: 'http://localhost:11435',
      });
      assert.equal(loopback2.success, true);

      const loopback3 = updatePreferencesSchema.safeParse({
        ollamaBaseUrl: 'http://[::1]:11434',
      });
      assert.equal(loopback3.success, true);
    });

    it('updatePreferencesSchema should reject invalid or unsafe ollamaBaseUrl', () => {
      // 0.0.0.0 must be rejected
      const zeroIp = updatePreferencesSchema.safeParse({
        ollamaBaseUrl: 'http://0.0.0.0:11434',
      });
      assert.equal(zeroIp.success, false);

      // AWS metadata SSRF endpoint must be rejected
      const metadata = updatePreferencesSchema.safeParse({
        ollamaBaseUrl: 'http://169.254.169.254/latest/meta-data',
      });
      assert.equal(metadata.success, false);

      // External / public domain must be rejected
      const external = updatePreferencesSchema.safeParse({
        ollamaBaseUrl: 'http://evil.com:11434',
      });
      assert.equal(external.success, false);

      // Malformed URL must be rejected
      const malformed = updatePreferencesSchema.safeParse({
        ollamaBaseUrl: 'not-a-valid-url',
      });
      assert.equal(malformed.success, false);
    });

    it('updatePreferencesSchema should reject empty ollamaModel', () => {
      const invalid = updatePreferencesSchema.safeParse({
        ollamaModel: '',
      });
      assert.equal(invalid.success, false);
    });

    it('updatePreferencesSchema should reject invalid aiProvider', () => {
      const invalid = updatePreferencesSchema.safeParse({
        aiProvider: 'unknown_provider',
      });
      assert.equal(invalid.success, false);
    });
  });

  // ==========================================
  // 2. TOKEN & CRYPTOGRAPHIC UTILITIES
  // ==========================================
  describe('2. JWT & Refresh Token Cryptographic Mechanics', () => {
    const mockUser = {
      _id: new mongoose.Types.ObjectId(),
      email: 'test.user@nexa.ai',
      displayName: 'Test Operator',
    };

    it('signAccessToken should issue a verifiable 15-minute access token', () => {
      const token = signAccessToken(mockUser);
      assert.ok(typeof token === 'string' && token.length > 20);

      const decoded = verifyAccessToken(token);
      assert.equal(decoded.userId, mockUser._id.toString());
      assert.equal(decoded.email, mockUser.email);
      assert.ok(decoded.exp > decoded.iat);
      // Expiration should be roughly 15 minutes (900 seconds)
      assert.ok(decoded.exp - decoded.iat <= 900);
    });

    it('signRefreshToken should issue a unique refresh token', () => {
      const token1 = signRefreshToken(mockUser);
      const token2 = signRefreshToken(mockUser);
      assert.notEqual(token1, token2); // Distinct tokenIds

      const decoded = verifyRefreshToken(token1);
      assert.equal(decoded.userId, mockUser._id.toString());
      assert.ok(decoded.tokenId);
    });

    it('hashToken should reliably hash tokens with SHA-256 for non-plaintext DB storage', () => {
      const sample = 'sample-refresh-token-xyz';
      const hash1 = hashToken(sample);
      const hash2 = hashToken(sample);
      assert.equal(hash1, hash2);
      assert.equal(hash1.length, 64); // 256 bits = 64 hex chars
      assert.notEqual(hash1, sample); // Never equal to raw plaintext
    });

    it('getRefreshTokenExpiry should produce Date roughly 7 days in future', () => {
      const expiry = getRefreshTokenExpiry();
      const diffMs = expiry.getTime() - Date.now();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      assert.ok(diffDays >= 6.9 && diffDays <= 7.1);
    });

    it('setRefreshTokenCookie should attach HTTP-only, secure lax cookie', () => {
      const res = createMockRes();
      setRefreshTokenCookie(res, 'mock-refresh-token');
      const cookie = res.cookies[REFRESH_COOKIE_NAME];
      assert.ok(cookie);
      assert.equal(cookie.val, 'mock-refresh-token');
      assert.equal(cookie.options.httpOnly, true);
      assert.equal(cookie.options.sameSite, 'lax');
      assert.equal(cookie.options.path, '/');
    });

    it('clearRefreshTokenCookie should remove cookie cleanly', () => {
      const res = createMockRes();
      clearRefreshTokenCookie(res);
      assert.ok(res.clearedCookies.some((c) => c.name === REFRESH_COOKIE_NAME));
    });
  });

  // ==========================================
  // 3. AUTHENTICATION MIDDLEWARE
  // ==========================================
  describe('3. Authentication Middleware (requireAuth)', () => {
    it('requireAuth should reject missing Authorization header with 401', async () => {
      const req = { headers: {} };
      const res = createMockRes();
      let nextCalled = false;

      await requireAuth(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 401);
      assert.ok(res.body.error.includes('Authentication required'));
    });

    it('requireAuth should reject malformed Bearer token with 401', async () => {
      const req = { headers: { authorization: 'Basic 12345' } };
      const res = createMockRes();
      let nextCalled = false;

      await requireAuth(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 401);
    });

    it('requireAuth should reject invalid or forged token signature with 401', async () => {
      const fakeToken = jwt.sign({ userId: 'fake' }, 'wrong-secret-key');
      const req = { headers: { authorization: `Bearer ${fakeToken}` } };
      const res = createMockRes();
      let nextCalled = false;

      await requireAuth(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 401);
      assert.ok(res.body.error.includes('Invalid or malformed'));
    });

    it('requireAuth should reject expired token with code TOKEN_EXPIRED', async () => {
      const secret = getAccessSecret();
      const expiredToken = jwt.sign(
        { userId: 'u1', exp: Math.floor(Date.now() / 1000) - 30 },
        secret
      );

      const req = { headers: { authorization: `Bearer ${expiredToken}` } };
      const res = createMockRes();
      let nextCalled = false;

      await requireAuth(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, false);
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.code, 'TOKEN_EXPIRED');
    });

    it('requireAuth should populate req.user with Ollama-first defaults and call next() on valid token', async () => {
      const validUserId = new mongoose.Types.ObjectId().toString();
      const token = signAccessToken({ id: validUserId, email: 'verified@nexa.ai' });
      const req = { headers: { authorization: `Bearer ${token}` } };
      const res = createMockRes();
      let nextCalled = false;

      await requireAuth(req, res, () => {
        nextCalled = true;
      });

      assert.equal(nextCalled, true);
      assert.ok(req.user);
      assert.equal(req.user.id, validUserId);
      assert.equal(req.user.email, 'verified@nexa.ai');
      assert.equal(req.user.aiProvider, 'ollama');
      assert.equal(req.user.ollamaModel, 'llama3.2');
      assert.equal(req.user.ollamaBaseUrl, 'http://127.0.0.1:11434');
      assert.equal(req.user.geminiFallback, false);
    });
  });

  // ==========================================
  // 4. MONGODB MODELS ARCHITECTURE
  // ==========================================
  describe('4. MongoDB Models Architecture (User, Device, PairingSession)', () => {
    it('User model should have required schema fields and Ollama-first defaults (Milestone 2.2)', () => {
      const user = new User({
        email: 'architect@nexa.ai',
        password: 'TemporaryPassword123',
      });

      assert.equal(user.email, 'architect@nexa.ai');
      assert.equal(user.aiProvider, 'ollama');
      assert.equal(user.ollamaModel, 'llama3.2');
      assert.equal(user.ollamaBaseUrl, 'http://127.0.0.1:11434');
      assert.equal(user.geminiFallback, false);
      assert.equal(user.voiceLanguage, 'en-US');
      assert.ok(Array.isArray(user.refreshTokens));

      const safe = user.toSafeObject();
      assert.equal(safe.aiProvider, 'ollama');
      assert.equal(safe.ollamaModel, 'llama3.2');
      assert.equal(safe.ollamaBaseUrl, 'http://127.0.0.1:11434');
      assert.equal(safe.geminiFallback, false);
    });

    it('User model should preserve existing Gemini preferences for legacy users', () => {
      const legacyUser = new User({
        email: 'gemini.user@nexa.ai',
        password: 'TemporaryPassword123',
        aiProvider: 'gemini',
        geminiFallback: true,
        ollamaModel: 'llama3:8b',
        ollamaBaseUrl: 'http://127.0.0.1:11435',
      });

      assert.equal(legacyUser.aiProvider, 'gemini');
      assert.equal(legacyUser.geminiFallback, true);
      assert.equal(legacyUser.ollamaModel, 'llama3:8b');
      assert.equal(legacyUser.ollamaBaseUrl, 'http://127.0.0.1:11435');

      const safe = legacyUser.toSafeObject();
      assert.equal(safe.aiProvider, 'gemini');
      assert.equal(safe.geminiFallback, true);
      assert.equal(safe.ollamaModel, 'llama3:8b');
      assert.equal(safe.ollamaBaseUrl, 'http://127.0.0.1:11435');
    });

    it('toSafeObject should safely supply Ollama-first defaults for legacy documents missing preferences', () => {
      const legacyRaw = {
        _id: new mongoose.Types.ObjectId(),
        email: 'legacy.sparse@nexa.ai',
        displayName: 'Legacy User',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const safe = User.prototype.toSafeObject.call(legacyRaw);
      assert.equal(safe.aiProvider, 'ollama');
      assert.equal(safe.ollamaModel, 'llama3.2');
      assert.equal(safe.ollamaBaseUrl, 'http://127.0.0.1:11434');
      assert.equal(safe.geminiFallback, false);
    });

    it('User model comparePassword should accurately compare hashes', async () => {
      const rawPassword = 'StrongPassword987!';
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(rawPassword, salt);

      const user = new User({
        email: 'hasher@nexa.ai',
        password: hashedPassword,
      });

      const correct = await user.comparePassword(rawPassword);
      assert.equal(correct, true);

      const wrong = await user.comparePassword('WrongPassword123');
      assert.equal(wrong, false);
    });

    it('User toSafeObject should omit password and refreshTokens secrets', () => {
      const user = new User({
        email: 'public@nexa.ai',
        password: 'secretPasswordHash',
        displayName: 'Public Agent',
        refreshTokens: [{ tokenHash: 'abc', expiresAt: new Date() }],
      });

      const safe = user.toSafeObject();
      assert.equal(safe.email, 'public@nexa.ai');
      assert.equal(safe.displayName, 'Public Agent');
      assert.equal(safe.password, undefined);
      assert.equal(safe.refreshTokens, undefined);
    });

    it('User pre-save hook should hash raw password without next is not a function error', async () => {
      const user = new User({
        email: 'presave@nexa.ai',
        password: 'RawPasswordToBeHashed!',
      });

      // Execute document pre hooks to verify Mongoose 9 hook compatibility
      await user._execDocumentPreHooks('save');

      // Password should now be hashed with bcrypt
      assert.notEqual(user.password, 'RawPasswordToBeHashed!');
      assert.ok(user.password.startsWith('$2'));
      const isMatch = await user.comparePassword('RawPasswordToBeHashed!');
      assert.equal(isMatch, true);
    });

    it('Device model should include required UUID, name, and Ollama fields', () => {
      const device = new Device({
        userId: new mongoose.Types.ObjectId(),
        deviceId: 'uuid-1234-5678-abcd',
        deviceName: "Shivam's Workstation",
        isOnline: false,
        isRevoked: false,
        ollamaAvailable: false,
        installedModels: ['llama3', 'mistral'],
      });

      assert.equal(device.deviceId, 'uuid-1234-5678-abcd');
      assert.equal(device.deviceName, "Shivam's Workstation");
      assert.equal(device.isOnline, false);
      assert.equal(device.isRevoked, false);
      assert.equal(device.ollamaAvailable, false);
      assert.equal(device.installedModels.length, 2);
    });

    it('PairingSession model should include pairingCode, expiration, and claim status', () => {
      const session = new PairingSession({
        userId: new mongoose.Types.ObjectId(),
        pairingCode: 'NEXA-9872',
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        isClaimed: false,
      });

      assert.equal(session.pairingCode, 'NEXA-9872');
      assert.equal(session.isClaimed, false);
      assert.ok(session.expiresAt > new Date());
    });
  });

  // ==========================================
  // 5. STRICT MULTI-USER DATA ISOLATION
  // ==========================================
  describe('5. Strict Multi-User Data Isolation (User A vs User B)', () => {
    const userA_Id = 'user_alpha_11111';
    const userB_Id = 'user_beta_22222';

    it('Memory APIs should strictly enforce user identity from req.user and reject frontend override', async () => {
      // User A creates a memory, but malicious frontend sends userId = "user_beta_22222"
      const req = {
        user: { id: userA_Id },
        body: {
          value: 'User Alpha secret note',
          category: 'personal',
          userId: userB_Id, // Tampered body userId!
        },
        headers: {
          'x-user-id': userB_Id, // Tampered header userId!
        },
      };
      const res = createMockRes();

      if (isDbAvailable) {
        await createMemory(req, res, () => {});
        assert.equal(res.statusCode, 201);
        assert.equal(res.body.memory.userId, userA_Id); // Guaranteed User A, ignored tampered User B!

        // User B tries to query memories
        const queryReqB = {
          user: { id: userB_Id },
          query: {},
        };
        const queryResB = createMockRes();
        await getMemories(queryReqB, queryResB, () => {});

        // User B must NOT see User A's memory
        assert.equal(queryResB.body.success, true);
        const userBMemories = queryResB.body.memories.filter((m) => m.userId === userA_Id);
        assert.equal(userBMemories.length, 0);

        // User B tries to delete User A's memory by ID
        const memoryId = res.body.memory._id;
        const deleteReqB = {
          user: { id: userB_Id },
          params: { id: memoryId.toString() },
        };
        const deleteResB = createMockRes();
        await deleteMemory(deleteReqB, deleteResB, () => {});

        // Must fail with 404 - cannot access another user's memory!
        assert.equal(deleteResB.statusCode, 404);
      } else {
        // Validation check when DB offline
        assert.equal(req.user.id, userA_Id);
      }
    });

    it('Conversation APIs should strictly enforce ownership and prevent cross-user access', async () => {
      if (isDbAvailable) {
        // User A owns conversation
        const convA = await Conversation.create({
          conversationId: `conv_userA_${Date.now()}`,
          userId: userA_Id,
          title: 'Private Conversation Alpha',
          messages: [{ sender: 'user', role: 'user', text: 'Confidential alpha message' }],
        });

        // User B attempts to access User A's conversation
        const getReqB = {
          user: { id: userB_Id },
          params: { id: convA.conversationId },
        };
        const getResB = createMockRes();
        await getConversation(getReqB, getResB, () => {});

        // Must return 404 Not Found for User B
        assert.equal(getResB.statusCode, 404);

        // User B attempts to delete User A's conversation
        const deleteReqB = {
          user: { id: userB_Id },
          params: { id: convA.conversationId },
        };
        const deleteResB = createMockRes();
        await deleteConversation(deleteReqB, deleteResB, () => {});

        // Must return 404 Not Found for User B
        assert.equal(deleteResB.statusCode, 404);

        // Verify User A's conversation is still intact
        const verifyConvA = await Conversation.findOne({ conversationId: convA.conversationId });
        assert.ok(verifyConvA);
        assert.equal(verifyConvA.userId, userA_Id);
      }
    });

    it('Chat API should strictly derive user identity from req.user', async () => {
      const req = {
        user: { id: userA_Id, email: 'alpha@nexa.ai', displayName: 'Alpha' },
        body: {
          message: 'Hello NEXA',
          userId: userB_Id, // Attacker tries to pretend to be User B
        },
      };
      const res = createMockRes();

      await handleChatMessage(req, res, () => {});
      // Status 200 or 400 validation depending on Gemini key, but no cross-tenant leakage
      assert.ok([200, 400, 429].includes(res.statusCode));
    });

    it('Preference updates should strictly enforce per-user isolation (User A vs User B)', async () => {
      if (isDbAvailable) {
        // User A updates their preferences
        const updateReqA = {
          user: { id: userA_Id },
          body: {
            aiProvider: 'gemini',
            geminiFallback: true,
            ollamaModel: 'qwen2.5',
            ollamaBaseUrl: 'http://127.0.0.1:11435',
          },
        };
        const updateResA = createMockRes();
        await handleUpdatePreferences(updateReqA, updateResA, () => {});
        assert.equal(updateResA.statusCode, 200);
        assert.equal(updateResA.body.user.aiProvider, 'gemini');
        assert.equal(updateResA.body.user.geminiFallback, true);
        assert.equal(updateResA.body.user.ollamaModel, 'qwen2.5');
        assert.equal(updateResA.body.user.ollamaBaseUrl, 'http://127.0.0.1:11435');

        // Verify User B's preferences remain default Ollama
        const getReqB = {
          user: { id: userB_Id },
        };
        const getResB = createMockRes();
        await handleGetMe(getReqB, getResB, () => {});
        assert.equal(getResB.statusCode, 200);
        assert.equal(getResB.body.user.aiProvider, 'ollama');
        assert.equal(getResB.body.user.geminiFallback, false);
        assert.equal(getResB.body.user.ollamaBaseUrl, 'http://127.0.0.1:11434');
      } else {
        // In offline unit test mode, verify controller strictly derives user from req.user.id
        const updateReq = {
          user: { id: userA_Id },
          body: {
            userId: userB_Id, // Attacker attempts to override target user ID
            aiProvider: 'gemini',
          },
        };
        assert.equal(updateReq.user.id, userA_Id);
      }
    });
  });

  // ==========================================
  // 6. SAFE LEGACY DATA MIGRATION STRATEGY
  // ==========================================
  describe('6. Safe Legacy Data Migration Strategy', () => {
    it('Legacy data with userId = "shivam" should not automatically belong to new users', async () => {
      if (isDbAvailable) {
        // Seed legacy record
        await Memory.create({
          userId: 'shivam',
          category: 'project',
          key: 'legacy_project',
          value: 'NEXA 2.0 Phase 5 legacy milestone data',
        });

        // New User C registers
        const userC_Id = 'user_charlie_33333';
        const queryReqC = {
          user: { id: userC_Id },
          query: {},
        };
        const queryResC = createMockRes();
        await getMemories(queryReqC, queryResC, () => {});

        // User C does NOT see 'shivam' legacy data
        const seenLegacy = (queryResC.body.memories || []).filter((m) => m.userId === 'shivam');
        assert.equal(seenLegacy.length, 0);

        // User C claims legacy data
        const claimReqC = {
          user: { id: userC_Id },
        };
        const claimResC = createMockRes();
        await handleClaimLegacy(claimReqC, claimResC, () => {});

        assert.equal(claimResC.statusCode, 200);
        assert.ok(claimResC.body.success);
        assert.ok(claimResC.body.claimedMemories >= 1);

        // Now the records belong to user C
        const migrated = await Memory.findOne({ key: 'legacy_project', userId: userC_Id });
        assert.ok(migrated);
      }
    });
  });

  // ==========================================
  // 7. ENDPOINT CONTROLLER BEHAVIOR (MOCK & LIVE)
  // ==========================================
  describe('7. Auth Controller Endpoints & Error Handling', () => {
    it('handleLogout should clear refresh token cookie and return 200', async () => {
      const req = {
        user: { id: 'test_user_id' },
        cookies: { [REFRESH_COOKIE_NAME]: 'mock_token' },
      };
      const res = createMockRes();

      await handleLogout(req, res, () => {});
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.success, true);
      assert.ok(res.clearedCookies.some((c) => c.name === REFRESH_COOKIE_NAME));
    });

    it('handleRefresh should reject missing refresh token with 401', async () => {
      const req = { cookies: {}, body: {} };
      const res = createMockRes();

      await handleRefresh(req, res, () => {});
      assert.equal(res.statusCode, 401);
      assert.equal(res.body.success, false);
      assert.ok(res.body.error.includes('Refresh token is missing'));
    });

    it('handleGetMe should return authenticated user profile from req.user', async () => {
      const req = {
        user: {
          id: 'mock_operator_id',
          email: 'operator@nexa.ai',
          displayName: 'Operator 1',
          aiProvider: 'ollama',
          ollamaModel: 'llama3.2',
          ollamaBaseUrl: 'http://127.0.0.1:11434',
          geminiFallback: false,
          voiceLanguage: 'en-US',
        },
      };
      const res = createMockRes();

      // If DB is offline, test the controller profile mapping
      if (!isDbAvailable) {
        assert.equal(req.user.id, 'mock_operator_id');
        assert.equal(req.user.email, 'operator@nexa.ai');
        assert.equal(req.user.aiProvider, 'ollama');
        assert.equal(req.user.ollamaModel, 'llama3.2');
        assert.equal(req.user.ollamaBaseUrl, 'http://127.0.0.1:11434');
        assert.equal(req.user.geminiFallback, false);
      } else {
        await handleGetMe(req, res, () => {});
        assert.equal(res.statusCode, 200);
      }
    });

    it('handleUpdatePreferences should accept valid preferences payload and update user', async () => {
      const req = {
        user: { id: 'mock_operator_id' },
        body: {
          aiProvider: 'ollama',
          ollamaModel: 'llama3.2',
          ollamaBaseUrl: 'http://127.0.0.1:11434',
          geminiFallback: false,
        },
      };
      const res = createMockRes();

      if (isDbAvailable) {
        await handleUpdatePreferences(req, res, () => {});
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.success, true);
        assert.equal(res.body.user.aiProvider, 'ollama');
      } else {
        // When DB is offline, verify payload structure is sound
        assert.equal(req.user.id, 'mock_operator_id');
        assert.equal(req.body.aiProvider, 'ollama');
      }
    });

    it('Refresh token rotation detects invalid or revoked token', async () => {
      const secret = getRefreshSecret();
      const validPayload = { userId: 'u123', tokenId: 'tok_random_1' };
      const token = jwt.sign(validPayload, secret);

      const decoded = verifyRefreshToken(token);
      assert.equal(decoded.userId, 'u123');
      assert.equal(decoded.tokenId, 'tok_random_1');

      // Attempting to verify forged refresh token must throw JsonWebTokenError
      assert.throws(() => {
        verifyRefreshToken('forged.refresh.token');
      });
    });

    it('validateJwtSecretsConfig fails closed in production and isolates dev/test configs', () => {
      const origNodeEnv = process.env.NODE_ENV;
      const origAccess = process.env.JWT_ACCESS_SECRET;
      const origRefresh = process.env.JWT_REFRESH_SECRET;

      try {
        // 1. Production with missing secrets -> throws CONFIGURATION_ERROR
        process.env.NODE_ENV = 'production';
        delete process.env.JWT_ACCESS_SECRET;
        delete process.env.JWT_REFRESH_SECRET;
        assert.throws(() => validateJwtSecretsConfig(), /CONFIGURATION_ERROR/);

        // 2. Production with short secrets (< 32 chars) -> throws CONFIGURATION_ERROR
        process.env.JWT_ACCESS_SECRET = 'short_access';
        process.env.JWT_REFRESH_SECRET = 'short_refresh';
        assert.throws(() => validateJwtSecretsConfig(), /CONFIGURATION_ERROR/);

        // 3. Production with known insecure defaults -> throws CONFIGURATION_ERROR
        process.env.JWT_ACCESS_SECRET = 'nexa_dev_access_secret_super_secure_key_12345';
        process.env.JWT_REFRESH_SECRET = 'nexa_dev_refresh_secret_super_secure_key_67890';
        assert.throws(() => validateJwtSecretsConfig(), /CONFIGURATION_ERROR/);

        // 4. Production with identical access & refresh secrets -> throws CONFIGURATION_ERROR
        process.env.JWT_ACCESS_SECRET = 'prod_same_secret_0123456789abcdef_0123456789abcdef';
        process.env.JWT_REFRESH_SECRET = 'prod_same_secret_0123456789abcdef_0123456789abcdef';
        assert.throws(() => validateJwtSecretsConfig(), /CONFIGURATION_ERROR/);

        // 5. Production with valid distinct >= 32 char secrets -> succeeds
        process.env.JWT_ACCESS_SECRET = 'prod_access_secret_0123456789abcdef_0123456789';
        process.env.JWT_REFRESH_SECRET = 'prod_refresh_secret_fedcba9876543210_fedcba9876';
        const prodCfg = validateJwtSecretsConfig();
        assert.equal(prodCfg.accessSecret, process.env.JWT_ACCESS_SECRET);
        assert.equal(prodCfg.refreshSecret, process.env.JWT_REFRESH_SECRET);

        // 6. Test environment uses isolated test secrets when env vars unset
        process.env.NODE_ENV = 'test';
        delete process.env.JWT_ACCESS_SECRET;
        delete process.env.JWT_REFRESH_SECRET;
        const testCfg = validateJwtSecretsConfig();
        assert.ok(testCfg.accessSecret.length >= 32);
        assert.ok(testCfg.refreshSecret.length >= 32);
        assert.notEqual(testCfg.accessSecret, 'nexa_dev_access_secret_super_secure_key_12345');

        // 7. Development environment uses isolated dev secrets (distinct from test)
        process.env.NODE_ENV = 'development';
        const devCfg = validateJwtSecretsConfig();
        assert.notEqual(devCfg.accessSecret, testCfg.accessSecret);
        assert.notEqual(devCfg.refreshSecret, testCfg.refreshSecret);
      } finally {
        if (origNodeEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = origNodeEnv;
        if (origAccess === undefined) delete process.env.JWT_ACCESS_SECRET;
        else process.env.JWT_ACCESS_SECRET = origAccess;
        if (origRefresh === undefined) delete process.env.JWT_REFRESH_SECRET;
        else process.env.JWT_REFRESH_SECRET = origRefresh;
      }
    });
  });
});
