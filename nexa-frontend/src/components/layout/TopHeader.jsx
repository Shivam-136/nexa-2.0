import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Menu, ShieldAlert, Bell, User, Sparkles, LogOut } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { useAuth } from '../../context/AuthContext';
import { ROUTES } from '../../utils/constants';

export default function TopHeader() {
  const location = useLocation();
  const navigate = useNavigate();
  const { setMobileMenuOpen, connectionStatus, addToast } = useAppContext();
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    try {
      await logout();
      addToast('Signed Out', 'Your operator session has been closed securely.', 'info');
      navigate(ROUTES.LOGIN);
    } catch (err) {
      addToast('Logout Notice', 'Session cleared.', 'info');
      navigate(ROUTES.LOGIN);
    }
  };

  const getPageInfo = () => {
    switch (location.pathname) {
      case ROUTES.DASHBOARD:
        return {
          title: 'Command Center',
          subtitle: 'Autonomous AI computer operator runtime & system hub',
        };
      case ROUTES.ASSISTANT:
        return {
          title: 'AI Assistant',
          subtitle: 'Interactive natural language and voice interaction engine',
        };
      case ROUTES.AUTOMATIONS:
        return {
          title: 'Automations & Workflows',
          subtitle: 'Scheduled routines, hotkeys, and desktop procedural recipes',
        };
      case ROUTES.HISTORY:
        return {
          title: 'Command History & Logs',
          subtitle: 'Complete chronological audit trail of operator interactions',
        };
      case ROUTES.DESKTOP:
        return {
          title: 'Desktop Control & Telemetry',
          subtitle: 'Display stream, input injection, and permission status',
        };
      case ROUTES.SETTINGS:
        return {
          title: 'System Settings',
          subtitle: 'Daemon bridge configuration, AI reasoning models, and preferences',
        };
      default:
        return {
          title: 'NEXA 2.0',
          subtitle: 'AI Personal Computer Operator',
        };
    }
  };

  const pageInfo = getPageInfo();

  return (
    <header className="h-16 sticky top-0 z-30 bg-slate-950/70 backdrop-blur-xl border-b border-slate-800/80 px-4 sm:px-6 flex items-center justify-between">
      {/* Left: Mobile trigger & Page Title */}
      <div className="flex items-center space-x-3">
        <button
          onClick={() => setMobileMenuOpen(true)}
          className="lg:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 transition-colors"
          aria-label="Open Navigation Menu"
        >
          <Menu className="h-5 w-5" />
        </button>

        <div>
          <h1 className="text-sm sm:text-base font-bold text-white tracking-tight flex items-center space-x-2">
            <span>{pageInfo.title}</span>
          </h1>
          <p className="text-[11px] text-slate-400 hidden sm:block truncate max-w-md">
            {pageInfo.subtitle}
          </p>
        </div>
      </div>

      {/* Right: Connection badges & Operator profile */}
      <div className="flex items-center space-x-2 sm:space-x-3">
        {/* Core System Indicator */}
        <div className="hidden md:flex items-center space-x-2 px-2.5 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400"></span>
          </span>
          <span className="font-mono text-[11px]">CORE: {connectionStatus.core.toUpperCase()}</span>
        </div>

        {/* AI Brain Status */}
        <div
          title={`NEXA AI Provider: ${user?.aiProvider ? user.aiProvider.toUpperCase() : 'OLLAMA'} • ${connectionStatus.aiBrain}`}
          className={`hidden lg:flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-mono border ${
            connectionStatus.aiBrain?.includes('Active')
              ? 'bg-cyan-500/10 text-cyan-300 border-cyan-500/25'
              : 'bg-slate-800/80 text-slate-400 border-slate-700/60'
          }`}
        >
          <Sparkles className="h-3 w-3 text-cyan-400" />
          <span className="text-[11px] font-semibold">{user?.aiProvider ? user.aiProvider.toUpperCase() : 'OLLAMA'}:</span>
          <span className="text-[11px]">{connectionStatus.aiBrain}</span>
        </div>

        {/* Desktop Agent Status: Not Connected */}
        <div
          title="Desktop Agent required for OS automation (Phase 3)"
          className="flex items-center space-x-2 px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/25 text-amber-400 text-xs"
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          <span className="text-[11px] font-medium hidden sm:inline">Desktop Agent:</span>
          <span className="font-mono text-[11px] font-semibold">{connectionStatus.desktopAgent}</span>
        </div>

        {/* Notifications Icon Button */}
        <button
          onClick={() =>
            addToast('System Status Nominal', 'All frontend UI subsystems operating normally.', 'info')
          }
          className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 transition-colors relative"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-blue-500"></span>
        </button>

        {/* Profile / Operator Badge & Logout */}
        <div className="flex items-center space-x-2 pl-2 border-l border-slate-800">
          <div className="h-8 w-8 rounded-xl bg-slate-900 border border-slate-700/80 flex items-center justify-center text-blue-400 shadow-inner">
            <User className="h-4 w-4" />
          </div>
          <div className="hidden xl:block text-left text-xs">
            <p className="font-semibold text-slate-200 leading-none truncate max-w-[120px]">
              {user?.displayName || user?.email?.split('@')[0] || 'Operator'}
            </p>
            <p className="text-[10px] text-slate-400 font-mono mt-0.5 truncate max-w-[120px]">
              {user?.email || 'AUTH_ACTIVE'}
            </p>
          </div>
          <button
            onClick={handleLogout}
            title="Sign out of NEXA 2.0"
            className="p-1.5 ml-1 rounded-lg text-slate-400 hover:text-red-400 hover:bg-red-500/10 border border-transparent hover:border-red-500/20 transition-colors"
            aria-label="Sign Out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

