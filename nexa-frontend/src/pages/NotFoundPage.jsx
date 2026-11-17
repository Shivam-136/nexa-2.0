import React from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowLeft, Cpu } from 'lucide-react';
import { ROUTES } from '../utils/constants';

export default function NotFoundPage() {
  return (
    <div className="flex-1 flex flex-col justify-center items-center px-4 py-16 text-center">
      <div className="p-4 rounded-3xl glass-card max-w-md w-full flex flex-col items-center">
        <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mb-4 shadow-lg shadow-rose-500/10">
          <AlertCircle className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold text-white mb-2">404 &bull; Route Not Found</h1>
        <p className="text-xs text-slate-400 mb-6 leading-relaxed">
          The requested path does not exist within the NEXA 2.0 operator interface.
        </p>
        <Link
          to={ROUTES.DASHBOARD}
          className="inline-flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Return to Command Center</span>
        </Link>
      </div>
    </div>
  );
}
