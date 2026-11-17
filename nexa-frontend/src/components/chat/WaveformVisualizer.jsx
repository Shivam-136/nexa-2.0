import React from 'react';
import { motion } from 'framer-motion';
import { ASSISTANT_STATES } from '../../utils/constants';

export default function WaveformVisualizer({ state = ASSISTANT_STATES.IDLE }) {
  const isListening = state === ASSISTANT_STATES.LISTENING;
  const isProcessing = state === ASSISTANT_STATES.PROCESSING;
  const isSpeaking = state === ASSISTANT_STATES.SPEAKING;
  const isError = state === ASSISTANT_STATES.ERROR;

  // 16 bar heights variations for a realistic waveform distribution
  const bars = [
    { base: 10, active: 38, proc: 20, speak: 34, err: 14 },
    { base: 16, active: 56, proc: 28, speak: 50, err: 8 },
    { base: 12, active: 44, proc: 36, speak: 42, err: 18 },
    { base: 22, active: 78, proc: 42, speak: 68, err: 10 },
    { base: 30, active: 94, proc: 54, speak: 88, err: 24 },
    { base: 18, active: 62, proc: 40, speak: 58, err: 12 },
    { base: 28, active: 88, proc: 65, speak: 82, err: 20 },
    { base: 34, active: 100, proc: 48, speak: 96, err: 14 },
    { base: 32, active: 92, proc: 58, speak: 90, err: 22 },
    { base: 24, active: 70, proc: 38, speak: 66, err: 12 },
    { base: 16, active: 52, proc: 45, speak: 48, err: 16 },
    { base: 26, active: 80, proc: 32, speak: 74, err: 20 },
    { base: 20, active: 64, proc: 26, speak: 60, err: 10 },
    { base: 14, active: 46, proc: 34, speak: 40, err: 14 },
    { base: 18, active: 58, proc: 22, speak: 52, err: 8 },
    { base: 10, active: 32, proc: 18, speak: 28, err: 12 },
  ];

  return (
    <div className="flex items-center justify-center space-x-1.5 h-12 px-4 py-2 select-none">
      {bars.map((bar, idx) => {
        // Dynamic color by state
        const color = isListening
          ? 'bg-gradient-to-t from-cyan-600 to-cyan-300'
          : isProcessing
          ? 'bg-gradient-to-t from-blue-600 to-indigo-400'
          : isSpeaking
          ? 'bg-gradient-to-t from-emerald-600 to-teal-300'
          : isError
          ? 'bg-gradient-to-t from-rose-700 to-amber-500'
          : 'bg-gradient-to-t from-slate-800 to-slate-600';

        // Animated height keyframes by state
        const heightKeyframes = isListening
          ? [`${bar.base}px`, `${bar.active}px`, `${Math.max(bar.active * 0.4, 12)}px`, `${bar.active}px`]
          : isProcessing
          ? [`${bar.proc * 0.5}px`, `${bar.proc}px`, `${bar.proc * 0.3}px`]
          : isSpeaking
          ? [`${bar.base * 1.2}px`, `${bar.speak}px`, `${bar.speak * 0.5}px`, `${bar.speak}px`]
          : isError
          ? [`${bar.err}px`, `${bar.err * 1.5}px`, `${bar.err}px`]
          : [`${bar.base}px`, `${bar.base + 6}px`, `${bar.base}px`];

        // Animation duration & easing by state
        const duration = isListening
          ? 0.6 + (idx % 4) * 0.15
          : isProcessing
          ? 0.9 + (idx % 3) * 0.1
          : isSpeaking
          ? 0.7 + (idx % 3) * 0.12
          : isError
          ? 0.4 + (idx % 2) * 0.2
          : 2.5;

        const opacity = isListening ? 1 : isProcessing ? 0.85 : isSpeaking ? 0.95 : isError ? 0.8 : 0.4;

        return (
          <motion.div
            key={idx}
            animate={{
              height: heightKeyframes,
              opacity,
            }}
            transition={{
              duration,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: idx * 0.04,
            }}
            className={`w-1 rounded-full ${color} transition-colors duration-300`}
            style={{ minHeight: '6px' }}
          />
        );
      })}
    </div>
  );
}
