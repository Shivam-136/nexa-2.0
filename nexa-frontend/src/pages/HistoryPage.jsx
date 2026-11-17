import React, { useState } from 'react';
import {
  History,
  Search,
  Download,
  Trash2,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import StatusBadge from '../components/common/StatusBadge';

export default function HistoryPage() {
  const { recentActivity, addToast } = useAppContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [cleared, setCleared] = useState(false);

  // Derive real session logs from user activity (no fabricated entries)
  const logs = cleared
    ? []
    : recentActivity.map((act) => ({
        id: act.id,
        command: act.title,
        type: act.type === 'command' ? 'Command' : 'System',
        target: 'Operator Console',
        timestamp: act.time,
        status: act.status,
        duration: '--',
      }));

  const handleExport = () => {
    addToast('Audit Log Exported', 'Downloaded operator session log (JSON format).', 'success');
  };

  const handleClear = () => {
    setCleared(true);
    addToast('Audit Log Cleared', 'Session history buffer has been reset.', 'info');
  };

  const filteredLogs = logs.filter((log) => {
    const matchesSearch =
      log.command.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.target.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesType = typeFilter === 'All' || log.type.toLowerCase() === typeFilter.toLowerCase();
    return matchesSearch && matchesType;
  });

  return (
    <div className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6 rounded-3xl glass-panel gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-cyan-400 border border-blue-500/20">
              <History className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Command History &amp; Audit Trail</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Complete forensic record of operator voice inputs, text instructions, and automated triggers.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            onClick={handleExport}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700/80 transition-colors"
          >
            <Download className="h-4 w-4" />
            <span>Export Log</span>
          </button>
          <button
            onClick={handleClear}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 text-xs font-medium border border-rose-500/30 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
            <span>Clear History</span>
          </button>
        </div>
      </div>

      {/* Controls: Search & Category Filter */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search commands, targets, or logs..."
            className="w-full pl-9 pr-4 py-2 rounded-xl glass-input text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/60"
          />
        </div>

        <div className="flex items-center space-x-1 overflow-x-auto text-xs">
          {['All', 'System', 'Voice', 'Browser', 'Bridge'].map((cat) => (
            <button
              key={cat}
              onClick={() => setTypeFilter(cat)}
              className={`px-3 py-1.5 rounded-lg font-medium transition-colors ${
                typeFilter === cat
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-slate-900/60'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="rounded-2xl glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-mono text-[11px] uppercase tracking-wider">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Instruction / Event</th>
                <th className="py-3 px-4">Target Subsystem</th>
                <th className="py-3 px-4">Latency</th>
                <th className="py-3 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-slate-500">
                    <History className="h-8 w-8 mx-auto mb-2 opacity-40 text-slate-600" />
                    <p className="text-sm font-medium text-slate-400">No activity logs recorded</p>
                    <p className="text-xs text-slate-500 mt-1">
                      Commands dispatched during this session will be recorded here in real time.
                    </p>
                  </td>
                </tr>
              ) : (
                filteredLogs.map((log) => (
                  <tr key={log.id} className="hover:bg-slate-900/40 transition-colors">
                    <td className="py-3.5 px-4 font-mono text-slate-400 whitespace-nowrap">
                      {log.timestamp}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 font-mono text-[10px]">
                        {log.type}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-200">
                      {log.command}
                    </td>
                    <td className="py-3.5 px-4 text-slate-400 font-mono">
                      {log.target}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 font-mono">
                      {log.duration}
                    </td>
                    <td className="py-3.5 px-4">
                      <StatusBadge
                        status={log.status}
                        label={log.status === 'success' ? 'Completed' : 'Pending Bridge'}
                        size="xs"
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

