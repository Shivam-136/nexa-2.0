import React from 'react';
import {
  Monitor,
  ShieldAlert,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Lock,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import StatusBadge from '../components/common/StatusBadge';

export default function DesktopControlPage() {
  const { connectionStatus, addToast } = useAppContext();

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

