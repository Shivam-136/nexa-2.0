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

  // Pairing DOM Elements (M3.4.1)
  const pairingCodeInput = document.getElementById('pairing-code-input');
  const pairingDeviceNameInput = document.getElementById('pairing-device-name-input');
  const btnPairDevice = document.getElementById('btn-pair-device');
  const btnCancelPairing = document.getElementById('btn-cancel-pairing');
  const pairingStatusBadge = document.getElementById('pairing-status-badge');
  const valConnectedAccount = document.getElementById('val-connected-account');
  const valPairedDeviceId = document.getElementById('val-paired-device-id');
  const valPairedAt = document.getElementById('val-paired-at');
  const valHeartbeatState = document.getElementById('val-heartbeat-state');
  const valLastHeartbeat = document.getElementById('val-last-heartbeat');
  const valHeartbeatError = document.getElementById('val-heartbeat-error');

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

      const valStorage = document.getElementById('val-storage');
      const valPairing = document.getElementById('val-pairing');

      if (window.nexaDesktop.storage) {
        try {
          const [storageStatus, deviceInfo] = await Promise.all([
            window.nexaDesktop.storage.getStatus(),
            window.nexaDesktop.storage.getDeviceInfo(),
          ]);

          if (valStorage) {
            valStorage.textContent = storageStatus.encryptionAvailable
              ? (storageStatus.hasVault ? 'Encrypted (Vault Active)' : 'Active (DPAPI Ready)')
              : 'Unavailable (Fail-Closed)';
          }
          if (valPairing) {
            valPairing.textContent = deviceInfo && deviceInfo.isPaired
              ? `Paired (${deviceInfo.deviceName || deviceInfo.deviceId})`
              : 'Unpaired (Ready to Pair)';
          }
        } catch (_) {
          if (valStorage) valStorage.textContent = 'Active (Protected)';
          if (valPairing) valPairing.textContent = 'Unpaired';
        }
      }

      if (window.nexaDesktop.pairing && typeof window.nexaDesktop.pairing.getStatus === 'function') {
        try {
          const pairingStatus = await window.nexaDesktop.pairing.getStatus();
          renderPairingStatus(pairingStatus);
        } catch (_) {
          // Ignore pairing status load error
        }
      }

      if (window.nexaDesktop.heartbeat && typeof window.nexaDesktop.heartbeat.getStatus === 'function') {
        try {
          const hbStatus = await window.nexaDesktop.heartbeat.getStatus();
          renderHeartbeatStatus(hbStatus);
        } catch (_) {
          // Ignore heartbeat status load error
        }
      }

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

  if (window.nexaDesktop.storage && typeof window.nexaDesktop.storage.onStatusChange === 'function') {
    window.nexaDesktop.storage.onStatusChange((evt) => {
      logConsole(`Storage event: Device ${evt?.isPaired ? 'Paired' : 'Unpaired'}`, 'info');
      loadTelemetry();
    });
  }

  /**
   * Updates the Device Pairing UI from sanitized Main Process status.
   * @param {Object} status
   */
  function renderPairingStatus(status) {
    if (!status) return;
    const state = status.state || (status.isPaired ? 'paired' : 'idle');
    const info = status.deviceInfo || {};

    if (pairingStatusBadge) {
      const labelMap = {
        idle: 'Unpaired',
        claiming: 'Pairing...',
        paired: 'Paired',
        cancelled: 'Cancelled',
        error: 'Error',
      };
      pairingStatusBadge.textContent = labelMap[state] || state;
    }

    if (valConnectedAccount) {
      valConnectedAccount.textContent = info.isPaired && info.userId
        ? `Account ${info.userId} (${info.deviceName || 'Workstation'})`
        : 'Not Paired';
    }
    if (valPairedDeviceId) {
      valPairedDeviceId.textContent = info.isPaired && info.deviceId ? info.deviceId : '—';
    }
    if (valPairedAt) {
      valPairedAt.textContent = info.isPaired && info.pairedAt
        ? new Date(info.pairedAt).toLocaleString()
        : '—';
    }

    if (btnCancelPairing) {
      btnCancelPairing.disabled = state !== 'claiming';
    }
    if (btnPairDevice) {
      btnPairDevice.disabled = state === 'claiming';
    }
  }

  async function handlePairDevice() {
    if (!window.nexaDesktop.pairing) return;
    const code = (pairingCodeInput?.value || '').trim();
    if (!code) {
      logConsole('Please enter a pairing code from your NEXA 2.0 web dashboard.', 'error');
      return;
    }
    const deviceName = (pairingDeviceNameInput?.value || '').trim();

    try {
      logConsole(`Initiating device pairing claim...`, 'info');
      const res = await window.nexaDesktop.pairing.claim({
        pairingCode: code,
        ...(deviceName ? { deviceName } : {}),
      });
      if (res && res.success) {
        logConsole(`Device paired successfully (${res.deviceInfo?.deviceName || res.deviceInfo?.deviceId}).`, 'success');
        if (pairingCodeInput) pairingCodeInput.value = '';
        await loadTelemetry();
      } else {
        logConsole(`Pairing failed: ${res?.error || 'Unknown error'}`, 'error');
      }
    } catch (err) {
      logConsole(`Pairing failed: ${err.message}`, 'error');
    }
  }

  async function handleCancelPairing() {
    if (!window.nexaDesktop.pairing) return;
    try {
      const res = await window.nexaDesktop.pairing.cancel();
      logConsole(`Pairing ${res?.cancelled ? 'cancelled' : 'reset'}.`, 'info');
    } catch (err) {
      logConsole(`Failed to cancel pairing: ${err.message}`, 'error');
    }
  }

  if (btnPairDevice) {
    btnPairDevice.addEventListener('click', handlePairDevice);
  }
  if (btnCancelPairing) {
    btnCancelPairing.addEventListener('click', handleCancelPairing);
  }
  if (pairingCodeInput) {
    pairingCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        handlePairDevice();
      }
    });
  }

  if (window.nexaDesktop.pairing && typeof window.nexaDesktop.pairing.onStatusChange === 'function') {
    window.nexaDesktop.pairing.onStatusChange((status) => {
      renderPairingStatus(status);
    });
  }

  /**
   * Updates Heartbeat connection state UI from sanitized Main Process status.
   * @param {Object} hbStatus
   */
  function renderHeartbeatStatus(hbStatus) {
    if (!hbStatus) return;
    if (valHeartbeatState) {
      valHeartbeatState.textContent = hbStatus.state || 'OFFLINE';
    }
    if (valLastHeartbeat) {
      valLastHeartbeat.textContent = hbStatus.lastSuccessfulHeartbeatAt
        ? new Date(hbStatus.lastSuccessfulHeartbeatAt).toLocaleString()
        : '—';
    }
    if (valHeartbeatError) {
      valHeartbeatError.textContent = hbStatus.lastError || 'None';
    }
  }

  if (window.nexaDesktop.heartbeat && typeof window.nexaDesktop.heartbeat.onStatusChange === 'function') {
    window.nexaDesktop.heartbeat.onStatusChange((hbStatus) => {
      renderHeartbeatStatus(hbStatus);
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
