/**
 * NEXA 2.0 Desktop Agent - Renderer Application Logic
 * Phase 6 — Milestone 3.1
 *
 * Communicates strictly via window.nexaDesktop contextBridge API.
 * Node integration is disabled and raw IPC is never accessed.
 */

(function () {
  'use strict';

  // Verify secure bridge presence
  if (!window.nexaDesktop) {
    console.error('[NEXA Renderer] FATAL: Secure bridge window.nexaDesktop not found!');
    return;
  }

  const {
    ping,
    getAppInfo,
    getSystemStatus,
    minimize,
    maximize,
    close,
    isMaximized,
    quitApp,
    onTrayEvent,
    onWindowStateChange,
  } = window.nexaDesktop;

  // DOM Elements
  const btnMinimize = document.getElementById('btn-minimize');
  const btnMaximize = document.getElementById('btn-maximize');
  const btnClose = document.getElementById('btn-close');
  const btnSendPing = document.getElementById('btn-send-ping');
  const pingInput = document.getElementById('ipc-ping-input');
  const consoleOutput = document.getElementById('ipc-output-console');
  const btnRefreshTelemetry = document.getElementById('btn-refresh-telemetry');
  const btnMinimizeTray = document.getElementById('btn-minimize-tray');
  const btnQuitApp = document.getElementById('btn-quit-app');

  // Telemetry elements
  const valPlatform = document.getElementById('val-platform');
  const valArch = document.getElementById('val-arch');
  const valElectron = document.getElementById('val-electron');
  const valNode = document.getElementById('val-node');
  const valUptime = document.getElementById('val-uptime');
  const valTray = document.getElementById('val-tray');

  /**
   * Appends an entry into the IPC console output.
   * @param {string} text
   * @param {'info'|'success'|'error'} type
   */
  function logConsole(text, type = 'info') {
    if (!consoleOutput) return;
    const line = document.createElement('div');
    line.className = `console-line ${type}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${text}`;
    consoleOutput.appendChild(line);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
  }

  /**
   * Fetches and displays runtime telemetry via secure IPC.
   */
  async function loadTelemetry() {
    try {
      const [appInfo, sysStatus] = await Promise.all([
        getAppInfo(),
        getSystemStatus(),
      ]);

      if (valPlatform) valPlatform.textContent = appInfo.platform || 'windows';
      if (valArch) valArch.textContent = appInfo.arch || 'x64';
      if (valElectron) valElectron.textContent = `v${appInfo.electronVersion || 'N/A'}`;
      if (valNode) valNode.textContent = `v${appInfo.nodeVersion || 'N/A'}`;
      if (valTray) valTray.textContent = sysStatus.tray?.active ? 'Active (Integrated)' : 'Inactive';
      if (valUptime) valUptime.textContent = `${sysStatus.uptimeSeconds || 0}s`;

      logConsole('Telemetry updated via secure IPC invoke.', 'info');
    } catch (err) {
      logConsole(`Failed to load telemetry: ${err.message}`, 'error');
    }
  }

  /**
   * Dispatches a validated ping message through the secure IPC bridge.
   */
  async function handleSendPing() {
    const rawText = (pingInput?.value || '').trim();
    const payload = rawText || 'ping';

    const startTime = performance.now();
    try {
      logConsole(`> Invoking nexa:ping with "${payload}"...`, 'info');
      const response = await ping(payload);
      const latency = (performance.now() - startTime).toFixed(1);

      if (response && response.pong) {
        logConsole(`< Pong received in ${latency}ms: "${response.received}" (ts: ${response.timestamp})`, 'success');
      } else {
        logConsole(`< Ping rejected or failed: ${response?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      logConsole(`< IPC invocation failed: ${err.message}`, 'error');
    }
  }

  // Window titlebar controls
  if (btnMinimize) {
    btnMinimize.addEventListener('click', () => {
      minimize();
    });
  }

  if (btnMaximize) {
    btnMaximize.addEventListener('click', async () => {
      await maximize();
    });
  }

  if (btnClose) {
    btnClose.addEventListener('click', () => {
      logConsole('Close requested -> Minimizing to System Tray...', 'info');
      close();
    });
  }

  // Quick action buttons
  if (btnMinimizeTray) {
    btnMinimizeTray.addEventListener('click', () => {
      logConsole('Minimizing to system tray...', 'info');
      close();
    });
  }

  if (btnQuitApp) {
    btnQuitApp.addEventListener('click', () => {
      logConsole('Initiating graceful application shutdown...', 'info');
      quitApp();
    });
  }

  if (btnSendPing) {
    btnSendPing.addEventListener('click', handleSendPing);
  }

  if (pingInput) {
    pingInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handleSendPing();
      }
    });
  }

  if (btnRefreshTelemetry) {
    btnRefreshTelemetry.addEventListener('click', loadTelemetry);
  }

  // Event subscriptions from main process
  if (typeof onTrayEvent === 'function') {
    onTrayEvent((event) => {
      logConsole(`Tray Event: ${event?.action || 'unknown action'}`, 'info');
    });
  }

  if (typeof onWindowStateChange === 'function') {
    onWindowStateChange((state) => {
      const maxIcon = document.getElementById('icon-maximize');
      if (maxIcon && state) {
        // Toggle icon visual
        if (state.isMaximized) {
          maxIcon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M4 10V4h6"/>';
        } else {
          maxIcon.innerHTML = '<rect x="3" y="3" width="18" height="18" rx="2"/>';
        }
      }
    });
  }

  // Initial telemetry load
  loadTelemetry();

  // Periodic uptime refresh every 5 seconds
  setInterval(async () => {
    try {
      const sysStatus = await getSystemStatus();
      if (valUptime && sysStatus) {
        valUptime.textContent = `${sysStatus.uptimeSeconds || 0}s`;
      }
    } catch (_) {
      // Ignore background interval errors
    }
  }, 5000);
})();
