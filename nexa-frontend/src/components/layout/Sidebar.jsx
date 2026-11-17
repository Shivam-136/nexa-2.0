import React from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard,
  Bot,
  Workflow,
  History,
  Monitor,
  Settings,
  ChevronLeft,
  ChevronRight,
  Radio,
  X,
  Cpu,
} from 'lucide-react';
import { ROUTES, APP_CONFIG } from '../../utils/constants';
import { useAppContext } from '../../context/AppContext';

export default function Sidebar() {
  const {
    sidebarCollapsed,
    setSidebarCollapsed,
    mobileMenuOpen,
    setMobileMenuOpen,
    connectionStatus,
  } = useAppContext();

  const navItems = [
    { label: 'Dashboard', path: ROUTES.DASHBOARD, icon: LayoutDashboard },
    { label: 'AI Assistant', path: ROUTES.ASSISTANT, icon: Bot },
    { label: 'Automations', path: ROUTES.AUTOMATIONS, icon: Workflow },
    { label: 'Command History', path: ROUTES.HISTORY, icon: History },
    { label: 'Desktop Control', path: ROUTES.DESKTOP, icon: Monitor },
    { label: 'Settings', path: ROUTES.SETTINGS, icon: Settings },
  ];

  const sidebarContent = (
    <div className="h-full flex flex-col justify-between bg-slate-950/95 backdrop-blur-2xl border-r border-slate-800/80 text-slate-300">
      {/* Top Header / Branding */}
      <div>
        <div className={`h-16 flex items-center border-b border-slate-800/80 ${
          sidebarCollapsed && !mobileMenuOpen ? 'justify-center px-2' : 'justify-between px-4'
        }`}>
          <div className="flex items-center space-x-3 overflow-hidden">
            <div className="h-9 w-9 min-w-9 rounded-xl bg-gradient-to-tr from-cyan-500 via-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20 text-white">
              <Cpu className="h-5 w-5" />
            </div>
            {(!sidebarCollapsed || mobileMenuOpen) && (
              <motion.div
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="whitespace-nowrap"
              >
                <div className="flex items-center space-x-1.5">
                  <span className="font-bold text-base tracking-wider text-white">NEXA</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                    2.0
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 font-mono tracking-tight">AI PC OPERATOR</p>
              </motion.div>
            )}
          </div>

          {/* Mobile close button */}
          {mobileMenuOpen && (
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/60 transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Navigation list */}
        <nav className="p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                end={item.path === ROUTES.DASHBOARD}
                onClick={() => setMobileMenuOpen(false)}
                className={({ isActive }) =>
                  `flex items-center px-3 py-2.5 rounded-xl text-sm font-medium transition-all group relative ${
                    sidebarCollapsed && !mobileMenuOpen ? 'justify-center' : 'space-x-3'
                  } ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                      : 'text-slate-400 hover:text-white hover:bg-slate-900/80'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={`h-5 w-5 min-w-5 transition-transform duration-200 ${
                        isActive ? 'text-white' : 'text-slate-400 group-hover:text-blue-400 group-hover:scale-105'
                      }`}
                    />
                    {(!sidebarCollapsed || mobileMenuOpen) && (
                      <span className="truncate">{item.label}</span>
                    )}

                    {/* Collapsed Tooltip (Desktop) */}
                    {sidebarCollapsed && !mobileMenuOpen && (
                      <div className="hidden lg:group-hover:flex absolute left-full ml-3 px-2.5 py-1 bg-slate-900 text-slate-100 text-xs rounded-md shadow-xl border border-slate-700 whitespace-nowrap z-50 pointer-events-none">
                        {item.label}
                      </div>
                    )}
                  </>
                )}
              </NavLink>
            );
          })}
        </nav>
      </div>

      {/* Bottom Section: Connection status & Collapse button */}
      <div className="p-3 border-t border-slate-800/80 space-y-3">
        {/* Connection pill */}
        {(!sidebarCollapsed || mobileMenuOpen) ? (
          <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800 text-xs">
            <div className="flex items-center justify-between text-slate-400 mb-1.5">
              <span className="font-mono text-[11px] uppercase tracking-wider">Desktop Agent</span>
              <span className="inline-block h-2 w-2 rounded-full bg-amber-400"></span>
            </div>
            <p className="font-semibold text-slate-200">{connectionStatus.desktopAgent}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Phase 3 Desktop Daemon</p>
          </div>
        ) : (
          <div className="flex justify-center">
            <div
              title={`Desktop Agent: ${connectionStatus.desktopAgent}`}
              className="h-8 w-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center text-amber-400"
            >
              <Radio className="h-4 w-4" />
            </div>
          </div>
        )}

        {/* Collapse toggle (Desktop only) */}
        <div className="hidden lg:flex justify-end">
          <button
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
            className="w-full py-2 px-3 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900/80 transition-colors flex items-center justify-center space-x-2 text-xs font-medium border border-transparent hover:border-slate-800"
            title={sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {sidebarCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside
        className={`hidden lg:block fixed top-0 bottom-0 left-0 z-40 transition-all duration-300 ease-in-out ${
          sidebarCollapsed ? 'w-20' : 'w-64'
        }`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Backdrop & Container */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="lg:hidden fixed top-0 bottom-0 left-0 z-50 w-72 max-w-[85vw]"
            >
              {sidebarContent}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}

