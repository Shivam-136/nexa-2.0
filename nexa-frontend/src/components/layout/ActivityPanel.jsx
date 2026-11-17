import React from 'react';
import {
  Monitor,
  Globe,
  ListTodo,
  Clock,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Layers,
  Sparkles,
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import StatusBadge from '../common/StatusBadge';

export default function ActivityPanel() {
  const {
    connectionStatus,
    activeTasks,
    recentActivity,
    refreshBackendStatus,
    addToast,
  } = useAppContext();

  const handleRetryBridge = async () => {
    const health = await refreshBackendStatus();
    addToast(
      'Telemetry Refreshed',
      `Backend: ${health.isOnline ? 'Online' : 'Offline'} • Brain: ${health.model}`,
      health.isOnline ? 'info' : 'warning'
    );
  };

  const isBrainActive = connectionStatus.aiBrain?.includes('Active');

  return (
    <div className="w-full flex flex-col space-y-4">
      {/* 1. Subsystems Connection Status Card */}
      <div className="p-4 rounded-2xl glass-card space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center space-x-2">
            <Cpu className="h-4 w-4 text-blue-400" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
              Subsystem Telemetry
            </h3>
          </div>
          <button
            onClick={handleRetryBridge}
            className="p-1 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors"
            title="Refresh Daemon Status"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Gemini AI Brain Status */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Gemini AI Brain</p>
              <p className="text-[10px] text-slate-500 font-mono">{connectionStatus.aiBrain}</p>
            </div>
          </div>
          <StatusBadge
            status={isBrainActive ? 'ready' : connectionStatus.backend === 'Connected' ? 'warning' : 'not-connected'}
            label={isBrainActive ? 'Active' : connectionStatus.backend === 'Connected' ? 'No Key' : 'Offline'}
            size="xs"
          />
        </div>

        {/* Desktop Daemon Status */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Monitor className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Desktop Operator</p>
              <p className="text-[10px] text-slate-500 font-mono">Port 9001 (IPC Daemon)</p>
            </div>
          </div>
          <StatusBadge status="not-connected" label="Not Connected" size="xs" />
        </div>

        {/* Browser Automation Adapter */}
        <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
              <Globe className="h-4 w-4" />
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-200">Browser Automation</p>
              <p className="text-[10px] text-slate-500 font-mono">CDP WebSocket Bridge</p>
            </div>
          </div>
          <StatusBadge status="standby" label="Standby" size="xs" />
        </div>
      </div>

      {/* 2. Active Tasks Section (Honest Empty State) */}
      <div className="p-4 rounded-2xl glass-card space-y-3">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center space-x-2">
            <ListTodo className="h-4 w-4 text-cyan-400" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
              Active Task Queue
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-500">
            {activeTasks.length} RUNNING
          </span>
        </div>

        {activeTasks.length === 0 ? (
          <div className="py-6 px-3 text-center rounded-xl bg-slate-950/40 border border-dashed border-slate-800/80">
            <Layers className="h-7 w-7 text-slate-600 mx-auto mb-2 opacity-60" />
            <p className="text-xs font-medium text-slate-400">Queue is idle</p>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              No tasks currently executing. Commands dispatched will appear here once daemon connects.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {activeTasks.map((task) => (
              <div
                key={task.id}
                className="p-2.5 rounded-xl bg-slate-950/70 border border-slate-800 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-200">{task.title}</span>
                  <span className="text-[10px] text-blue-400 font-mono">Running</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Recent Activity Section */}
      <div className="p-4 rounded-2xl glass-card space-y-3 flex-1">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center space-x-2">
            <Clock className="h-4 w-4 text-blue-400" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
              Recent Activity
            </h3>
          </div>
          <span className="text-[11px] font-mono text-slate-500">AUDIT LOG</span>
        </div>

        {recentActivity.length === 0 ? (
          <div className="py-6 px-3 text-center rounded-xl bg-slate-950/40 border border-dashed border-slate-800/80">
            <Clock className="h-7 w-7 text-slate-600 mx-auto mb-2 opacity-60" />
            <p className="text-xs font-medium text-slate-400">No activity yet</p>
            <p className="text-[11px] text-slate-500 mt-0.5 leading-relaxed">
              Dispatched commands and operator actions will appear here in real time.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {recentActivity.map((act) => (
              <div
                key={act.id}
                className="p-2.5 rounded-xl bg-slate-950/60 border border-slate-800/80 text-xs flex items-start space-x-2.5"
              >
                <div className="mt-0.5">
                  {act.status === 'success' ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  ) : act.status === 'pending' ? (
                    <AlertCircle className="h-3.5 w-3.5 text-amber-400" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-blue-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-slate-200 truncate">{act.title}</p>
                    <span className="text-[10px] text-slate-500 font-mono ml-1">{act.time}</span>
                  </div>
                  {act.description && (
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug line-clamp-2">
                      {act.description}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 4. Runtime Metrics */}
      <div className="p-3.5 rounded-2xl glass-card grid grid-cols-2 gap-2 text-center text-xs">
        <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono">Memory Heap</p>
          <p className="font-semibold text-slate-400 font-mono mt-0.5">{connectionStatus.memoryUsage || '--'}</p>
        </div>
        <div className="p-2 rounded-xl bg-slate-950/60 border border-slate-800">
          <p className="text-[10px] text-slate-500 uppercase font-mono">Bridge Latency</p>
          <p className="font-semibold text-slate-400 font-mono mt-0.5">{connectionStatus.latency || 'Not Connected'}</p>
        </div>
      </div>
    </div>
  );
}

