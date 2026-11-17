import React from 'react';
import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ROUTES } from '../../utils/constants';
import { Cpu } from 'lucide-react';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white space-y-4">
        <div className="relative">
          <div className="h-16 w-16 rounded-2xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center animate-pulse">
            <Cpu className="h-8 w-8 text-blue-400" />
          </div>
          <div className="absolute inset-0 rounded-2xl bg-blue-500/10 blur-xl"></div>
        </div>
        <div className="text-center space-y-1">
          <p className="font-mono text-sm tracking-widest text-blue-400 uppercase">
            NEXA 2.0 Security Core
          </p>
          <p className="text-xs text-slate-400">Authenticating operator credentials...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />;
  }

  return children ? children : <Outlet />;
}
