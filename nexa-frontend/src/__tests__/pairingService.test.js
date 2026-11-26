import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { setAccessToken } from '../services/auth.service.js';
import {
  initiatePairing,
  getPairingStatus,
  cancelPairing,
} from '../services/pairing.service.js';

describe('NEXA 2.0 Frontend Pairing Service Test Suite (M3.4.1)', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    setAccessToken('test-bearer-token-m341');
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    setAccessToken(null);
  });

  it('initiatePairing sends POST /v1/pairing/initiate with Bearer auth', async () => {
    globalThis.fetch = async (url, opts) => {
      assert.match(url, /\/v1\/pairing\/initiate$/);
      assert.equal(opts.method, 'POST');
      assert.equal(opts.headers.Authorization, 'Bearer test-bearer-token-m341');
      return {
        ok: true,
        status: 201,
        json: async () => ({
          success: true,
          sessionId: 'sess-123',
          pairingCode: 'ABCD-2345',
          expiresAt: '2026-11-26T10:05:00.000Z',
          status: 'pending',
        }),
      };
    };

    const res = await initiatePairing();
    assert.equal(res.pairingCode, 'ABCD-2345');
    assert.equal(res.status, 'pending');
  });

  it('getPairingStatus queries /v1/pairing/status with optional sessionId', async () => {
    globalThis.fetch = async (url, opts) => {
      assert.match(url, /\/v1\/pairing\/status\?sessionId=sess-123$/);
      assert.equal(opts.method, 'GET');
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          activeSession: { sessionId: 'sess-123', status: 'completed' },
          connectedDevices: [{ deviceId: 'dev-1', deviceName: 'My PC' }],
        }),
      };
    };

    const res = await getPairingStatus('sess-123');
    assert.equal(res.activeSession.status, 'completed');
    assert.equal(res.connectedDevices.length, 1);
  });

  it('cancelPairing sends POST /v1/pairing/cancel with sessionId', async () => {
    globalThis.fetch = async (url, opts) => {
      assert.match(url, /\/v1\/pairing\/cancel$/);
      assert.equal(opts.method, 'POST');
      assert.deepEqual(JSON.parse(opts.body), { sessionId: 'sess-123' });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          cancelled: true,
          status: 'cancelled',
        }),
      };
    };

    const res = await cancelPairing('sess-123');
    assert.equal(res.cancelled, true);
    assert.equal(res.status, 'cancelled');
  });
});
