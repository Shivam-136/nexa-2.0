import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';
import { useAppContext } from '../../context/AppContext';

export default function NotificationToast() {
  const { toasts, removeToast } = useAppContext();

  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col space-y-2 max-w-sm w-full pointer-events-none px-4 sm:px-0">
      <AnimatePresence>
        {toasts.map((toast) => {
          const isSuccess = toast.type === 'success';
          const isWarning = toast.type === 'warning';

          return (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="pointer-events-auto p-4 rounded-xl border border-slate-700/80 bg-slate-900/95 backdrop-blur-xl shadow-2xl flex items-start space-x-3 text-sm"
            >
              <div className="mt-0.5 flex-shrink-0">
                {isSuccess ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-400" />
                ) : isWarning ? (
                  <AlertCircle className="h-5 w-5 text-amber-400" />
                ) : (
                  <Info className="h-5 w-5 text-cyan-400" />
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium text-slate-100">{toast.title}</p>
                {toast.description && (
                  <p className="mt-0.5 text-xs text-slate-400 leading-relaxed">
                    {toast.description}
                  </p>
                )}
              </div>

              <button
                onClick={() => removeToast(toast.id)}
                className="text-slate-400 hover:text-white p-1 rounded-lg transition-colors flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

