import React from 'react';
import { motion } from 'framer-motion';
import { ASSISTANT_STATES } from '../../utils/constants';
import { Sparkles, Mic, Activity, Volume2, AlertTriangle } from 'lucide-react';

export default function AiOrb({ state = ASSISTANT_STATES.IDLE, onOrbClick, errorMessage }) {
  const isListening = state === ASSISTANT_STATES.LISTENING;
  const isProcessing = state === ASSISTANT_STATES.PROCESSING;
  const isSpeaking = state === ASSISTANT_STATES.SPEAKING;
  const isError = state === ASSISTANT_STATES.ERROR;

  const getOrbTitle = () => {
    if (isListening) return 'Click to stop listening';
    if (isSpeaking) return 'Click to stop voice output';
    if (isProcessing) return 'Processing command...';
    if (isError) return 'Error encountered — click to reset';
    return 'Click to activate voice input';
  };

  const getStatusLabel = () => {
    if (isListening) return 'LISTENING';
    if (isProcessing) return 'PROCESSING';
    if (isSpeaking) return 'SPEAKING';
    if (isError) return 'ERROR';
    return 'STANDBY';
  };

  const getInstructionText = () => {
    if (isListening) return 'Voice capture active — Speak now';
    if (isProcessing) return 'Synthesizing operator instructions...';
    if (isSpeaking) return 'Voice response active — Click to silence';
    if (isError) return errorMessage || 'Voice system error — Click to reset';
    return 'Click Orb or Mic to initiate voice command';
  };

  return (
    <div className="relative flex flex-col items-center justify-center py-6 select-none">
      {/* Background radial gradient glow */}
      <div
        className={`absolute w-72 h-72 rounded-full transition-all duration-700 pointer-events-none blur-3xl ${
          isListening
            ? 'bg-cyan-500 scale-125 opacity-40'
            : isProcessing
            ? 'bg-blue-600 scale-110 opacity-35'
            : isSpeaking
            ? 'bg-emerald-500 scale-125 opacity-40'
            : isError
            ? 'bg-rose-500 scale-120 opacity-35'
            : 'bg-indigo-600/60 scale-100 opacity-20'
        }`}
      />

      {/* Main Orb Interactive Container */}
      <div
        onClick={onOrbClick}
        className="relative cursor-pointer group flex items-center justify-center w-52 h-52 sm:w-60 sm:h-60"
        title={getOrbTitle()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onOrbClick?.();
          }
        }}
        aria-label={getOrbTitle()}
      >
        {/* Layer 1: Outermost Pulse Wave (Listening & Speaking Modes) */}
        {isListening && (
          <motion.div
            initial={{ scale: 0.85, opacity: 0.8 }}
            animate={{ scale: 1.5, opacity: 0 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
            className="absolute inset-0 rounded-full border border-cyan-400/40"
          />
        )}

        {isSpeaking && (
          <motion.div
            initial={{ scale: 0.9, opacity: 0.7 }}
            animate={{ scale: 1.45, opacity: 0 }}
            transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
            className="absolute inset-0 rounded-full border border-emerald-400/50"
          />
        )}

        {isError && (
          <motion.div
            animate={{ scale: [1, 1.08, 1], opacity: [0.6, 0.2, 0.6] }}
            transition={{ duration: 1.5, repeat: Infinity }}
            className="absolute inset-0 rounded-full border border-rose-500/50"
          />
        )}

        {/* Layer 2: Secondary Outer Orbital Ring */}
        <motion.div
          animate={{
            rotate: isProcessing ? -360 : isSpeaking ? 360 : 360,
            scale: isListening ? [1, 1.05, 1] : isSpeaking ? [1, 1.04, 1] : 1,
          }}
          transition={{
            rotate: {
              duration: isProcessing ? 8 : isSpeaking ? 14 : 24,
              repeat: Infinity,
              ease: 'linear',
            },
            scale: { duration: 1.5, repeat: Infinity, ease: 'easeInOut' },
          }}
          className={`absolute inset-2 sm:inset-3 rounded-full border border-dashed transition-colors duration-500 ${
            isListening
              ? 'border-cyan-400/60'
              : isProcessing
              ? 'border-blue-400/60'
              : isSpeaking
              ? 'border-emerald-400/60'
              : isError
              ? 'border-rose-400/60'
              : 'border-slate-700/60 group-hover:border-blue-500/40'
          }`}
        />

        {/* Layer 3: Tech Dashed Measurement Ring */}
        <motion.div
          animate={{
            rotate: isProcessing ? 360 : isSpeaking ? -360 : -360,
          }}
          transition={{
            duration: isProcessing ? 12 : isSpeaking ? 16 : 36,
            repeat: Infinity,
            ease: 'linear',
          }}
          className={`absolute inset-6 sm:inset-8 rounded-full border ${
            isListening
              ? 'border-slate-800 border-t-cyan-500/80 border-r-transparent border-b-cyan-400/80 border-l-transparent'
              : isProcessing
              ? 'border-slate-800 border-t-blue-500/80 border-r-transparent border-b-indigo-500/80 border-l-transparent'
              : isSpeaking
              ? 'border-slate-800 border-t-emerald-400/80 border-r-transparent border-b-teal-400/80 border-l-transparent'
              : isError
              ? 'border-slate-800 border-t-rose-500/80 border-r-transparent border-b-amber-500/80 border-l-transparent'
              : 'border-slate-800 border-t-cyan-500/70 border-r-transparent border-b-blue-500/70 border-l-transparent'
          }`}
        />

        {/* Layer 4: Glass Core Spherical Body */}
        <motion.div
          animate={{
            scale: isListening
              ? [1, 1.04, 1]
              : isSpeaking
              ? [1, 1.03, 1]
              : isProcessing
              ? [0.98, 1.02, 0.98]
              : isError
              ? [0.97, 1.01, 0.97]
              : [1, 1.02, 1],
          }}
          transition={{
            duration: isListening ? 1.2 : isSpeaking ? 1.4 : isError ? 1.8 : 3.5,
            repeat: Infinity,
            ease: 'easeInOut',
          }}
          className={`relative w-36 h-36 sm:w-44 sm:h-44 rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 ${
            isListening
              ? 'shadow-cyan-500/30 bg-gradient-to-tr from-cyan-950 via-slate-900 to-blue-900 border border-cyan-400/70'
              : isProcessing
              ? 'shadow-blue-500/30 bg-gradient-to-tr from-blue-950 via-slate-900 to-indigo-950 border border-blue-400/70'
              : isSpeaking
              ? 'shadow-emerald-500/30 bg-gradient-to-tr from-emerald-950 via-slate-900 to-teal-900 border border-emerald-400/70'
              : isError
              ? 'shadow-rose-500/30 bg-gradient-to-tr from-rose-950 via-slate-900 to-red-950 border border-rose-500/70'
              : 'shadow-black/70 bg-gradient-to-tr from-slate-950 via-slate-900 to-blue-950/80 border border-slate-700/70 group-hover:border-blue-500/60'
          }`}
        >
          {/* Inner Geometric Star & Wave Core */}
          <div className="relative flex flex-col items-center justify-center text-center">
            {isListening ? (
              <motion.div
                initial={{ scale: 0.8 }}
                animate={{ scale: [0.9, 1.15, 0.9] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="text-cyan-400"
              >
                <Mic className="h-10 w-10 sm:h-12 sm:w-12 drop-shadow-[0_0_12px_rgba(56,189,248,0.8)]" />
              </motion.div>
            ) : isProcessing ? (
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                className="text-blue-400"
              >
                <Activity className="h-10 w-10 sm:h-12 sm:w-12 drop-shadow-[0_0_12px_rgba(59,130,246,0.8)]" />
              </motion.div>
            ) : isSpeaking ? (
              <motion.div
                animate={{ scale: [0.95, 1.1, 0.95] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                className="text-emerald-400"
              >
                <Volume2 className="h-10 w-10 sm:h-12 sm:w-12 drop-shadow-[0_0_12px_rgba(52,211,153,0.8)]" />
              </motion.div>
            ) : isError ? (
              <motion.div
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
                className="text-rose-400"
              >
                <AlertTriangle className="h-10 w-10 sm:h-12 sm:w-12 drop-shadow-[0_0_12px_rgba(244,63,94,0.8)]" />
              </motion.div>
            ) : (
              <div className="text-blue-400 group-hover:text-cyan-300 transition-colors">
                <Sparkles className="h-9 w-9 sm:h-11 sm:w-11 transition-transform group-hover:scale-110 duration-300" />
              </div>
            )}

            {/* Core Status Label */}
            <span
              className={`mt-2 font-mono text-[10px] tracking-widest uppercase font-semibold transition-colors ${
                isListening
                  ? 'text-cyan-300'
                  : isProcessing
                  ? 'text-blue-300'
                  : isSpeaking
                  ? 'text-emerald-300'
                  : isError
                  ? 'text-rose-300'
                  : 'text-slate-400 group-hover:text-slate-200'
              }`}
            >
              {getStatusLabel()}
            </span>
          </div>

          {/* Micro light glare highlight */}
          <div className="absolute top-3 left-6 w-8 h-4 rounded-full bg-white/10 blur-[1px] transform -rotate-45 pointer-events-none" />
        </motion.div>
      </div>

      {/* State instruction hint below Orb */}
      <p className="mt-3 text-xs text-slate-400 font-mono flex items-center space-x-1.5 max-w-sm text-center">
        <span
          className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${
            isListening
              ? 'bg-cyan-400 animate-ping'
              : isProcessing
              ? 'bg-blue-400 animate-pulse'
              : isSpeaking
              ? 'bg-emerald-400 animate-ping'
              : isError
              ? 'bg-rose-500 animate-bounce'
              : 'bg-slate-500'
          }`}
        />
        <span className="truncate">{getInstructionText()}</span>
      </p>
    </div>
  );
}
