import React from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ShieldCheck, Box, Activity, Cpu, Sparkles } from 'lucide-react';
import useSystemStatus from '../hooks/useSystemStatus';

export default function HomePage() {
  const status = useSystemStatus();

  const coreModules = [
    { name: 'Vite 5 + React 18', detail: 'JavaScript build pipeline with HMR', ready: true },
    { name: 'Tailwind CSS', detail: 'Utility-first dark theme foundation', ready: true },
    { name: 'React Router DOM', detail: 'Declarative SPA client-side routing', ready: true },
    { name: 'Lucide Icons & Framer Motion', detail: 'Visual icons & animation primitives', ready: true },
    { name: 'Decoupled Service Architecture', detail: 'API client & configuration abstractions', ready: true },
    { name: 'Environment Abstraction', detail: 'Zero hardcoded secrets & secure config', ready: true },
  ];

  return (
    <div className="flex-1 flex flex-col justify-center items-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-4xl"
      >
        {/* Banner */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold mb-4">
            <Sparkles className="h-3.5 w-3.5" />
            <span>Architecture Initialization Complete</span>
          </div>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white tracking-tight">
            NEXA <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-500">2.0</span>
          </h1>
          <p className="mt-3 text-base sm:text-lg text-slate-400 max-w-2xl mx-auto">
            Next-Generation AI-Powered Personal Computer Operator frontend foundation.
          </p>
        </div>

        {/* Status card */}
        <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
          <div className="flex items-center justify-between pb-6 border-b border-slate-800">
            <div className="flex items-center space-x-3">
              <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-white">System Architecture Status</h2>
                <p className="text-xs text-slate-400">Environment: {status.environment} &bull; v{status.version}</p>
              </div>
            </div>
            <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
              Phase 1 Ready
            </span>
          </div>

          {/* Module grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6">
            {coreModules.map((module) => (
              <div
                key={module.name}
                className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 flex items-start space-x-3"
              >
                <div className="p-1.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20 mt-0.5">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <div>
                  <h3 className="text-sm font-medium text-slate-200">{module.name}</h3>
                  <p className="text-xs text-slate-400 mt-0.5">{module.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-8 p-4 rounded-xl bg-blue-950/30 border border-blue-900/40 text-xs text-blue-300 flex items-center space-x-3">
            <Activity className="h-5 w-5 text-blue-400 flex-shrink-0" />
            <p>
              Phase 1 setup validated. Awaiting operator confirmation to proceed to Phase 2 (Dashboard &amp; Core Interface design).
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

