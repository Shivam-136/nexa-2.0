import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import app from '../app.js';
import Device from '../models/device.model.js';
import PairingSession from '../models/pairingSession.model.js';
import User from '../models/user.model.js';
import { signAccessToken } from '../utils/auth.utils.js';
import {
  signDeviceAccessToken,
  signDeviceRefreshToken,
  validateDeviceJwtSecretsConfig,
} from '../utils/deviceAuth.utils.js';
import { initiatePairingSession, claimPairingSession } from '../services/pairing.service.js';
import { startTestMongo, stopTestMongo } from './helpers/testMongo.js';

describe('NEXA 2.0 Milestone 3.4.2 — Secure Device-to-Backend Authentication', () => {
  let userA;
  let userB;
  let userAToken;
  let userBToken;
  let server;
  let baseUrl;

  before(async () => {
    await startTestMongo(27025);
    userA = await User.create({
      email: `devauth_a_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'Owner Alpha',
    });
    userB = await User.create({
      email: `devauth_b_${Date.now()}@nexa.ai`,
      password: 'SecurePassword123!',
      displayName: 'Owner Beta',
    });
    userAToken = signAccessToken(userA);
    userBToken = signAccessToken(userB);

    await new Promise((resolve) => {
      server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await stopTestMongo();
  });

  beforeEach(async () => {
    await PairingSession.deleteMany({});
    await Device.deleteMany({});
  });

  async function pairTestDevice(ownerId, suffix = 'alpha') {
    const session = await initiatePairingSession({ userId: ownerId.toString() });
    const deviceId = `dev-m342-${suffix}-${crypto.randomUUID()}`;
    const claimed = await claimPairingSession({
      pairingCode: session.pairingCode,
      deviceId,
      deviceName: `Workstation-${suffix}`,
    });
    return claimed;
  }

  async function authenticateViaHttp(claimed) {
    const res = await fetch(`${baseUrl}/api/v1/device/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: claimed.deviceId,
        deviceGeneration: claimed.deviceGeneration,
        deviceToken: claimed.deviceToken,
      }),
    });
    const body = await res.json();
    return { status: res.status, body };
  }

  it('authenticates a paired device and accesses protected /device/me and /device/verify endpoints', async () => {
    const claimed = await pairTestDevice(userA._id, 'valid');
    const { status, body } = await authenticateViaHttp(claimed);

    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.tokenType, 'Bearer');
    assert.ok(body.accessToken);
    assert.ok(body.refreshToken);
    assert.equal(body.deviceId, claimed.deviceId);
    assert.equal(body.deviceGeneration, claimed.deviceGeneration);
    assert.equal(body.userId, userA._id.toString());

    const meRes = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: {
        Authorization: `Bearer ${body.accessToken}`,
        'X-Device-Id': claimed.deviceId,
        'X-Device-Generation': String(claimed.deviceGeneration),
      },
    });
    const meBody = await meRes.json();
    assert.equal(meRes.status, 200);
    assert.equal(meBody.success, true);
    assert.equal(meBody.device.deviceId, claimed.deviceId);
    assert.equal(meBody.device.deviceGeneration, claimed.deviceGeneration);
    assert.equal(meBody.owner.id, userA._id.toString());

    const verifyRes = await fetch(`${baseUrl}/api/v1/device/verify`, {
      headers: {
        Authorization: `Bearer ${body.accessToken}`,
      },
    });
    const verifyBody = await verifyRes.json();
    assert.equal(verifyRes.status, 200);
    assert.equal(verifyBody.authenticated, true);
  });

  it('rejects invalid deviceToken, malformed JWT, and user JWT on requireDeviceAuth', async () => {
    const claimed = await pairTestDevice(userA._id, 'invalid');

    const badCredsRes = await fetch(`${baseUrl}/api/v1/device/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deviceId: claimed.deviceId,
        deviceGeneration: claimed.deviceGeneration,
        deviceToken: '0'.repeat(64),
      }),
    });
    assert.equal(badCredsRes.status, 401);

    const noHeaderRes = await fetch(`${baseUrl}/api/v1/device/me`);
    assert.equal(noHeaderRes.status, 401);

    const malformedRes = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: { Authorization: 'Bearer not.a.valid.jwt' },
    });
    assert.equal(malformedRes.status, 401);

    // User JWT must NEVER be accepted by requireDeviceAuth
    const userJwtRes = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    assert.equal(userJwtRes.status, 401);
  });

  it('rejects expired device access tokens, expired refresh tokens, and expired device credentials', async () => {
    const claimed = await pairTestDevice(userA._id, 'expired');
    const { accessSecret, refreshSecret } = validateDeviceJwtSecretsConfig();

    const expiredAccess = jwt.sign(
      {
        typ: 'nexa_device_access',
        sub: claimed.deviceId,
        deviceId: claimed.deviceId,
        userId: claimed.userId,
        deviceGeneration: claimed.deviceGeneration,
        jti: crypto.randomUUID(),
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      accessSecret,
      { algorithm: 'HS256' }
    );

    const accessRes = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: { Authorization: `Bearer ${expiredAccess}` },
    });
    const accessBody = await accessRes.json();
    assert.equal(accessRes.status, 401);
    assert.equal(accessBody.code, 'DEVICE_TOKEN_EXPIRED');

    const expiredRefresh = jwt.sign(
      {
        typ: 'nexa_device_refresh',
        sub: claimed.deviceId,
        deviceId: claimed.deviceId,
        userId: claimed.userId,
        deviceGeneration: claimed.deviceGeneration,
        tokenId: crypto.randomUUID(),
        exp: Math.floor(Date.now() / 1000) - 60,
      },
      refreshSecret,
      { algorithm: 'HS256' }
    );

    const refreshRes = await fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: expiredRefresh }),
    });
    const refreshBody = await refreshRes.json();
    assert.equal(refreshRes.status, 401);
    assert.equal(refreshBody.code, 'DEVICE_REFRESH_TOKEN_EXPIRED');

    // Expired device credential on Device record
    await Device.updateOne(
      { deviceId: claimed.deviceId },
      { $set: { deviceTokenExpiresAt: new Date(Date.now() - 1000) } }
    );
    const credExpRes = await authenticateViaHttp(claimed);
    assert.equal(credExpRes.status, 401);
    assert.equal(credExpRes.body.code, 'DEVICE_CREDENTIAL_EXPIRED');
  });

  it('rejects revoked and quarantined devices immediately', async () => {
    const claimed = await pairTestDevice(userA._id, 'revoked');
    const authResult = await authenticateViaHttp(claimed);
    assert.equal(authResult.status, 200);
    const { accessToken, refreshToken } = authResult.body;

    // 1. Quarantine device
    await Device.updateOne({ deviceId: claimed.deviceId }, { $set: { isQuarantined: true } });
    const qRes = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(qRes.status, 403);
    assert.equal((await qRes.json()).code, 'DEVICE_QUARANTINED');

    // Clear quarantine, test pairing lock quarantine
    await Device.updateOne(
      { deviceId: claimed.deviceId },
      { $set: { isQuarantined: false, 'activePairingLock.state': 'in_pairing' } }
    );
    const lockRes = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(lockRes.status, 403);
    assert.equal((await lockRes.json()).code, 'DEVICE_QUARANTINED');

    // Reset lock, then owner revokes device via protected endpoint
    await Device.updateOne(
      { deviceId: claimed.deviceId },
      { $set: { 'activePairingLock.state': 'idle' } }
    );
    const revokeRes = await fetch(`${baseUrl}/api/v1/device/${claimed.deviceId}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userAToken}` },
    });
    assert.equal(revokeRes.status, 200);

    // Existing access token, refresh token, and re-auth must all be rejected
    const postRevokeAccess = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    assert.equal(postRevokeAccess.status, 403);
    assert.equal((await postRevokeAccess.json()).code, 'DEVICE_REVOKED');

    const postRevokeRefresh = await fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    assert.equal(postRevokeRefresh.status, 403);
    assert.equal((await postRevokeRefresh.json()).code, 'DEVICE_REVOKED');

    const postRevokeAuth = await authenticateViaHttp(claimed);
    assert.equal(postRevokeAuth.status, 403);
    assert.equal(postRevokeAuth.body.code, 'DEVICE_REVOKED');
  });

  it('rotates refresh tokens atomically and detects replay/reuse', async () => {
    const claimed = await pairTestDevice(userA._id, 'rotate');
    const authResult = await authenticateViaHttp(claimed);
    const initialRefresh = authResult.body.refreshToken;

    // 1. Valid rotation
    const rot1Res = await fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: initialRefresh,
        deviceId: claimed.deviceId,
        deviceGeneration: claimed.deviceGeneration,
      }),
    });
    const rot1Body = await rot1Res.json();
    assert.equal(rot1Res.status, 200);
    assert.ok(rot1Body.accessToken);
    assert.ok(rot1Body.refreshToken);
    assert.notEqual(rot1Body.refreshToken, initialRefresh);

    // 2. Replay of initialRefresh MUST be detected and invalidate entire token family
    const replayRes = await fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: initialRefresh,
        deviceId: claimed.deviceId,
        deviceGeneration: claimed.deviceGeneration,
      }),
    });
    const replayBody = await replayRes.json();
    assert.equal(replayRes.status, 401);
    assert.equal(replayBody.code, 'DEVICE_TOKEN_REUSE_DETECTED');

    // 3. Even rot1Body.refreshToken is now invalidated because the family was wiped
    const familyWipedRes = await fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: rot1Body.refreshToken,
        deviceId: claimed.deviceId,
        deviceGeneration: claimed.deviceGeneration,
      }),
    });
    assert.equal(familyWipedRes.status, 401);
  });

  it('enforces single-winner under concurrent refresh race with identical refresh token', async () => {
    const claimed = await pairTestDevice(userA._id, 'race');
    const authResult = await authenticateViaHttp(claimed);
    const sharedRefresh = authResult.body.refreshToken;

    const attempts = Array.from({ length: 4 }, () =>
      fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: sharedRefresh }),
      }).then(async (r) => ({ status: r.status, body: await r.json() }))
    );

    const results = await Promise.all(attempts);
    const successes = results.filter((r) => r.status === 200);
    const failures = results.filter((r) => r.status === 401);

    assert.equal(successes.length, 1, 'Exactly one concurrent refresh must succeed');
    assert.equal(failures.length, 3, 'All other concurrent refreshes must be rejected');
  });

  it('blocks cross-device token misuse and stale deviceGeneration', async () => {
    const devA = await pairTestDevice(userA._id, 'cross-a');
    const devB = await pairTestDevice(userA._id, 'cross-b');

    const authA = await authenticateViaHttp(devA);
    assert.equal(authA.status, 200);

    // 1. Access token for devA presented with X-Device-Id of devB -> 403
    const crossAccessRes = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: {
        Authorization: `Bearer ${authA.body.accessToken}`,
        'X-Device-Id': devB.deviceId,
      },
    });
    assert.equal(crossAccessRes.status, 403);
    assert.equal((await crossAccessRes.json()).code, 'CROSS_DEVICE_TOKEN_MISUSE');

    // 2. Refresh token for devA presented with deviceId of devB -> 403
    const crossRefreshRes = await fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        refreshToken: authA.body.refreshToken,
        deviceId: devB.deviceId,
      }),
    });
    assert.equal(crossRefreshRes.status, 403);
    assert.equal((await crossRefreshRes.json()).code, 'CROSS_DEVICE_TOKEN_MISUSE');

    // 3. Stale deviceGeneration after generation bump
    await Device.updateOne({ deviceId: devA.deviceId }, { $inc: { deviceGeneration: 1 } });
    const staleGenAccess = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: { Authorization: `Bearer ${authA.body.accessToken}` },
    });
    assert.equal(staleGenAccess.status, 401);
    assert.equal((await staleGenAccess.json()).code, 'DEVICE_GENERATION_MISMATCH');

    const staleGenRefresh = await fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: authA.body.refreshToken }),
    });
    assert.equal(staleGenRefresh.status, 401);
    assert.equal((await staleGenRefresh.json()).code, 'DEVICE_GENERATION_MISMATCH');
  });

  it('enforces cross-user isolation on device ownership and revocation', async () => {
    const devA = await pairTestDevice(userA._id, 'owner-a');

    // User B cannot revoke User A's device
    const crossRevokeRes = await fetch(`${baseUrl}/api/v1/device/${devA.deviceId}/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userBToken}` },
    });
    assert.equal(crossRevokeRes.status, 403);

    // Forged device token claiming User B owns User A's device -> 403 DEVICE_OWNERSHIP_MISMATCH
    const forgedAccess = signDeviceAccessToken({
      deviceId: devA.deviceId,
      userId: userB._id.toString(),
      deviceGeneration: devA.deviceGeneration,
    });
    const forgedRes = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: { Authorization: `Bearer ${forgedAccess}` },
    });
    assert.equal(forgedRes.status, 403);
    assert.equal((await forgedRes.json()).code, 'DEVICE_OWNERSHIP_MISMATCH');

    // Forged refresh token claiming User B owns User A's device -> 403
    const forgedRefresh = signDeviceRefreshToken({
      deviceId: devA.deviceId,
      userId: userB._id.toString(),
      deviceGeneration: devA.deviceGeneration,
    });
    const forgedRefreshRes = await fetch(`${baseUrl}/api/v1/device/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: forgedRefresh }),
    });
    assert.equal(forgedRefreshRes.status, 403);
    assert.equal((await forgedRefreshRes.json()).code, 'DEVICE_OWNERSHIP_MISMATCH');
  });

  it('rejects device access tokens on user requireAuth endpoints (/api/v1/auth/me)', async () => {
    const claimed = await pairTestDevice(userA._id, 'user-isolation');
    const authResult = await authenticateViaHttp(claimed);
    assert.equal(authResult.status, 200);

    const userEndpointRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${authResult.body.accessToken}` },
    });
    assert.equal(userEndpointRes.status, 401);
  });

  it('rejects recovery-locked devices (pendingResetAuth / stagedDeviceToken) as quarantined', async () => {
    const claimed = await pairTestDevice(userA._id, 'recovery-lock');
    const authResult = await authenticateViaHttp(claimed);
    assert.equal(authResult.status, 200);

    await Device.updateOne(
      { deviceId: claimed.deviceId },
      {
        $set: {
          'pendingResetAuth.ratId': 'rat-active-lock',
          'pendingResetAuth.isConsumed': false,
        },
      }
    );
    const praRes = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: { Authorization: `Bearer ${authResult.body.accessToken}` },
    });
    assert.equal(praRes.status, 403);
    assert.equal((await praRes.json()).code, 'DEVICE_QUARANTINED');

    await Device.updateOne(
      { deviceId: claimed.deviceId },
      {
        $set: {
          'pendingResetAuth.ratId': null,
          'pendingResetAuth.isConsumed': true,
          stagedDeviceToken: { operationId: 'op-1', hashedToken: 'abc' },
        },
      }
    );
    const stagedRes = await fetch(`${baseUrl}/api/v1/device/me`, {
      headers: { Authorization: `Bearer ${authResult.body.accessToken}` },
    });
    assert.equal(stagedRes.status, 403);
    assert.equal((await stagedRes.json()).code, 'DEVICE_QUARANTINED');
  });

  it('enforces fail-closed production secret validation for DEVICE_ACCESS_SECRET and DEVICE_REFRESH_SECRET', () => {
    const prevEnv = {
      NODE_ENV: process.env.NODE_ENV,
      DEVICE_ACCESS_SECRET: process.env.DEVICE_ACCESS_SECRET,
      DEVICE_REFRESH_SECRET: process.env.DEVICE_REFRESH_SECRET,
      JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
      RAT_SECRET: process.env.RAT_SECRET,
    };

    try {
      process.env.NODE_ENV = 'production';
      process.env.JWT_ACCESS_SECRET = 'prod_user_access_secret_distinct_value_00001';
      process.env.JWT_REFRESH_SECRET = 'prod_user_refresh_secret_distinct_value_00002';
      process.env.RAT_SECRET = 'prod_rat_secret_distinct_value_00003_abcdef';

      // Missing secrets
      delete process.env.DEVICE_ACCESS_SECRET;
      delete process.env.DEVICE_REFRESH_SECRET;
      assert.throws(() => validateDeviceJwtSecretsConfig(), /CONFIGURATION_ERROR/);

      // Short secrets (< 32 chars)
      process.env.DEVICE_ACCESS_SECRET = 'too_short';
      process.env.DEVICE_REFRESH_SECRET = 'too_short_2';
      assert.throws(() => validateDeviceJwtSecretsConfig(), /at least 32 characters/);

      // Identical access and refresh secrets
      process.env.DEVICE_ACCESS_SECRET = 'identical_prod_device_secret_value_00000001';
      process.env.DEVICE_REFRESH_SECRET = 'identical_prod_device_secret_value_00000001';
      assert.throws(() => validateDeviceJwtSecretsConfig(), /must be distinct/);

      // Collision with JWT_ACCESS_SECRET
      process.env.DEVICE_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET;
      process.env.DEVICE_REFRESH_SECRET = 'prod_device_refresh_secret_distinct_00000002';
      assert.throws(() => validateDeviceJwtSecretsConfig(), /must be distinct from user JWT and RAT/);

      // Collision with RAT_SECRET
      process.env.DEVICE_ACCESS_SECRET = 'prod_device_access_secret_distinct_00000001';
      process.env.DEVICE_REFRESH_SECRET = process.env.RAT_SECRET;
      assert.throws(() => validateDeviceJwtSecretsConfig(), /must be distinct from user JWT and RAT/);

      // Valid distinct >= 32-char secrets
      process.env.DEVICE_ACCESS_SECRET = 'prod_device_access_secret_distinct_00000001';
      process.env.DEVICE_REFRESH_SECRET = 'prod_device_refresh_secret_distinct_00000002';
      const cfg = validateDeviceJwtSecretsConfig();
      assert.equal(cfg.accessSecret, process.env.DEVICE_ACCESS_SECRET);
      assert.equal(cfg.refreshSecret, process.env.DEVICE_REFRESH_SECRET);
    } finally {
      for (const [k, v] of Object.entries(prevEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
