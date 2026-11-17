import React from 'react';

export default function StatusBadge({ status, label, size = 'sm' }) {
  const getStyles = () => {
    switch (status) {
      case 'online':
      case 'ready':
      case 'success':
        return {
          bg: 'bg-emerald-500/10',
          border: 'border-emerald-500/25',
          text: 'text-emerald-400',
          dot: 'bg-emerald-400',
          pulse: true,
        };
      case 'warning':
      case 'pending':
      case 'disconnected':
      case 'not-connected':
        return {
          bg: 'bg-amber-500/10',
          border: 'border-amber-500/25',
          text: 'text-amber-400',
          dot: 'bg-amber-400',
          pulse: false,
        };
      case 'idle':
      case 'standby':
        return {
          bg: 'bg-blue-500/10',
          border: 'border-blue-500/25',
          text: 'text-blue-400',
          dot: 'bg-blue-400',
          pulse: false,
        };
      case 'error':
        return {
          bg: 'bg-rose-500/10',
          border: 'border-rose-500/25',
          text: 'text-rose-400',
          dot: 'bg-rose-400',
          pulse: true,
        };
      default:
        return {
          bg: 'bg-slate-500/10',
          border: 'border-slate-500/25',
          text: 'text-slate-400',
          dot: 'bg-slate-400',
          pulse: false,
        };
    }
  };

  const config = getStyles();
  const sizeClasses = size === 'xs' ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1';

  return (
    <span
      className={`inline-flex items-center space-x-1.5 font-medium rounded-full border ${config.bg} ${config.border} ${config.text} ${sizeClasses}`}
    >
      <span className="relative flex h-2 w-2">
        {config.pulse && (
          <span
            className={`animate-ping absolute inline-flex h-full w-full rounded-full ${config.dot} opacity-75`}
          />
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${config.dot}`} />
      </span>
      <span>{label}</span>
    </span>
  );
}

