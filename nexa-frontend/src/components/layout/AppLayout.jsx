import React from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopHeader from './TopHeader';
import NotificationToast from '../common/NotificationToast';
import { useAppContext } from '../../context/AppContext';

export default function AppLayout() {
  const { sidebarCollapsed } = useAppContext();

  return (
    <div className="min-h-screen bg-[#070a12] text-slate-100 flex">
      {/* Sidebar Navigation */}
      <Sidebar />

      {/* Main Content Area */}
      <div
        className={`flex-1 flex flex-col min-w-0 transition-all duration-300 ease-in-out ${
          sidebarCollapsed ? 'lg:pl-20' : 'lg:pl-64'
        }`}
      >
        <TopHeader />

        <main className="flex-1 flex flex-col relative overflow-x-hidden">
          <Outlet />
        </main>

        <footer className="border-t border-slate-900 bg-slate-950/40 py-4 px-6 text-center text-[11px] text-slate-500 font-mono">
          <span>NEXA 2.0 &bull; Autonomous AI Computer Operator &bull; Phase 2 UI Runtime</span>
        </footer>
      </div>

      {/* Floating Notifications */}
      <NotificationToast />
    </div>
  );
}
