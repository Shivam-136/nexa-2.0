import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { unpairDevice } from '../services/pairing.service.js';
import { setAccessToken } from '../services/auth.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('NEXA 2.0 Frontend M3.4.6 — Device Unpair Service & UI Integration', () => {
  it('unpairDevice sends DELETE /v1/device/:deviceId/unpair with Bearer auth', async () => {
    setAccessToken('user_jwt_token_m346');
    const originalFetch = globalThis.fetch;

    try {
      let capturedUrl = null;
      let capturedMethod = null;
      let capturedAuth = null;

      globalThis.fetch = async (url, opts) => {
        capturedUrl = url;
        capturedMethod = opts.method;
        capturedAuth = opts.headers.Authorization;
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({
            success: true,
            unpaired: true,
            deviceId: 'dev-ui-001',
            deviceGeneration: 2,
          }),
        };
      };

      const res = await unpairDevice('dev-ui-001');
      assert.equal(res.unpaired, true);
      assert.equal(capturedMethod, 'DELETE');
      assert.ok(capturedUrl.endsWith('/v1/device/dev-ui-001/unpair'));
      assert.equal(capturedAuth, 'Bearer user_jwt_token_m346');

      await assert.rejects(() => unpairDevice(''), /Device ID is required/);
    } finally {
      globalThis.fetch = originalFetch;
      setAccessToken(null);
    }
  });

  it('unpairDevice surfaces backend error responses cleanly', async () => {
    setAccessToken('user_jwt_token_m346');
    const originalFetch = globalThis.fetch;

    try {
      globalThis.fetch = async () => ({
        ok: false,
        status: 403,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: false,
          error: 'FORBIDDEN: You do not own this device',
        }),
      });

      await assert.rejects(() => unpairDevice('dev-other-user'), /FORBIDDEN/);
    } finally {
      globalThis.fetch = originalFetch;
      setAccessToken(null);
    }
  });

  it('DesktopControlPage implements unpair button, confirmation dialog, loading state, and list refresh', () => {
    const pagePath = path.resolve(__dirname, '../pages/DesktopControlPage.jsx');
    const source = fs.readFileSync(pagePath, 'utf8');

    assert.ok(source.includes('unpairDevice'));
    assert.ok(source.includes('confirmUnpairTarget'));
    assert.ok(source.includes('unpairingDeviceId'));
    assert.ok(source.includes('role="dialog"'));
    assert.ok(source.includes('Confirm Unpair'));
    assert.ok(source.includes('await loadPairingStatus()'));
    assert.ok(source.includes("addToast('Unpair Failed'"));
  });
});
