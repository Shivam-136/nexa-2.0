/**
 * NEXA 2.0 Desktop Agent - Security Architecture Test Suite
 * Phase 6 — Milestone 3.1
 *
 * Verifies:
 * - contextIsolation is strictly enabled
 * - nodeIntegration is strictly disabled
 * - sandbox is strictly enabled
 * - No raw ipcRenderer leakage
 * - Renderer Content Security Policy (CSP) enforcement
 * - Immutability of exposed bridge APIs
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { SECURITY_CONFIG, WINDOW_CONFIG } = require('../main/config');
const { nexaDesktopAPI } = require('../preload/index');

describe('1. Electron Security Configuration Verification', () => {
  it('must strictly enforce contextIsolation = true', () => {
    assert.equal(
      SECURITY_CONFIG.contextIsolation,
      true,
      'SECURITY CRITICAL: contextIsolation must be true to prevent prototype pollution and renderer breakout.'
    );
  });

  it('must strictly enforce nodeIntegration = false', () => {
    assert.equal(
      SECURITY_CONFIG.nodeIntegration,
      false,
      'SECURITY CRITICAL: nodeIntegration must be false so renderer cannot execute require() or process APIs.'
    );
  });

  it('must strictly enforce sandbox = true', () => {
    assert.equal(
      SECURITY_CONFIG.sandbox,
      true,
      'SECURITY CRITICAL: Chromium sandbox must be true to isolate renderer at the OS level.'
    );
  });

  it('must disable node integration in workers and subframes', () => {
    assert.equal(SECURITY_CONFIG.nodeIntegrationInWorker, false);
    assert.equal(SECURITY_CONFIG.nodeIntegrationInSubFrames, false);
  });

  it('must disallow running insecure content and maintain webSecurity', () => {
    assert.equal(SECURITY_CONFIG.webSecurity, true);
    assert.equal(SECURITY_CONFIG.allowRunningInsecureContent, false);
  });
});

describe('2. Preload & Context Bridge Encapsulation', () => {
  it('must freeze the exposed nexaDesktopAPI to prevent tampering', () => {
    assert.equal(Object.isFrozen(nexaDesktopAPI), true, 'Exposed API object must be frozen.');
  });

  it('must NEVER expose raw ipcRenderer or dangerous internal methods', () => {
    const exposedKeys = Object.keys(nexaDesktopAPI);

    // Raw ipcRenderer properties that must NEVER be exposed
    const forbiddenProps = [
      'ipcRenderer',
      'send',
      'sendSync',
      'sendTo',
      'sendToHost',
      'postMessage',
      'invoke', // raw invoke must not be exposed directly
      'emit',
      'eventNames',
      'listeners',
      'rawListeners',
      'require',
      'process',
      'Buffer',
      'fs',
      'child_process',
    ];

    forbiddenProps.forEach((prop) => {
      assert.equal(
        exposedKeys.includes(prop),
        false,
        `SECURITY VIOLATION: "${prop}" must NEVER be directly exposed on window.nexaDesktop!`
      );
    });
  });

  it('must only expose approved safe helper methods', () => {
    const expectedMethods = [
      'ping',
      'getAppInfo',
      'getSystemStatus',
      'minimize',
      'maximize',
      'close',
      'isMaximized',
      'quitApp',
      'onTrayEvent',
      'onStatusChange',
      'onWindowStateChange',
    ];

    expectedMethods.forEach((method) => {
      assert.equal(
        typeof nexaDesktopAPI[method],
        'function',
        `Expected safe method "${method}" to be exposed on nexaDesktopAPI`
      );
    });

    // Storage namespace verification
    assert.equal(typeof nexaDesktopAPI.storage, 'object', 'storage namespace must be defined');
    assert.equal(Object.isFrozen(nexaDesktopAPI.storage), true, 'storage namespace must be frozen');

    const expectedStorageMethods = [
      'getStatus',
      'getDeviceInfo',
      'onStatusChange',
    ];
    expectedStorageMethods.forEach((method) => {
      assert.equal(
        typeof nexaDesktopAPI.storage[method],
        'function',
        `Expected storage method "${method}" to be exposed on nexaDesktopAPI.storage`
      );
    });

    // Verify saveCredentials and clearCredentials are strictly prohibited
    assert.equal(
      nexaDesktopAPI.storage.saveCredentials,
      undefined,
      'SECURITY CRITICAL: saveCredentials must NEVER be exposed on window.nexaDesktop.storage'
    );
    assert.equal('saveCredentials' in nexaDesktopAPI.storage, false);

    assert.equal(
      nexaDesktopAPI.storage.clearCredentials,
      undefined,
      'SECURITY CRITICAL: clearCredentials must NEVER be exposed on window.nexaDesktop.storage'
    );
    assert.equal('clearCredentials' in nexaDesktopAPI.storage, false);
  });
});

describe('3. Renderer HTML Content Security Policy (CSP)', () => {
  const htmlPath = path.join(__dirname, '..', 'renderer', 'index.html');

  it('must contain a restrictive Content Security Policy meta tag', () => {
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Verify CSP meta tag exists
    assert.match(
      htmlContent,
      /<meta\s+http-equiv=["']Content-Security-Policy["']/i,
      'index.html must define an HTTP Content-Security-Policy meta tag'
    );

    // Verify default-src is 'none'
    assert.match(
      htmlContent,
      /default-src\s+['"]none['"]/i,
      'CSP must restrict default-src to "none"'
    );

    // Verify script-src is restricted to 'self' (no unsafe-inline or unsafe-eval in scripts)
    assert.match(
      htmlContent,
      /script-src\s+['"]self['"]/i,
      'CSP script-src must be strictly "self"'
    );

    assert.doesNotMatch(
      htmlContent,
      /script-src[^;]*'unsafe-eval'/i,
      'CSP must NOT allow unsafe-eval for scripts'
    );
  });

  it('must not load external remote scripts or iframes in renderer HTML', () => {
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    assert.doesNotMatch(
      htmlContent,
      /<script\s+[^>]*src=["']https?:\/\//i,
      'index.html must not load external scripts from the internet'
    );
    assert.doesNotMatch(
      htmlContent,
      /<iframe/i,
      'index.html must not include any iframes'
    );
  });
});
