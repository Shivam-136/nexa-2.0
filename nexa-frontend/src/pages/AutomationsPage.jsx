import React, { useState } from 'react';
import {
  Workflow,
  Plus,
  Play,
  Clock,
  Code2,
  Trash2,
  GitBranch,
  Globe,
  ShieldAlert,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import StatusBadge from '../components/common/StatusBadge';

const PRESET_AUTOMATIONS = [
  {
    id: 'auto-1',
    title: 'Developer Morning Workspace Launch',
    description: 'Sequentially opens VS Code, spawns terminal sessions, and opens local dev ports in browser.',
    trigger: 'Voice: "Start developer workspace"',
    category: 'Development',
    steps: 4,
    status: 'pending',
    icon: Code2,
  },
  {
    id: 'auto-2',
    title: 'System Temp Cache & Memory Flush',
    description: 'Scans temporary OS folders, clears browser cache artifacts, and purges dangling node processes.',
    trigger: 'Scheduled: Daily at 02:00 AM',
    category: 'Maintenance',
    steps: 3,
    status: 'pending',
    icon: Trash2,
  },
  {
    id: 'auto-3',
    title: 'Multi-Repo Git Status & Sync Check',
    description: 'Traverses tracked repositories, checks uncommitted changes, and fetches remote origin heads.',
    trigger: 'Voice: "Sync repositories"',
    category: 'Version Control',
    steps: 5,
    status: 'pending',
    icon: GitBranch,
  },
  {
    id: 'auto-4',
    title: 'Browser Automation Multi-Source Research',
    description: 'Launches headless Chromium to extract headlines and summary reports from designated technical feeds.',
    trigger: 'Voice: "Compile morning tech digest"',
    category: 'Browser',
    steps: 6,
    status: 'pending',
    icon: Globe,
  },
];

export default function AutomationsPage() {
  const { addToast } = useAppContext();
  const [filter, setFilter] = useState('All');

  const handleRunAutomation = (auto) => {
    addToast(
      `Triggered: ${auto.title}`,
      'Desktop Agent is required to execute local OS keystrokes, process launches, and scripts (Phase 3).',
      'warning'
    );
  };

  const handleCreateNew = () => {
    addToast(
      'Recipe Builder',
      'Automation visual workflow editor will be active once desktop operator IPC bridge is established in Phase 3.',
      'info'
    );
  };

  const categories = ['All', 'Development', 'Maintenance', 'Version Control', 'Browser'];

  const filtered = filter === 'All'
    ? PRESET_AUTOMATIONS
    : PRESET_AUTOMATIONS.filter((a) => a.category === filter);

  return (
    <div className="flex-1 w-full max-w-6xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6 rounded-3xl glass-panel gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-cyan-400 border border-blue-500/20">
              <Workflow className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Procedural Automations</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Chained computer operations, recurring system tasks, and voice-triggered macros.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={handleCreateNew}
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold shadow-lg shadow-blue-600/30 transition-all self-start sm:self-auto"
        >
          <Plus className="h-4 w-4" />
          <span>New Automation Recipe</span>
        </button>
      </div>

      {/* Notice Pill: Phase 3 Desktop Runtime requirement */}
      <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center space-x-3 text-xs text-amber-300">
        <ShieldAlert className="h-5 w-5 flex-shrink-0 text-amber-400" />
        <p>
          <span className="font-semibold">Honest Runtime Notice:</span> Automation recipes require the native NEXA 2.0 Desktop Daemon (`nexa-desktop`) for OS-level mouse simulation, window focus, and bash execution.
        </p>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center space-x-2 overflow-x-auto pb-1 text-xs">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setFilter(cat)}
            className={`px-3.5 py-1.5 rounded-xl font-medium transition-colors whitespace-nowrap ${
              filter === cat
                ? 'bg-blue-600 text-white'
                : 'glass-card text-slate-400 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Automations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filtered.map((auto) => {
          const Icon = auto.icon;
          return (
            <div
              key={auto.id}
              className="p-5 rounded-2xl glass-card flex flex-col justify-between space-y-4 hover:border-blue-500/30 transition-colors group"
            >
              <div>
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-3">
                    <div className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-blue-400 group-hover:text-cyan-300 transition-colors">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-white group-hover:text-blue-300 transition-colors">
                        {auto.title}
                      </h3>
                      <span className="text-[11px] font-mono text-slate-500">
                        {auto.category} &bull; {auto.steps} Operations
                      </span>
                    </div>
                  </div>
                  <StatusBadge status="pending" label="Pending Bridge" size="xs" />
                </div>

                <p className="text-xs text-slate-400 mt-3 leading-relaxed">
                  {auto.description}
                </p>
              </div>

              <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
                <div className="flex items-center space-x-1.5 text-slate-400 font-mono text-[11px]">
                  <Clock className="h-3.5 w-3.5 text-slate-500" />
                  <span>{auto.trigger}</span>
                </div>

                <button
                  onClick={() => handleRunAutomation(auto)}
                  className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-800/90 hover:bg-blue-600 hover:text-white text-slate-300 font-medium transition-colors"
                >
                  <Play className="h-3 w-3" />
                  <span>Test Run</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

