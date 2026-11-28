import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Monitor,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Lock,
  Link2,
  Copy,
  Clock,
  Laptop,
  X,
  Info,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import StatusBadge from '../components/common/StatusBadge';
import {
  initiatePairing,
  getPairingStatus,
  cancelPairing,
  unpairDevice,
} from '../services/pairing.service';
import {
  resolveDeviceStatus,
  maskDeviceId,
  formatPlatformLabel,
  formatTimestamp,
  computeDeviceOverview,
} from '../utils/deviceStatus';

export default function DesktopControlPage() {
  const { addToast } = useAppContext();
  const { user } = useAuth();

  const [pairingSession, setPairingSession] = useState(null);
  const [connectedDevices, setConnectedDevices] = useState([]);
  const [revokedDevices, setRevokedDevices] = useState([]);
  const [pairingStatus, setPairingStatus] = useState('idle');
  const [pairingError, setPairingError] = useState(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isInitiating, setIsInitiating] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [confirmUnpairTarget, setConfirmUnpairTarget] = useState(null);
  const [unpairingDeviceId, setUnpairingDeviceId] = useState(null);
  const [selectedDeviceDetails, setSelectedDeviceDetails] = useState(null);
  const [localDesktopHeartbeat, setLocalDesktopHeartbeat] = useState(null);
  const [currentDesktopDeviceId, setCurrentDesktopDeviceId] = useState(null);

  const refreshInFlightRef = useRef(false);

  const loadPairingStatus = useCallback(async (sessionId = null, { isManual = false } = {}) => {
    if (isManual && refreshInFlightRef.current) {
      return;
    }
    if (isManual) {
      refreshInFlightRef.current = true;
      setIsRefreshing(true);
    }

    try {
      const data = await getPairingStatus(sessionId);
      setConnectedDevices(Array.isArray(data.connectedDevices) ? data.connectedDevices : []);
      setRevokedDevices(Array.isArray(data.revokedDevices) ? data.revokedDevices : []);
      if (data.activeSession) {
        setPairingSession((prev) => ({
          ...data.activeSession,
          pairingCode:
            data.activeSession.pairingCode ||
            (data.activeSession.status === 'pending' && prev?.sessionId === data.activeSession.sessionId
              ? prev.pairingCode
              : null),
        }));
        setPairingStatus(data.activeSession.status || 'idle');
      } else if (!sessionId) {
        setPairingSession(null);
        setPairingStatus(
          Array.isArray(data.connectedDevices) && data.connectedDevices.length > 0
            ? 'paired'
            : 'idle'
        );
      }
      setPairingError(null);
    } catch (err) {
      const msg = err.message || 'Failed to load device status';
      setPairingError(msg);
      if (isManual) {
        addToast('Refresh Failed', msg, 'error');
      }
    } finally {
      setIsInitialLoading(false);
      if (isManual) {
        refreshInFlightRef.current = false;
        setIsRefreshing(false);
      }
    }
  }, [addToast]);

  const handleRefreshDevices = () => {
    loadPairingStatus(null, { isManual: true });
  };

  // Detect current Desktop Agent identity securely when running inside Electron
  useEffect(() => {
    const bridge = typeof window !== 'undefined' ? window.nexaDesktop : null;
    if (!bridge) return undefined;

    let active = true;
    const syncLocalDesktop = async () => {
      try {
        if (bridge.storage?.getDeviceInfo) {
          const info = await bridge.storage.getDeviceInfo();
          if (active && info?.isPaired && info?.deviceId) {
            setCurrentDesktopDeviceId(info.deviceId);
          } else if (active) {
            setCurrentDesktopDeviceId(null);
          }
        }
        if (bridge.heartbeat?.getStatus) {
          const hb = await bridge.heartbeat.getStatus();
          if (active && hb) {
            setLocalDesktopHeartbeat(hb);
          }
        }
      } catch {
        // Ignore bridge read failures when running outside Electron
      }
    };

    syncLocalDesktop();
    const unsubHb = bridge.heartbeat?.onStatusChange
      ? bridge.heartbeat.onStatusChange((hb) => {
          if (active && hb) setLocalDesktopHeartbeat(hb);
        })
      : null;

    return () => {
      active = false;
      if (typeof unsubHb === 'function') unsubHb();
    };
  }, []);

  useEffect(() => {
    loadPairingStatus();
    const heartbeatPoller = setInterval(() => {
      loadPairingStatus();
    }, 10000);
    return () => clearInterval(heartbeatPoller);
  }, [loadPairingStatus]);

  // Countdown timer for active pending pairing session
  useEffect(() => {
    if (!pairingSession?.expiresAt || pairingStatus !== 'pending') {
      setRemainingSeconds(0);
      return undefined;
    }

    const updateRemaining = () => {
      const diff = Math.max(0, Math.floor((Date.parse(pairingSession.expiresAt) - Date.now()) / 1000));
      setRemainingSeconds(diff);
      if (diff === 0) {
        setPairingStatus('expired');
      }
    };

    updateRemaining();
    const timer = setInterval(updateRemaining, 1000);
    return () => clearInterval(timer);
  }, [pairingSession?.expiresAt, pairingStatus]);

  // Poll backend while pairing session is pending
  useEffect(() => {
    if (pairingStatus !== 'pending' || !pairingSession?.sessionId) {
      return undefined;
    }
    const poller = setInterval(() => {
      loadPairingStatus(pairingSession.sessionId);
    }, 3000);
    return () => clearInterval(poller);
  }, [pairingStatus, pairingSession?.sessionId, loadPairingStatus]);

  const handleInitiatePairing = async () => {
    setIsInitiating(true);
    setPairingError(null);
    try {
      const res = await initiatePairing();
      setPairingSession(res);
      setPairingStatus(res.status || 'pending');
      addToast('Pairing Code Generated', 'Enter this code in your NEXA Desktop Agent to pair.', 'success');
    } catch (err) {
      setPairingError(err.message || 'Unable to initiate device pairing');
      setPairingStatus('error');
      addToast('Pairing Error', err.message || 'Unable to initiate device pairing', 'error');
    } finally {
      setIsInitiating(false);
    }
  };

  const handleCancelPairing = async () => {
    setIsCancelling(true);
    try {
      await cancelPairing(pairingSession?.sessionId || null);
      setPairingSession(null);
      setPairingStatus(connectedDevices.length > 0 ? 'paired' : 'cancelled');
      setRemainingSeconds(0);
      addToast('Pairing Cancelled', 'The pending pairing code has been invalidated.', 'info');
    } catch (err) {
      setPairingError(err.message || 'Failed to cancel pairing');
    } finally {
      setIsCancelling(false);
    }
  };

  const handleConfirmUnpair = async () => {
    if (!confirmUnpairTarget?.deviceId) return;
    const targetId = confirmUnpairTarget.deviceId;
    const targetName = confirmUnpairTarget.deviceName || targetId;

    setUnpairingDeviceId(targetId);
    setPairingError(null);
    try {
      const res = await unpairDevice(targetId);
      setConfirmUnpairTarget(null);
      await loadPairingStatus();
      addToast(
        res?.alreadyUnpaired ? 'Device Already Unpaired' : 'Device Unpaired',
        `${targetName} has been securely disconnected and its credentials revoked.`,
        'success'
      );
    } catch (err) {
      const msg = err.message || 'Failed to unpair device';
      setPairingError(msg);
      addToast('Unpair Failed', msg, 'error');
    } finally {
      setUnpairingDeviceId(null);
    }
  };

  const handleCopyCode = async () => {
    if (!pairingSession?.pairingCode) return;
    try {
      await navigator.clipboard.writeText(pairingSession.pairingCode);
      addToast('Copied', 'Pairing code copied to clipboard.', 'success');
    } catch {
      addToast('Copy Failed', 'Please copy the pairing code manually.', 'error');
    }
  };

  const formatCountdown = (secs) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const handleTestBridge = () => {
    addToast(
      'Bridge Handshake Test',
      'Searching for local desktop operator daemon on ws://localhost:9001/desktop. Ready for Phase 3 binary.',
      'info'
    );
  };

  const permissions = [
    {
      name: 'Screen Capture & OCR Pipeline',
      description: 'Permits NEXA 2.0 to visually perceive display elements and window contexts.',
      required: true,
      granted: false,
    },
    {
      name: 'Accessibility / Keystroke & Mouse Simulation',
      description: 'Enables autonomous input dispatching to native operating system windows.',
      required: true,
      granted: false,
    },
    {
      name: 'Local File System Access (Sandboxed)',
      description: 'Permits indexing, creating, and modifying project files directly on disk.',
      required: true,
      granted: true,
    },
    {
      name: 'Low-Latency Local IPC Socket Bridge',
      description: 'Bidirectional WebSocket channel between web UI and native desktop daemon.',
      required: true,
      granted: false,
    },
  ];

  const overview = computeDeviceOverview(connectedDevices, revokedDevices);

  return (
    <div className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header Banner */}
      <div className="p-6 rounded-3xl glass-panel flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-blue-500/10 text-cyan-400 border border-blue-500/20">
            <Monitor className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">Desktop Control &amp; Screen Stream</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Native workstation automation interface &bull; OS input injection &bull; Real-time display stream
            </p>
          </div>
        </div>

        <button
          onClick={handleTestBridge}
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all self-start sm:self-auto"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Probe Desktop Daemon</span>
        </button>
      </div>

      {/* Device Pairing Section (M3.4.1) */}
      <div className="p-6 rounded-3xl glass-card space-y-5 border border-slate-800">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800/80 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Link2 className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Device Pairing</h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Bind your NEXA 2.0 Desktop Agent securely to your account
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <span
              className={`text-[11px] font-mono uppercase px-2.5 py-1 rounded-lg border ${
                pairingStatus === 'completed' || pairingStatus === 'paired'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : pairingStatus === 'pending'
                  ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                  : pairingStatus === 'expired' || pairingStatus === 'error'
                  ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                  : 'bg-slate-800/70 text-slate-300 border-slate-700'
              }`}
            >
              Status: {pairingStatus}
            </span>

            {pairingStatus === 'pending' ? (
              <button
                onClick={handleCancelPairing}
                disabled={isCancelling}
                className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-xs font-semibold transition-all disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
                <span>{isCancelling ? 'Cancelling...' : 'Cancel Pairing'}</span>
              </button>
            ) : (
              <button
                onClick={handleInitiatePairing}
                disabled={isInitiating}
                className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold shadow-lg shadow-cyan-600/20 transition-all disabled:opacity-50"
              >
                <Link2 className="h-3.5 w-3.5" />
                <span>{isInitiating ? 'Generating...' : 'Pair Device'}</span>
              </button>
            )}
          </div>
        </div>

        {pairingError && (
          <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">
            {pairingError}
          </div>
        )}

        {pairingStatus === 'pending' && pairingSession?.pairingCode && (
          <div className="p-5 rounded-2xl bg-slate-950/70 border border-cyan-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-slate-400">
                One-Time Pairing Code
              </p>
              <div className="flex items-center space-x-3 mt-1.5">
                <span className="text-2xl sm:text-3xl font-mono font-bold tracking-widest text-cyan-300">
                  {pairingSession.pairingCode}
                </span>
                <button
                  onClick={handleCopyCode}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  title="Copy pairing code"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-slate-400 mt-1.5">
                Enter this code in the NEXA 2.0 Desktop Agent &rarr; Device Pairing panel.
              </p>
            </div>

            <div className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-slate-900 border border-slate-800 self-start sm:self-center">
              <Clock className="h-4 w-4 text-amber-400" />
              <div className="text-right">
                <p className="text-[10px] font-mono uppercase text-slate-500">Expires In</p>
                <p className="text-sm font-mono font-bold text-amber-300">
                  {formatCountdown(remainingSeconds)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Device Overview & Connected Devices Management (M3.4.7) */}
        <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-xs font-mono uppercase tracking-wider text-slate-400">
                Device Management Overview
              </span>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Account: {user?.email || user?.displayName || 'Authenticated Account'}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefreshDevices}
              disabled={isRefreshing}
              className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all disabled:opacity-50 self-start sm:self-auto"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              <span>{isRefreshing ? 'Refreshing...' : 'Refresh'}</span>
            </button>
          </div>

          {/* Overview Metrics Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
              <p className="text-[10px] font-mono uppercase text-slate-500">Paired Devices</p>
              <p className="text-lg font-bold text-white mt-0.5">{overview.totalPaired}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
              <p className="text-[10px] font-mono uppercase text-slate-500">Online</p>
              <p className="text-lg font-bold text-emerald-400 mt-0.5">{overview.online}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
              <p className="text-[10px] font-mono uppercase text-slate-500">Offline</p>
              <p className="text-lg font-bold text-slate-300 mt-0.5">{overview.offline}</p>
            </div>
            <div className="p-3 rounded-xl bg-slate-900/70 border border-slate-800">
              <p className="text-[10px] font-mono uppercase text-slate-500">Revoked / Unpaired</p>
              <p className="text-lg font-bold text-rose-400 mt-0.5">{overview.revokedOrUnpaired}</p>
            </div>
          </div>

          {isInitialLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3" aria-label="Loading devices">
              <div className="h-28 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
              <div className="h-28 rounded-xl bg-slate-900/60 border border-slate-800 animate-pulse" />
            </div>
          ) : connectedDevices.length === 0 ? (
            <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/80 text-center">
              <p className="text-xs text-slate-400">
                No desktop devices paired to this account yet. Click <strong>Pair Device</strong> above to link a workstation.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {connectedDevices.map((dev) => {
                const statusInfo = resolveDeviceStatus(dev, localDesktopHeartbeat);
                const isCurrentDevice = Boolean(currentDesktopDeviceId && currentDesktopDeviceId === dev.deviceId);
                const isQuarantined = statusInfo.state === 'QUARANTINED';

                return (
                  <div
                    key={dev.deviceId}
                    className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 flex flex-col gap-2.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-3 min-w-0">
                        <Laptop className={`h-4 w-4 shrink-0 ${statusInfo.iconColor}`} />
                        <div className="min-w-0">
                          <div className="flex items-center space-x-2">
                            <p className="text-xs font-semibold text-white truncate">{dev.deviceName}</p>
                            {isCurrentDevice && (
                              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shrink-0">
                                This Device
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] font-mono text-slate-400 truncate" title={dev.deviceId}>
                            {maskDeviceId(dev.deviceId)}
                          </p>
                        </div>
                      </div>
                      <StatusBadge status={statusInfo.badgeStatus} label={statusInfo.label} size="xs" />
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] font-mono text-slate-400 border-t border-slate-800/80 pt-2">
                      <span>OS: <strong className="text-slate-300">{formatPlatformLabel(dev.platform, dev.arch)}</strong></span>
                      <span className="text-right">State: <strong className="text-slate-200">{statusInfo.state}</strong></span>
                      <span>Last seen: {formatTimestamp(dev.lastSeenAt)}</span>
                      <span className="text-right">Heartbeat: {formatTimestamp(dev.lastHeartbeatAt)}</span>
                    </div>

                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] font-mono text-slate-500">
                        Paired: {formatTimestamp(dev.pairedAt, 'Unavailable')} &bull; Gen #{dev.deviceGeneration || 1}
                      </span>
                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          onClick={() => setSelectedDeviceDetails(dev)}
                          className="inline-flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold transition-all"
                        >
                          <Info className="h-3 w-3" />
                          <span>Details</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmUnpairTarget(dev)}
                          disabled={unpairingDeviceId === dev.deviceId}
                          className="px-2.5 py-1 rounded-lg bg-rose-600/15 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 text-[11px] font-semibold transition-all disabled:opacity-50"
                        >
                          {unpairingDeviceId === dev.deviceId ? 'Unpairing...' : 'Unpair'}
                        </button>
                      </div>
                    </div>

                    {isQuarantined && (
                      <p className="text-[11px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2.5 py-1.5">
                        {dev.quarantineReason || 'Device is quarantined and cannot send heartbeats until recovered.'}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Historical Revoked / Unpaired Devices */}
          {revokedDevices.length > 0 && (
            <div className="pt-3 border-t border-slate-800/80 space-y-2">
              <p className="text-[11px] font-mono uppercase tracking-wider text-slate-500">
                Historical Revoked / Unpaired Devices ({revokedDevices.length})
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {revokedDevices.map((rev) => {
                  const revStatus = resolveDeviceStatus(rev);
                  return (
                    <div
                      key={`${rev.deviceId}-${rev.deviceGeneration}`}
                      className="p-3 rounded-xl bg-slate-900/40 border border-slate-800/70 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-slate-300 truncate">{rev.deviceName}</p>
                        <p className="text-[10px] font-mono text-slate-500 truncate">
                          {maskDeviceId(rev.deviceId)} &bull; {rev.unpairedAt ? `Unpaired ${formatTimestamp(rev.unpairedAt)}` : `Last seen ${formatTimestamp(rev.lastSeenAt)}`}
                        </p>
                      </div>
                      <div className="flex items-center space-x-2 shrink-0">
                        <StatusBadge status={revStatus.badgeStatus} label={revStatus.label} size="xs" />
                        <button
                          type="button"
                          onClick={() => setSelectedDeviceDetails(rev)}
                          className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-semibold"
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Device Details Modal (M3.4.7) */}
      {selectedDeviceDetails && (() => {
        const detailStatus = resolveDeviceStatus(selectedDeviceDetails, localDesktopHeartbeat);
        const isCurrent = Boolean(currentDesktopDeviceId && currentDesktopDeviceId === selectedDeviceDetails.deviceId);
        return (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="device-details-title"
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
          >
            <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 p-6 space-y-4 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
                <div>
                  <div className="flex items-center space-x-2">
                    <h4 id="device-details-title" className="text-base font-bold text-white">
                      {selectedDeviceDetails.deviceName}
                    </h4>
                    {isCurrent && (
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                        This Device
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{detailStatus.description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDeviceDetails(null)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                  <p className="text-[10px] font-mono uppercase text-slate-500">Connection Status</p>
                  <div className="mt-1">
                    <StatusBadge status={detailStatus.badgeStatus} label={`${detailStatus.label} (${detailStatus.state})`} size="xs" />
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                  <p className="text-[10px] font-mono uppercase text-slate-500">Device ID</p>
                  <p className="font-mono text-slate-200 mt-1 break-all text-[11px]">{selectedDeviceDetails.deviceId}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                  <p className="text-[10px] font-mono uppercase text-slate-500">Operating System / Platform</p>
                  <p className="text-slate-200 mt-1">{formatPlatformLabel(selectedDeviceDetails.platform, selectedDeviceDetails.arch)}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                  <p className="text-[10px] font-mono uppercase text-slate-500">Agent Version &amp; Generation</p>
                  <p className="text-slate-200 mt-1">
                    {selectedDeviceDetails.agentVersion ? `v${selectedDeviceDetails.agentVersion}` : 'Unavailable'} &bull; Gen #{selectedDeviceDetails.deviceGeneration || 1}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                  <p className="text-[10px] font-mono uppercase text-slate-500">Last Successful Heartbeat</p>
                  <p className="text-slate-200 mt-1">{formatTimestamp(selectedDeviceDetails.lastHeartbeatAt)}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                  <p className="text-[10px] font-mono uppercase text-slate-500">Last Seen</p>
                  <p className="text-slate-200 mt-1">{formatTimestamp(selectedDeviceDetails.lastSeenAt)}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                  <p className="text-[10px] font-mono uppercase text-slate-500">Paired Date</p>
                  <p className="text-slate-200 mt-1">{formatTimestamp(selectedDeviceDetails.pairedAt, 'Unavailable')}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800">
                  <p className="text-[10px] font-mono uppercase text-slate-500">Heartbeat Count</p>
                  <p className="text-slate-200 mt-1">{selectedDeviceDetails.heartbeatCount ?? 0}</p>
                </div>
                {(selectedDeviceDetails.isRevoked || selectedDeviceDetails.unpairedAt) && (
                  <div className="sm:col-span-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
                    <p className="text-[10px] font-mono uppercase text-rose-400">Revocation / Unpair Status</p>
                    <p className="text-rose-200 mt-1">
                      {selectedDeviceDetails.unpairedAt
                        ? `Unpaired on ${formatTimestamp(selectedDeviceDetails.unpairedAt)}`
                        : 'Device access has been revoked'}
                    </p>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedDeviceDetails(null)}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Unpair Confirmation Dialog (M3.4.6) */}
      {confirmUnpairTarget && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="unpair-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 p-6 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h4 id="unpair-dialog-title" className="text-base font-bold text-white">
                  Unpair Desktop Device?
                </h4>
                <p className="text-xs text-slate-400 mt-1">
                  This will permanently revoke active tokens and disconnect this workstation from your account.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConfirmUnpairTarget(null)}
                disabled={Boolean(unpairingDeviceId)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1 text-xs">
              <p className="text-slate-200 font-semibold">{confirmUnpairTarget.deviceName}</p>
              <p className="font-mono text-slate-400 text-[11px]">{confirmUnpairTarget.deviceId}</p>
            </div>

            <div className="flex items-center justify-end space-x-2 pt-2">
              <button
                type="button"
                onClick={() => setConfirmUnpairTarget(null)}
                disabled={Boolean(unpairingDeviceId)}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmUnpair}
                disabled={Boolean(unpairingDeviceId)}
                className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold shadow-lg shadow-rose-600/20 transition-all disabled:opacity-50"
              >
                {unpairingDeviceId ? 'Unpairing...' : 'Confirm Unpair'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Screen Stream Preview & Monitor Mockup */}
      <div className="rounded-3xl glass-card p-6 flex flex-col items-center justify-center min-h-[360px] relative overflow-hidden border border-slate-800">
        {/* Subtle grid pattern background */}
        <div className="absolute inset-0 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px] opacity-40 pointer-events-none" />

        <div className="relative text-center max-w-md p-6 z-10 flex flex-col items-center">
          <div className="p-4 rounded-2xl bg-slate-900/90 border border-slate-800 text-amber-400 mb-4 shadow-xl">
            <ShieldAlert className="h-10 w-10 animate-pulse" />
          </div>
          <h3 className="text-base font-bold text-white mb-1">
            Display Stream Inactive
          </h3>
          <p className="text-xs text-slate-400 leading-relaxed mb-4">
            The native desktop daemon (<code className="text-cyan-400">nexa-desktop</code>) is not connected. In Phase 3, this canvas will render a real-time 60 FPS visual mirror with AI target bounding boxes.
          </p>
          <div className="flex items-center space-x-2">
            <StatusBadge status="not-connected" label="Desktop Agent: Not Connected" />
            <span className="text-xs font-mono text-slate-500">ws://localhost:9001</span>
          </div>
        </div>
      </div>

      {/* Required OS Permissions Grid */}
      <div className="p-6 rounded-3xl glass-card space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center space-x-2">
            <Lock className="h-4 w-4 text-cyan-400" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
              Operating System Security &amp; Permissions Matrix
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-500">PHASE 3 PREREQUISITES</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {permissions.map((perm) => (
            <div
              key={perm.name}
              className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start space-x-3"
            >
              <div className="mt-0.5">
                {perm.granted ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                ) : (
                  <XCircle className="h-4 w-4 text-amber-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-slate-200">{perm.name}</h4>
                  <span
                    className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded ${
                      perm.granted
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'bg-amber-500/10 text-amber-400'
                    }`}
                  >
                    {perm.granted ? 'Configured' : 'Awaiting Daemon'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                  {perm.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

