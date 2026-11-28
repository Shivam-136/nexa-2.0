import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEVICE_STATUS_MAP,
  resolveDeviceStatus,
  maskDeviceId,
  formatPlatformLabel,
  formatTimestamp,
  computeDeviceOverview,
} from '../utils/deviceStatus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('NEXA 2.0 Frontend M3.4.7 — Device Management UI & Status Mapping', () => {
  it('maps all 8 required device states in centralized DEVICE_STATUS_MAP', () => {
    const requiredStates = [
      'ONLINE',
      'OFFLINE',
      'CONNECTING',
      'RECONNECTING',
      'AUTHENTICATION_REQUIRED',
      'REVOKED',
      'QUARANTINED',
      'UNPAIRED',
    ];

    for (const state of requiredStates) {
      assert.ok(DEVICE_STATUS_MAP[state], `Missing status mapping for ${state}`);
      assert.equal(DEVICE_STATUS_MAP[state].state, state);
      assert.ok(DEVICE_STATUS_MAP[state].label);
      assert.ok(DEVICE_STATUS_MAP[state].badgeStatus);
      assert.ok(DEVICE_STATUS_MAP[state].description);
    }
  });

  it('resolves device status from backend data and overlays local Electron state only for matching deviceId', () => {
    const onlineDev = { deviceId: 'dev-1', isOnline: true, connectionState: 'ONLINE' };
    const offlineDev = { deviceId: 'dev-2', isOnline: false, connectionState: 'OFFLINE' };
    const revokedDev = { deviceId: 'dev-3', isRevoked: true, connectionState: 'REVOKED' };
    const unpairedDev = { deviceId: 'dev-4', isRevoked: true, unpairedAt: '2026-11-26T12:00:00.000Z' };

    assert.equal(resolveDeviceStatus(onlineDev).state, 'ONLINE');
    assert.equal(resolveDeviceStatus(offlineDev).state, 'OFFLINE');
    assert.equal(resolveDeviceStatus(revokedDev).state, 'REVOKED');
    assert.equal(resolveDeviceStatus(unpairedDev).state, 'UNPAIRED');

    // Local Electron transient RECONNECTING applies ONLY to matching deviceId
    const localHb = { deviceId: 'dev-1', state: 'RECONNECTING' };
    assert.equal(resolveDeviceStatus(onlineDev, localHb).state, 'RECONNECTING');
    assert.equal(resolveDeviceStatus(offlineDev, localHb).state, 'OFFLINE');

    // Revoked/quarantined backend state cannot be overridden by local transient state
    assert.equal(resolveDeviceStatus(revokedDev, { deviceId: 'dev-3', state: 'ONLINE' }).state, 'REVOKED');
  });

  it('computes real overview counts, masks deviceId, and formats platform/timestamps without fabricating data', () => {
    const connected = [
      { deviceId: 'dev-1', isOnline: true },
      { deviceId: 'dev-2', isOnline: false },
      { deviceId: 'dev-3', isOnline: true },
    ];
    const revoked = [{ deviceId: 'dev-4', isRevoked: true }];

    const overview = computeDeviceOverview(connected, revoked);
    assert.deepEqual(overview, {
      totalPaired: 3,
      online: 2,
      offline: 1,
      revokedOrUnpaired: 1,
    });

    assert.equal(maskDeviceId('dev-m347-workstation-1234567890abcdef'), 'dev-m347...abcdef');
    assert.equal(maskDeviceId(''), 'Unavailable');
    assert.equal(formatPlatformLabel('win32', 'x64'), 'Windows (x64)');
    assert.equal(formatPlatformLabel(null), 'Unavailable');
    assert.equal(formatTimestamp(null), 'Never');
    assert.equal(formatTimestamp('invalid-date', 'Unavailable'), 'Unavailable');
  });

  it('DesktopControlPage integrates overview, refresh deduplication, details modal, and This Device identification without secrets', () => {
    const pagePath = path.resolve(__dirname, '../pages/DesktopControlPage.jsx');
    const source = fs.readFileSync(pagePath, 'utf8');

    assert.ok(source.includes('Device Management Overview'));
    assert.ok(source.includes('handleRefreshDevices'));
    assert.ok(source.includes('refreshInFlightRef'));
    assert.ok(source.includes('selectedDeviceDetails'));
    assert.ok(source.includes('This Device'));
    assert.ok(source.includes('Historical Revoked / Unpaired Devices'));
    assert.equal(source.includes('deviceToken'), false);
    assert.equal(source.includes('accessToken'), false);
    assert.equal(source.includes('refreshToken'), false);
  });
});
