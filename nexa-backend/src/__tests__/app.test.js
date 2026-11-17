import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleChatMessage, getChatStatus } from '../controllers/chat.controller.js';
import { errorHandler, notFoundHandler } from '../middleware/error.middleware.js';

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
    setHeader(key, val) {
      this.headers[key] = val;
      return this;
    },
  };
  return res;
}

describe('NEXA 2.0 Backend Controller & Middleware Unit Tests', () => {
  it('handleChatMessage should reject missing or empty message with 400', async () => {
    const req = { body: {} };
    const res = createMockRes();

    await handleChatMessage(req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('Field "message" is required'));
  });

  it('handleChatMessage should reject non-array conversationHistory with 400', async () => {
    const req = {
      body: {
        message: 'Hello',
        conversationHistory: 'not-an-array',
      },
    };
    const res = createMockRes();

    await handleChatMessage(req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('conversationHistory'));
  });

  it('handleChatMessage should reject invalid role in conversationHistory with 400', async () => {
    const req = {
      body: {
        message: 'Hello',
        conversationHistory: [{ role: 'admin', text: 'hi' }],
      },
    };
    const res = createMockRes();

    await handleChatMessage(req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('Invalid role'));
  });

  it('handleChatMessage should reject oversized message exceeding 4,000 characters with 400', async () => {
    const req = {
      body: {
        message: 'A'.repeat(4001),
      },
    };
    const res = createMockRes();

    await handleChatMessage(req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('exceeds maximum allowable limit'));
  });

  it('handleChatMessage should reject non-object userContext with 400', async () => {
    const req = {
      body: {
        message: 'Hello',
        userContext: 'invalid-string',
      },
    };
    const res = createMockRes();

    await handleChatMessage(req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('userContext'));
  });

  it('handleChatMessage should reject array userContext with 400', async () => {
    const req = {
      body: {
        message: 'Hello',
        userContext: ['invalid', 'array'],
      },
    };
    const res = createMockRes();

    await handleChatMessage(req, res, () => {});

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('userContext'));
  });

  it('getChatStatus should return 200 with model information', () => {
    const req = {};
    const res = createMockRes();

    getChatStatus(req, res);

    assert.equal(res.statusCode, 200);
    assert.ok('status' in res.body);
    assert.ok('model' in res.body);
    assert.ok('geminiConfigured' in res.body);
  });

  it('notFoundHandler should return 404 with error message', () => {
    const req = { method: 'GET', originalUrl: '/api/invalid' };
    const res = createMockRes();

    notFoundHandler(req, res);

    assert.equal(res.statusCode, 404);
    assert.equal(res.body.success, false);
    assert.ok(res.body.error.includes('/api/invalid'));
  });

  it('errorHandler should format and return error response with correct status code', () => {
    const req = { method: 'POST', url: '/api/chat' };
    const res = createMockRes();
    const testErr = new Error('Rate limit exceeded');
    testErr.statusCode = 429;

    errorHandler(testErr, req, res, () => {});

    assert.equal(res.statusCode, 429);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error, 'Rate limit exceeded');
  });
});
