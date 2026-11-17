import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import app from '../app.js';
import User from '../models/user.model.js';
import Memory from '../models/memory.model.js';
import Conversation from '../models/conversation.model.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function runLiveHttpVerification() {
  console.log('====================================================');
  console.log('🧪 NEXA 2.0 Live HTTP Registration & Authentication Test');
  console.log('====================================================');

  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/nexa';
  console.log(`Connecting to MongoDB at ${mongoUri}...`);
  await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 5000 });
  console.log('✓ Successfully connected to live MongoDB database');

  const testEmail = `operator_live_${Date.now()}@nexa.ai`;
  const testPassword = 'SuperSecurePassword2026!';
  const testDisplayName = 'Live Operator Test';

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`✓ Test HTTP server listening on ${baseUrl}\n`);

  try {
    // ----------------------------------------------------
    // TEST 1: Register New User via HTTP POST
    // ----------------------------------------------------
    console.log('[TEST 1] Testing POST /api/v1/auth/register...');
    const registerResponse = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        displayName: testDisplayName,
      }),
    });

    const registerData = await registerResponse.json();
    console.log(`  - Status Code: ${registerResponse.status} (Expected: 201)`);
    console.log(`  - Success: ${registerData.success}`);
    console.log(`  - User Email: ${registerData.user?.email}`);
    console.log(`  - User ID: ${registerData.user?.id}`);
    console.log(`  - Access Token Received: ${Boolean(registerData.accessToken)}`);

    const setCookie = registerResponse.headers.get('set-cookie');
    console.log(`  - Set-Cookie Header Present: ${Boolean(setCookie)}`);
    if (setCookie) {
      console.log(`  - Cookie contains nexa_refresh_token: ${setCookie.includes('nexa_refresh_token')}`);
      console.log(`  - Cookie has HttpOnly: ${setCookie.includes('HttpOnly')}`);
    }

    if (registerResponse.status !== 201 || !registerData.success || !registerData.accessToken) {
      throw new Error(`Registration failed: ${JSON.stringify(registerData)}`);
    }
    console.log('✅ TEST 1 PASSED: Live HTTP registration succeeded without errors.\n');

    // ----------------------------------------------------
    // TEST 2: Inspect Database State Directly
    // ----------------------------------------------------
    console.log('[TEST 2] Inspecting User record directly in MongoDB...');
    const savedUser = await User.findOne({ email: testEmail });
    if (!savedUser) {
      throw new Error('User was not found in MongoDB!');
    }

    console.log(`  - Email in DB: ${savedUser.email}`);
    console.log(`  - Display Name in DB: ${savedUser.displayName}`);
    console.log(`  - Password Plaintext Leaked: ${savedUser.password === testPassword} (Must be false)`);
    console.log(`  - Password Is Bcrypt Hash: ${savedUser.password.startsWith('$2')} (Must be true)`);
    console.log(`  - Refresh Tokens In DB: ${savedUser.refreshTokens.length}`);
    console.log(`  - Refresh Token Is Hashed (SHA-256): ${savedUser.refreshTokens[0]?.tokenHash?.length === 64}`);

    if (savedUser.password === testPassword || !savedUser.password.startsWith('$2')) {
      throw new Error('Password was not properly hashed with bcrypt!');
    }
    if (savedUser.refreshTokens.length === 0 || savedUser.refreshTokens[0].tokenHash.length !== 64) {
      throw new Error('Refresh token was not properly hashed before database storage!');
    }
    console.log('✅ TEST 2 PASSED: Direct database inspection verified bcrypt password and SHA-256 token hash.\n');

    // ----------------------------------------------------
    // TEST 3: Duplicate Email Rejection
    // ----------------------------------------------------
    console.log('[TEST 3] Testing duplicate email rejection...');
    const dupResponse = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail, // Identical email
        password: testPassword,
        displayName: 'Duplicate Attempter',
      }),
    });

    const dupData = await dupResponse.json();
    console.log(`  - Duplicate Status Code: ${dupResponse.status} (Expected: 409)`);
    console.log(`  - Error Message: "${dupData.error}"`);

    if (dupResponse.status !== 409 || !dupData.error?.includes('already exists')) {
      throw new Error(`Expected 409 duplicate rejection, got: ${dupResponse.status} ${JSON.stringify(dupData)}`);
    }
    console.log('✅ TEST 3 PASSED: Duplicate email registration properly rejected with 409 Conflict.\n');

    // ----------------------------------------------------
    // TEST 4: Login with Created Credentials
    // ----------------------------------------------------
    console.log('[TEST 4] Testing POST /api/v1/auth/login with valid credentials...');
    const loginResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });

    const loginData = await loginResponse.json();
    console.log(`  - Login Status Code: ${loginResponse.status} (Expected: 200)`);
    console.log(`  - Login Success: ${loginData.success}`);
    console.log(`  - Access Token Received: ${Boolean(loginData.accessToken)}`);

    if (loginResponse.status !== 200 || !loginData.accessToken) {
      throw new Error(`Login failed: ${JSON.stringify(loginData)}`);
    }
    console.log('✅ TEST 4 PASSED: User login succeeded with 200 OK.\n');

    // ----------------------------------------------------
    // TEST 5: Login with Wrong Password Rejection
    // ----------------------------------------------------
    console.log('[TEST 5] Testing POST /api/v1/auth/login with wrong password...');
    const wrongPassResponse = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: 'IncorrectPassword999!',
      }),
    });

    const wrongPassData = await wrongPassResponse.json();
    console.log(`  - Status Code: ${wrongPassResponse.status} (Expected: 401)`);
    console.log(`  - Error Message: "${wrongPassData.error}"`);

    if (wrongPassResponse.status !== 401 || wrongPassData.error !== 'Invalid email or password.') {
      throw new Error(`Expected 401 for wrong password, got: ${wrongPassResponse.status}`);
    }
    console.log('✅ TEST 5 PASSED: Invalid password rejected with 401 Unauthorized without account enumeration.\n');

    // ----------------------------------------------------
    // TEST 6: Authenticated Profile Endpoint
    // ----------------------------------------------------
    console.log('[TEST 6] Testing GET /api/v1/auth/me with Bearer token...');
    const meResponse = await fetch(`${baseUrl}/api/v1/auth/me`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${loginData.accessToken}`,
      },
    });

    const meData = await meResponse.json();
    console.log(`  - /me Status Code: ${meResponse.status} (Expected: 200)`);
    console.log(`  - Profile Email: ${meData.user?.email}`);
    console.log(`  - AI Provider: ${meData.user?.aiProvider}`);

    if (meResponse.status !== 200 || meData.user?.email !== testEmail) {
      throw new Error(`Profile endpoint failed: ${JSON.stringify(meData)}`);
    }
    console.log('✅ TEST 6 PASSED: Protected /me endpoint returned authenticated operator profile.\n');

    // ----------------------------------------------------
    // TEST 7: Multi-Tenant Data Isolation over HTTP
    // ----------------------------------------------------
    console.log('[TEST 7] Testing Multi-Tenant Data Isolation over HTTP...');
    // Create User 2
    const testEmail2 = `operator_two_${Date.now()}@nexa.ai`;
    const reg2Res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail2,
        password: testPassword,
        displayName: 'Operator Two',
      }),
    });
    const reg2Data = await reg2Res.json();
    const token2 = reg2Data.accessToken;

    // User 1 creates a private memory
    const createMemRes1 = await fetch(`${baseUrl}/api/v1/memories`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${loginData.accessToken}`,
      },
      body: JSON.stringify({
        value: 'Top secret plan for User 1',
        category: 'personal',
      }),
    });
    const mem1Data = await createMemRes1.json();
    const mem1Id = mem1Data.memory?._id;
    console.log(`  - User 1 created memory ID: ${mem1Id}`);

    // User 2 lists memories - should NOT see User 1's memory
    const listMemRes2 = await fetch(`${baseUrl}/api/v1/memories`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token2}`,
      },
    });
    const list2Data = await listMemRes2.json();
    const user2FoundMem1 = list2Data.memories?.some((m) => m._id === mem1Id);
    console.log(`  - User 2 see User 1's memory in list: ${user2FoundMem1} (Must be false)`);

    // User 2 attempts to delete User 1's memory by ID
    const deleteRes2 = await fetch(`${baseUrl}/api/v1/memories/${mem1Id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token2}`,
      },
    });
    console.log(`  - User 2 delete User 1's memory status: ${deleteRes2.status} (Expected: 404)`);

    if (user2FoundMem1 || deleteRes2.status !== 404) {
      throw new Error('Tenant data leakage detected! User 2 was able to see or delete User 1 memory.');
    }
    console.log('✅ TEST 7 PASSED: Strict cross-user data isolation verified over live HTTP requests.\n');

    // Clean up test users and data
    await User.deleteMany({ email: { $in: [testEmail, testEmail2] } });
    if (mem1Id) {
      await Memory.deleteOne({ _id: mem1Id });
    }
    console.log('✓ Cleaned up test records from database');

    console.log('====================================================');
    console.log('🎉 ALL LIVE HTTP ENDPOINT VERIFICATION TESTS PASSED!');
    console.log('====================================================');
  } finally {
    server.close();
    await mongoose.disconnect();
  }
}

runLiveHttpVerification().catch((err) => {
  console.error('\n❌ LIVE HTTP VERIFICATION FAILED:', err);
  process.exit(1);
});
