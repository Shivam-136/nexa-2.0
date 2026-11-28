/**
 * Centralized Device Status Mapping & Formatting Utilities (M3.4.7)
 * Pure functions operating strictly on real backend / sanitized Electron IPC metadata.
 */

export const DEVICE_STATUS_MAP = Object.freeze({
  ONLINE: {
    state: 'ONLINE',
    label: 'Online',
    badgeStatus: 'online',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/25',
    iconColor: 'text-emerald-400',
    description: 'Authenticated and sending active heartbeats.',
  },
  OFFLINE: {
    state: 'OFFLINE',
    label: 'Offline',
    badgeStatus: 'disconnected',
    badgeClass: 'bg-slate-800 text-slate-400 border-slate-700',
    iconColor: 'text-slate-400',
    description: 'No recent heartbeat received from this device.',
  },
  CONNECTING: {
    state: 'CONNECTING',
    label: 'Connecting',
    badgeStatus: 'pending',
    badgeClass: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/25',
    iconColor: 'text-cyan-400',
    description: 'Establishing authenticated connection to backend.',
  },
  RECONNECTING: {
    state: 'RECONNECTING',
    label: 'Reconnecting',
    badgeStatus: 'warning',
    badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/25',
    iconColor: 'text-amber-400',
    description: 'Retrying connection with exponential backoff.',
  },
  AUTHENTICATION_REQUIRED: {
    state: 'AUTHENTICATION_REQUIRED',
    label: 'Auth Required',
    badgeStatus: 'warning',
    badgeClass: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
    iconColor: 'text-amber-400',
    description: 'Device session requires re-authentication.',
  },
  REVOKED: {
    state: 'REVOKED',
    label: 'Revoked',
    badgeStatus: 'error',
    badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
    iconColor: 'text-rose-400',
    description: 'Device credentials have been revoked.',
  },
  QUARANTINED: {
    state: 'QUARANTINED',
    label: 'Quarantined',
    badgeStatus: 'error',
    badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/25',
    iconColor: 'text-rose-400',
    description: 'Device is quarantined and blocked until recovery.',
  },
  UNPAIRED: {
    state: 'UNPAIRED',
    label: 'Unpaired',
    badgeStatus: 'default',
    badgeClass: 'bg-slate-800/80 text-slate-400 border-slate-700',
    iconColor: 'text-slate-500',
    description: 'Device was unpaired from this account.',
  },
});

const FALLBACK_STATUS = Object.freeze({
  state: 'OFFLINE',
  label: 'Unknown',
  badgeStatus: 'default',
  badgeClass: 'bg-slate-800 text-slate-400 border-slate-700',
  iconColor: 'text-slate-400',
  description: 'Device status unavailable.',
});

/**
 * Resolves a device's normalized status metadata from backend data (and optional
 * verified local Electron Main Process status for the matching current device).
 */
export function resolveDeviceStatus(device, localDesktopHeartbeat = null) {
  if (!device || typeof device !== 'object') {
    return FALLBACK_STATUS;
  }

  let rawState = device.connectionState;
  if (!rawState) {
    if (device.unpairedAt) rawState = 'UNPAIRED';
    else if (device.isRevoked) rawState = 'REVOKED';
    else if (device.isQuarantined) rawState = 'QUARANTINED';
    else if (device.isOnline) rawState = 'ONLINE';
    else rawState = 'OFFLINE';
  }

  // Only overlay live Electron Main Process transient state when deviceId matches
  if (
    localDesktopHeartbeat &&
    localDesktopHeartbeat.deviceId &&
    localDesktopHeartbeat.deviceId === device.deviceId &&
    localDesktopHeartbeat.state &&
    DEVICE_STATUS_MAP[localDesktopHeartbeat.state] &&
    rawState !== 'REVOKED' &&
    rawState !== 'QUARANTINED' &&
    rawState !== 'UNPAIRED'
  ) {
    rawState = localDesktopHeartbeat.state;
  }

  return DEVICE_STATUS_MAP[rawState] || FALLBACK_STATUS;
}

/**
 * Redacts middle characters of a deviceId for compact card display.
 */
export function maskDeviceId(deviceId) {
  if (typeof deviceId !== 'string' || !deviceId.trim()) {
    return 'Unavailable';
  }
  const trimmed = deviceId.trim();
  if (trimmed.length <= 16) {
    return trimmed;
  }
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}`;
}

/**
 * Formats platform/architecture metadata without fabricating missing values.
 */
export function formatPlatformLabel(platform, arch = null) {
  if (!platform) return 'Unavailable';
  const map = {
    win32: 'Windows',
    darwin: 'macOS',
    linux: 'Linux',
  };
  const osName = map[platform] || platform;
  return arch ? `${osName} (${arch})` : osName;
}

/**
 * Formats an ISO timestamp safely.
 */
export function formatTimestamp(isoValue, emptyLabel = 'Never') {
  if (!isoValue) return emptyLabel;
  const ts = Date.parse(isoValue);
  if (Number.isNaN(ts)) return emptyLabel;
  return new Date(ts).toLocaleString();
}

/**
 * Computes real overview counts from backend device arrays.
 */
export function computeDeviceOverview(connectedDevices = [], revokedDevices = []) {
  const paired = Array.isArray(connectedDevices) ? connectedDevices : [];
  const revoked = Array.isArray(revokedDevices) ? revokedDevices : [];
  const onlineCount = paired.filter((d) => Boolean(d?.isOnline)).length;
  const offlineCount = paired.length - onlineCount;

  return {
    totalPaired: paired.length,
    online: onlineCount,
    offline: offlineCount,
    revokedOrUnpaired: revoked.length,
  };
}
