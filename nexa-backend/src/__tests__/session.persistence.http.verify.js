import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import assert from 'node:assert/strict';
import app from '../app.js';
import User from '../models/user.model.js';
import { hashToken } from '../utils/auth.utils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function runSessionPersistenceVerification() {
  console.log('================================================================');
  console.log('🧪 NEXA 2.0 Session Persistence & Token Grace Window Verification');
  console.log('================================================================\n');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nexa';
  console.log(`[Setup] Connecting to MongoDB: ${mongoUri}...`);
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log('✓ MongoDB connected successfully.\n');

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`✓ Test HTTP server running on ${baseUrl}\n`);

  const testEmail = `session_persister_${Date.now()}@nexa.ai`;
  const testPassword = 'SessionPassword2026!';
  const testDisplayName = 'Session Tester';

  try {
    // ----------------------------------------------------
    // STEP 1: Register User & Obtain Initial Refresh Cookie
    // ----------------------------------------------------
    console.log('[STEP 1] Registering test user...');
    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        displayName: testDisplayName,
      }),
    });

    assert.equal(regRes.status, 201, 'Registration must return 201 Created');
    const regData = await regRes.json();
    assert.ok(regData.success, 'Registration success must be true');
    assert.ok(regData.accessToken, 'Access token must be provided');

    const rawSetCookie = regRes.headers.get('set-cookie');
    assert.ok(rawSetCookie, 'Set-Cookie header must be present on register/login');
    assert.ok(rawSetCookie.includes('nexa_refresh_token='), 'Cookie must contain nexa_refresh_token');
    assert.ok(rawSetCookie.includes('HttpOnly'), 'Cookie must be HttpOnly');

    // Extract cookie for client header simulation
    const cookieHeaderTokenA = rawSetCookie.split(';')[0];
    console.log(`✓ Registration succeeded. Token A Cookie: ${cookieHeaderTokenA.substring(0, 45)}...\n`);

    // ----------------------------------------------------
    // STEP 2: First Browser Reload Simulation (Refresh Call 1)
    // ----------------------------------------------------
    console.log('[STEP 2] Simulating browser reload: Refresh Call 1 with Token A...');
    const refresh1Res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeaderTokenA,
      },
    });

    assert.equal(refresh1Res.status, 200, 'Refresh Call 1 must return 200 OK');
    const refresh1Data = await refresh1Res.json();
    assert.ok(refresh1Data.success, 'Refresh Call 1 success must be true');
    assert.ok(refresh1Data.accessToken, 'Refresh Call 1 must issue new access token');
    assert.equal(refresh1Data.user.email, testEmail, 'User profile must match');

    const setCookie1 = refresh1Res.headers.get('set-cookie');
    assert.ok(setCookie1, 'Refresh Call 1 must issue rotated Set-Cookie header');
    const cookieHeaderTokenB = setCookie1.split(';')[0];
    console.log(`✓ Refresh Call 1 succeeded. Rotated Token B Cookie: ${cookieHeaderTokenB.substring(0, 45)}...\n`);

    // ----------------------------------------------------
    // STEP 3: React StrictMode / Concurrent Refresh Simulation (Refresh Call 2 with Token A)
    // ----------------------------------------------------
    console.log('[STEP 3] Simulating React StrictMode concurrent mount: Refresh Call 2 with Token A (consumed < 30s ago)...');
    const refresh2Res = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeaderTokenA, // Still presenting Token A!
      },
    });

    assert.equal(refresh2Res.status, 200, 'Refresh Call 2 within grace window MUST return 200 OK');
    const refresh2Data = await refresh2Res.json();
    assert.ok(refresh2Data.success, 'Refresh Call 2 success must be true');
    assert.ok(refresh2Data.accessToken, 'Refresh Call 2 must return valid access token');

    const setCookie2 = refresh2Res.headers.get('set-cookie');
    assert.ok(setCookie2, 'Refresh Call 2 must return valid cookie');
    assert.ok(!setCookie2.includes('Expires=Thu, 01 Jan 1970'), 'Cookie must NOT be invalidated or wiped');
    console.log('✓ Refresh Call 2 (grace window) SUCCEEDED with 200 OK and did NOT wipe the session!\n');

    // Verify database token state
    const userInDb = await User.findOne({ email: testEmail });
    assert.ok(userInDb.refreshTokens.length > 0, 'User must have active refresh tokens in database');
    console.log(`✓ Verified MongoDB: User has ${userInDb.refreshTokens.length} valid token entries (session family intact).\n`);

    // ----------------------------------------------------
    // STEP 4: Access Protected Profile Endpoint
    // ----------------------------------------------------
    console.log('[STEP 4] Verifying protected /api/v1/auth/me using issued access token...');
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${refresh2Data.accessToken}`,
      },
    });

    assert.equal(meRes.status, 200, '/me must return 200 OK');
    const meData = await meRes.json();
    assert.equal(meData.user.email, testEmail);
    console.log('✓ User profile endpoint verified successfully.\n');

    // ----------------------------------------------------
    // STEP 5: Security Replay Detection Outside Grace Window
    // ----------------------------------------------------
    console.log('[STEP 5] Testing security reuse detection for stale token outside grace window (> 30s)...');
    // Artificially age a rotated token in the database to simulate replay attack after 2 minutes
    const staleHash = hashToken('forged_or_stale_token_string');
    userInDb.refreshTokens.push({
      tokenHash: staleHash,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(Date.now() - 120000),
      rotatedAt: new Date(Date.now() - 65000), // Rotated 65 seconds ago (outside 30s grace window)
      replacedByTokenHash: 'some_other_hash',
    });
    await userInDb.save();

    // Now attempt to rotate an expired/stale token representation
    // We sign a valid JWT for this user with that payload structure
    const jwt = (await import('jsonwebtoken')).default;
    const secret = process.env.JWT_REFRESH_SECRET || 'nexa_dev_refresh_secret_super_secure_key_67890';
    const staleJwt = jwt.sign({ userId: userInDb._id.toString() }, secret, { expiresIn: '7d' });
    const staleIncomingHash = hashToken(staleJwt);

    // Save this stale token directly as rotated 65s ago
    await User.updateOne(
      { email: testEmail },
      {
        $push: {
          refreshTokens: {
            tokenHash: staleIncomingHash,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            createdAt: new Date(Date.now() - 120000),
            rotatedAt: new Date(Date.now() - 65000),
            replacedByTokenHash: 'some_active_hash',
          },
        },
      }
    );

    const replayRes = await fetch(`${baseUrl}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: `nexa_refresh_token=${staleJwt}`,
      },
    });

    assert.equal(replayRes.status, 401, 'Replay attack after grace window MUST return 401 Unauthorized');
    const replayData = await replayRes.json();
    assert.ok(replayData.error.includes('Session invalidated for security'));

    // Verify all tokens were wiped in database
    const wipedUser = await User.findOne({ email: testEmail });
    assert.equal(wipedUser.refreshTokens.length, 0, 'All tokens must be purged upon detected reuse');
    console.log('✓ Token reuse outside grace window correctly triggered session invalidation and wiped DB tokens.\n');

    // ----------------------------------------------------
    // STEP 6: Normal Logout Invalidation
    // ----------------------------------------------------
    console.log('[STEP 6] Testing clean logout invalidation...');
    const logoutRes = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookieHeaderTokenB,
      },
    });

    assert.equal(logoutRes.status, 200, 'Logout must return 200 OK');
    const logoutCookie = logoutRes.headers.get('set-cookie');
    assert.ok(logoutCookie.includes('Expires=Thu, 01 Jan 1970'), 'Logout must expire cookie');
    console.log('✓ Logout successfully cleared cookie.\n');

    console.log('================================================================');
    console.log('🎉 ALL SESSION PERSISTENCE & CONCURRENCY TESTS PASSED (6/6)');
    console.log('================================================================\n');
  } finally {
    // Cleanup
    await User.deleteMany({ email: testEmail });
    await new Promise((resolve) => server.close(resolve));
    await mongoose.disconnect();
  }
}

runSessionPersistenceVerification().catch((err) => {
  console.error('❌ Verification failed with error:', err);
  process.exit(1);
});
