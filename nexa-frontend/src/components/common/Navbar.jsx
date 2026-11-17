import React from 'react';
import { NavLink } from 'react-router-dom';
import { Cpu, Layers } from 'lucide-react';
import { APP_CONFIG, ROUTES } from '../../utils/constants';

export default function Navbar() {
  return (
    <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Cpu className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="font-bold text-lg tracking-wider text-white">NEXA</span>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-blue-500/20 text-blue-400 border border-blue-500/30">
                v{APP_CONFIG.VERSION}
              </span>
            </div>
            <p className="text-xs text-slate-400">AI Personal Computer Operator</p>
          </div>
        </div>

        <nav className="flex items-center space-x-2">
          <NavLink
            to={ROUTES.HOME}
            end
            className={({ isActive }) =>
              `flex items-center space-x-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800'
              }`
            }
          >
            <Layers className="h-4 w-4" />
            <span>Architecture</span>
          </NavLink>

          <div className="hidden sm:flex items-center pl-3 border-l border-slate-800 text-xs text-slate-400 space-x-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Phase 1 Initialized</span>
          </div>
        </nav>
      </div>
    </header>
  );
}

