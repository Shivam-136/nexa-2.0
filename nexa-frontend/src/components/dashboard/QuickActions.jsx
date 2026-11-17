import React from 'react';
import { Compass, Code2, Search, FolderOpen, ArrowUpRight } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { QUICK_ACTIONS } from '../../utils/constants';

const ICON_MAP = {
  Compass,
  Code2,
  Search,
  FolderOpen,
};

export default function QuickActions() {
  const { addToast, submitCommand } = useAppContext();

  const handleActionClick = (action) => {
    if (submitCommand && action.actionPrompt) {
      submitCommand(action.actionPrompt);
    }
    addToast(
      `Quick Action: ${action.label}`,
      `Instruction dispatched to operator feed. Desktop Agent is currently disconnected (Phase 3).`,
      'warning'
    );
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3 px-1">
        <h3 className="text-xs font-mono uppercase tracking-wider text-slate-400 font-semibold">
          Quick Actions (Phase 3 Preview)
        </h3>
        <span className="text-[11px] text-slate-500 font-mono">UI CONTROLS ONLY</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {QUICK_ACTIONS.map((action) => {
          const Icon = ICON_MAP[action.icon] || Compass;

          return (
            <button
              key={action.id}
              onClick={() => handleActionClick(action)}
              className="group text-left p-4 rounded-2xl glass-card hover:bg-slate-900/90 hover:border-blue-500/40 transition-all duration-200 relative overflow-hidden"
            >
              <div className="flex items-start justify-between">
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 text-blue-400 group-hover:text-cyan-300 group-hover:border-cyan-500/30 group-hover:scale-105 transition-all">
                  <Icon className="h-5 w-5" />
                </div>
                <ArrowUpRight className="h-4 w-4 text-slate-600 group-hover:text-slate-300 transition-colors" />
              </div>

              <div className="mt-3">
                <p className="text-sm font-semibold text-slate-200 group-hover:text-white transition-colors">
                  {action.label}
                </p>
                <p className="text-xs text-slate-400 mt-1 line-clamp-2 leading-relaxed">
                  {action.description}
                </p>
              </div>

              {/* Subtle hover accent light */}
              <div className="absolute inset-0 bg-gradient-to-r from-blue-500/0 via-blue-500/5 to-cyan-500/0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
            </button>
          );
        })}
      </div>
    </div>
  );
}

