/**
 * NEXA 2.0 Desktop Agent - M3.4.5 Auto Reconnect & Exponential Backoff Tests
 */

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const { DeviceAuthClient } = require('../main/auth/deviceAuthClient');
const { HeartbeatClient, CONNECTION_STATES } = require('../main/heartbeat/heartbeatClient');

function createMockStorage({ credentials = null } = {}) {
  const stored = credentials ? { ...credentials } : null;
  return {
    isEncryptionAvailable: () => true,
    hasCredentials: () => Boolean(stored),
    getCredentials: () => (stored ? { ...stored } : null),
    getDeviceInfo: () => ({
      isPaired: Boolean(stored),
      deviceId: stored?.deviceId || null,
      deviceName: stored?.deviceName || null,
      userId: stored?.userId || null,
      backendUrl: stored?.backendUrl || null,
      pairedAt: stored?.pairedAt || null,
    }),
  };
}

describe('NEXA 2.0 Desktop Agent — M3.4.5 Auto Reconnect & Exponential Backoff', () => {
  const secretDeviceToken = 'dpapi_secret_device_token_m345_1234567890abcdef1234567890';
  let mockStorage;

  beforeEach(() => {
    mockStorage = createMockStorage({
      credentials: {
        deviceId: 'dev-m345-001',
        deviceName: 'Desktop-M345',
        deviceToken: secretDeviceToken,
        deviceGeneration: 1,
        userId: 'user-m345-001',
        backendUrl: 'http://127.0.0.1:5000',
        pairedAt: '2026-11-26T10:00:00.000Z',
      },
    });
  });

  it('computes exponential backoff progression, caps at maxReconnectDelayMs, and applies jitter', () => {
    const authClient = new DeviceAuthClient({ storageService: mockStorage });

    // 1. Deterministic progression without jitter (jitterFactor = 0)
    const noJitterClient = new HeartbeatClient({
      deviceAuthClient: authClient,
      initialReconnectDelayMs: 1000,
      backoffMultiplier: 2,
      maxReconnectDelayMs: 60000,
      jitterFactor: 0,
    });

    assert.equal(noJitterClient.calculateBackoffDelay(1), 1000);
    assert.equal(noJitterClient.calculateBackoffDelay(2), 2000);
    assert.equal(noJitterClient.calculateBackoffDelay(3), 4000);
    assert.equal(noJitterClient.calculateBackoffDelay(4), 8000);
    assert.equal(noJitterClient.calculateBackoffDelay(5), 16000);
    assert.equal(noJitterClient.calculateBackoffDelay(6), 32000);
    assert.equal(noJitterClient.calculateBackoffDelay(7), 60000);
    assert.equal(noJitterClient.calculateBackoffDelay(10), 60000);

    // 2. Randomized jitter bounds (+/- 20%)
    const lowJitter = new HeartbeatClient({
      deviceAuthClient: authClient,
      initialReconnectDelayMs: 1000,
      backoffMultiplier: 2,
      maxReconnectDelayMs: 60000,
      jitterFactor: 0.2,
      randomFn: () => 0,
    });
    const highJitter = new HeartbeatClient({
      deviceAuthClient: authClient,
      initialReconnectDelayMs: 1000,
      backoffMultiplier: 2,
      maxReconnectDelayMs: 60000,
      jitterFactor: 0.2,
      randomFn: () => 1,
    });

    assert.equal(lowJitter.calculateBackoffDelay(1), 800);
    assert.equal(highJitter.calculateBackoffDelay(1), 1200);
    assert.equal(highJitter.calculateBackoffDelay(8), 60000); // never exceeds max cap
  });

  it('resets backoff after successful recovery and cancels pending retry timer on stop()', async () => {
    const scheduled = [];
    const cleared = [];
    let nextTimerId = 1;
    let mode = 'fail_503';

    const authClient = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'acc_m345_1',
              refreshToken: 'ref_m345_1',
              expiresIn: 900,
              deviceId: 'dev-m345-001',
              deviceGeneration: 1,
              userId: 'user-m345-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/heartbeat')) {
          if (mode === 'fail_503') {
            return { ok: false, status: 503, json: async () => ({ success: false, error: 'Unavailable' }) };
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'ONLINE',
              isOnline: true,
              lastHeartbeatAt: '2026-11-26T15:00:00.000Z',
              heartbeatCount: 1,
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await authClient.authenticate();

    const hbClient = new HeartbeatClient({
      deviceAuthClient: authClient,
      intervalMs: 30000,
      initialReconnectDelayMs: 1000,
      backoffMultiplier: 2,
      maxReconnectDelayMs: 60000,
      jitterFactor: 0,
      setTimeoutFn: (fn, delay) => {
        const id = nextTimerId++;
        scheduled.push({ id, fn, delay });
        return id;
      },
      clearTimeoutFn: (id) => {
        cleared.push(id);
      },
    });

    hbClient.start();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(hbClient.getStatus().state, CONNECTION_STATES.RECONNECTING);
    assert.equal(hbClient.getStatus().consecutiveFailures, 1);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0].delay, 1000);

    // Trigger 2nd failure via scheduled callback
    scheduled[0].fn();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(hbClient.getStatus().consecutiveFailures, 2);
    assert.equal(scheduled.length, 2);
    assert.equal(scheduled[1].delay, 2000);

    // Recover -> resets consecutiveFailures and nextRetryDelayMs
    mode = 'ok';
    scheduled[1].fn();
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(hbClient.getStatus().state, CONNECTION_STATES.ONLINE);
    assert.equal(hbClient.getStatus().consecutiveFailures, 0);
    assert.equal(hbClient.getStatus().nextRetryDelayMs, null);
    assert.equal(scheduled[2].delay, 30000); // back to normal intervalMs

    // Stop cancels pending timer
    hbClient.stop();
    assert.ok(cleared.includes(scheduled[2].id));
    assert.equal(hbClient.getStatus().isRunning, false);
  });

  it('handles 500, 502, 503, ECONNRESET, ENOTFOUND without destroying refresh tokens or creating duplicate loops', async () => {
    const errors = [
      () => Promise.reject(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })),
      () => Promise.reject(Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' })),
      () => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Internal' }) }),
      () => Promise.resolve({ ok: false, status: 502, json: async () => ({ error: 'Bad Gateway' }) }),
      () => Promise.resolve({ ok: false, status: 503, json: async () => ({ error: 'Unavailable' }) }),
    ];
    let idx = 0;

    const authClient = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url) => {
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'acc_keep',
              refreshToken: 'ref_keep',
              expiresIn: 900,
              deviceId: 'dev-m345-001',
              deviceGeneration: 1,
              userId: 'user-m345-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/heartbeat')) {
          if (idx < errors.length) {
            return await errors[idx++]();
          }
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'ONLINE',
              isOnline: true,
              lastHeartbeatAt: '2026-11-26T15:10:00.000Z',
              heartbeatCount: 1,
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    await authClient.authenticate();
    const hbClient = new HeartbeatClient({
      deviceAuthClient: authClient,
      intervalMs: 60000,
      initialReconnectDelayMs: 25,
      jitterFactor: 0,
    });

    // Calling start() multiple times does not create duplicate loops
    assert.equal(hbClient.start(), true);
    assert.equal(hbClient.start(), true);

    for (let i = 0; i < errors.length; i += 1) {
      const s = await hbClient.sendHeartbeat();
      assert.equal(s.state, CONNECTION_STATES.RECONNECTING);
      assert.equal(authClient._refreshToken, 'ref_keep');
    }

    const ok = await hbClient.sendHeartbeat();
    hbClient.stop();
    assert.equal(ok.state, CONNECTION_STATES.ONLINE);
    assert.equal(ok.isOnline, true);
  });

  it('recovers from startup during backend outage without throwing unhandled rejections', async () => {
    let backendUp = false;

    const authClient = new DeviceAuthClient({
      storageService: mockStorage,
      fetchImpl: async (url) => {
        if (!backendUp) {
          throw new TypeError('fetch failed: ECONNREFUSED');
        }
        if (url.endsWith('/api/v1/device/auth/token')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              accessToken: 'acc_outage_recovered',
              refreshToken: 'ref_outage_recovered',
              expiresIn: 900,
              deviceId: 'dev-m345-001',
              deviceGeneration: 1,
              userId: 'user-m345-001',
            }),
          };
        }
        if (url.endsWith('/api/v1/device/heartbeat')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              success: true,
              status: 'ONLINE',
              isOnline: true,
              lastHeartbeatAt: '2026-11-26T15:20:00.000Z',
              heartbeatCount: 1,
            }),
          };
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    });

    const hbClient = new HeartbeatClient({
      deviceAuthClient: authClient,
      intervalMs: 60000,
      initialReconnectDelayMs: 30,
      jitterFactor: 0,
    });

    // Startup fails -> start hbClient for auto-reconnect
    await authClient.authenticate().catch(() => {
      hbClient.start();
    });

    await new Promise((r) => setTimeout(r, 40));
    assert.equal(hbClient.getStatus().state, CONNECTION_STATES.RECONNECTING);

    // Backend comes online -> next backoff tick authenticates and marks ONLINE
    backendUp = true;
    await new Promise((r) => setTimeout(r, 90));
    hbClient.stop();

    assert.equal(hbClient.getStatus().state, CONNECTION_STATES.ONLINE);
    assert.equal(hbClient.getStatus().isOnline, true);
  });
});
