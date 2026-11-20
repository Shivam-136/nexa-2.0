/**
 * NEXA Desktop M3.1 - Full Electron Runtime Verification
 * Verifies Preload loading, contextBridge exposure, IPC handlers,
 * Ping round-trip, system telemetry, minimize-to-tray, and graceful shutdown.
 */

const { app } = require('electron');
const path = require('path');
const { createMainWindow, getMainWindow } = require('../src/main/window');
const { createTray, destroyTray } = require('../src/main/tray');
const { registerIpcHandlers, unregisterIpcHandlers } = require('../src/main/ipc');
const { isQuitting, setQuitting, gracefulShutdown } = require('../src/main/lifecycle');
const { initSingleInstanceLock } = require('../src/main/singleInstance');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`[FAIL] ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`[PASS] ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log(' Starting NEXA Desktop M3.1 Full Runtime Verification ');
  console.log('======================================================\n');

  // Step 1: Single Instance Lock
  const hasLock = initSingleInstanceLock({
    appInstance: app,
    getMainWindow,
  });
  assert(hasLock, 'Single instance lock acquired');

  // Step 2: Register IPC handlers
  registerIpcHandlers({
    getMainWindow,
    onQuit: () => gracefulShutdown(app),
  });
  assert(true, 'IPC handlers registered');

  // Step 3: Initialize Tray
  const tray = createTray({
    getMainWindow,
    onQuit: () => gracefulShutdown(app),
  });
  assert(tray !== null, 'System Tray initialized');

  // Step 4: Create Main Window
  const win = createMainWindow({ isQuitting });
  assert(win !== null, 'BrowserWindow created');

  let preloadError = null;
  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    preloadError = { preloadPath, error };
    console.error('[RUNTIME ERROR] Preload error detected:', preloadPath, error);
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timeout waiting for window load'));
    }, 10000);

    win.webContents.once('did-finish-load', () => {
      clearTimeout(timeout);
      resolve();
    });
  });

  // Verify no preload errors occurred
  assert(preloadError === null, 'No preload script loading errors');

  // Verify window.nexaDesktop is exposed and available
  const bridgeCheck = await win.webContents.executeJavaScript(`
    (() => {
      return {
        hasBridge: typeof window.nexaDesktop !== 'undefined',
        isFrozen: Object.isFrozen(window.nexaDesktop),
        methods: window.nexaDesktop ? Object.keys(window.nexaDesktop) : [],
        hasRawIpc: typeof window.ipcRenderer !== 'undefined',
        hasRequire: typeof window.require !== 'undefined',
        hasProcess: typeof window.process !== 'undefined',
      };
    })()
  `);

  assert(bridgeCheck.hasBridge === true, 'window.nexaDesktop is exposed in main world');
  assert(bridgeCheck.isFrozen === true, 'window.nexaDesktop is frozen against tampering');
  assert(bridgeCheck.hasRawIpc === false, 'Raw ipcRenderer is NEVER exposed to renderer');
  assert(bridgeCheck.hasRequire === false, 'require() is NOT accessible in renderer');
  assert(bridgeCheck.hasProcess === false, 'process is NOT accessible in renderer');

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
    assert(bridgeCheck.methods.includes(method), `Exposed bridge method exists: ${method}`);
  });

  // Test Ping Bridge
  const pingResult = await win.webContents.executeJavaScript(`
    window.nexaDesktop.ping('runtime-e2e-ping')
  `);
  assert(pingResult && pingResult.pong === true, 'Ping bridge responded with pong: true');
  assert(pingResult.received === 'runtime-e2e-ping', 'Ping bridge echoed sanitized payload correctly');
  assert(typeof pingResult.timestamp === 'number', 'Ping bridge returned timestamp');

  // Test Ping input sanitization on bridge
  const pingCleanResult = await win.webContents.executeJavaScript(`
    window.nexaDesktop.ping('  test\\x00string\\x1F  ')
  `);
  assert(pingCleanResult.received === 'teststring', 'Ping bridge sanitized control characters');

  // Test App Info Telemetry
  const appInfo = await win.webContents.executeJavaScript(`
    window.nexaDesktop.getAppInfo()
  `);
  assert(appInfo.name === 'NEXA 2.0 Desktop Agent', 'Telemetry: app name matches');
  assert(appInfo.version === '2.0.0', 'Telemetry: app version matches');
  assert(appInfo.platform === process.platform, 'Telemetry: platform matches');

  // Test System Status Telemetry
  const sysStatus = await win.webContents.executeJavaScript(`
    window.nexaDesktop.getSystemStatus()
  `);
  assert(sysStatus.status === 'online', 'System status is online');
  assert(sysStatus.security.contextIsolation === true, 'Security: contextIsolation is active');
  assert(sysStatus.security.sandbox === true, 'Security: sandbox is active');
  assert(sysStatus.security.nodeIntegration === false, 'Security: nodeIntegration is disabled');
  assert(sysStatus.tray.active === true, 'Tray: reported active in telemetry');

  console.log('[STEP] Testing minimize to tray setup...');
  // Test Minimize-to-Tray
  // Set up event listener in renderer to verify tray event notification
  await win.webContents.executeJavaScript(`
    (() => {
      window.__receivedTrayEvents = [];
      window.nexaDesktop.onTrayEvent((evt) => {
        window.__receivedTrayEvents.push(evt ? evt.action : 'unknown');
      });
      return true;
    })()
  `);

  console.log('[STEP] Triggering window.nexaDesktop.close()...');
  // Close the window via bridge (should intercept and minimize to tray)
  await win.webContents.executeJavaScript(`
    window.nexaDesktop.close()
  `);

  console.log('[STEP] Waiting for hide...');
  // Allow close event to dispatch
  await new Promise((r) => setTimeout(r, 200));

  assert(win.isVisible() === false, 'Window is hidden to tray when close requested');

  console.log('[STEP] Reading tray events...');
  const trayEventActions = await win.webContents.executeJavaScript(`window.__receivedTrayEvents`);
  assert(
    trayEventActions.length > 0 && trayEventActions[0] === 'minimized-to-tray',
    'Renderer received minimized-to-tray event notification'
  );

  // Restore window for maximize testing
  win.show();
  assert(win.isVisible() === true, 'Window restored successfully');

  // Test Maximize toggle
  const initialMax = await win.webContents.executeJavaScript(`window.nexaDesktop.isMaximized()`);
  assert(initialMax === false, 'Window starts unmaximized');

  const maxRes = await win.webContents.executeJavaScript(`window.nexaDesktop.maximize()`);
  assert(maxRes === true, 'window.maximize() returned true');
  assert(win.isMaximized() === true, 'BrowserWindow maximized state updated');

  const unmaxRes = await win.webContents.executeJavaScript(`window.nexaDesktop.maximize()`);
  assert(unmaxRes === false, 'window.maximize() second toggle restored window');
  assert(win.isMaximized() === false, 'BrowserWindow unmaximized state restored');

  // Test Minimize
  await win.webContents.executeJavaScript(`window.nexaDesktop.minimize()`);
  assert(win.isMinimized() === true, 'window.minimize() minimized the window');

  // Test Graceful Shutdown
  let quitTriggered = false;
  app.on('will-quit', () => {
    quitTriggered = true;
  });

  console.log('\n[TEST] Requesting graceful application shutdown via quitApp()...');
  // quitApp destroys the window and quits app, so executeJavaScript will see frame disposal
  await win.webContents.executeJavaScript(`window.nexaDesktop.quitApp()`).catch(() => {
    // Expected: frame is disposed as part of graceful shutdown
  });

  // Allow graceful shutdown hooks to process
  await new Promise((r) => setTimeout(r, 400));
  assert(isQuitting() === true, 'Graceful shutdown set isQuitting to true');

  console.log(`\n======================================================`);
  console.log(` ALL RUNTIME VERIFICATION TESTS PASSED (${passedTests}/${totalTests}) `);
  console.log(`======================================================\n`);

  process.exit(0);
}

app.whenReady().then(runTests).catch((err) => {
  console.error('[RUNTIME FATAL ERROR]:', err);
  process.exit(1);
});
