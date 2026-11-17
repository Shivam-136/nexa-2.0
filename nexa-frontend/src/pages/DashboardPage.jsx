import React, { useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Terminal, Bot, User, Sparkles, RotateCcw, AlertTriangle, Volume2 } from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { ASSISTANT_STATES } from '../utils/constants';
import AiOrb from '../components/chat/AiOrb';
import WaveformVisualizer from '../components/chat/WaveformVisualizer';
import CommandInput from '../components/chat/CommandInput';
import QuickActions from '../components/dashboard/QuickActions';
import ActivityPanel from '../components/layout/ActivityPanel';

export default function DashboardPage() {
  const {
    assistantState,
    handleOrbClick,
    voiceErrorMessage,
    messages,
    retryMessage,
    clearConversation,
    speak,
    voiceLanguage,
  } = useAppContext();

  const messagesEndRef = useRef(null);
  const isProcessing = assistantState === ASSISTANT_STATES.PROCESSING;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  return (
    <div className="flex-1 w-full max-w-[1600px] mx-auto p-4 sm:p-6 lg:p-8">
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left / Main Section: AI Assistant & Quick Controls (8 cols on XL) */}
        <div className="xl:col-span-8 flex flex-col space-y-6">
          {/* Main AI Operator Stage Card */}
          <div className="rounded-3xl glass-panel p-6 sm:p-8 relative overflow-hidden flex flex-col items-center text-center shadow-glass">
            {/* Top Micro Header */}
            <div className="w-full flex items-center justify-between pb-4 border-b border-slate-800/80 mb-2">
              <div className="flex items-center space-x-2">
                <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
                <span className="text-xs font-mono font-medium text-slate-300 uppercase tracking-wider">
                  NEXA 2.0 Autonomous Core
                </span>
              </div>
              <span className="text-[11px] font-mono text-slate-500 hidden sm:inline">
                GEMINI AI BRAIN ACTIVE
              </span>
            </div>

            {/* Greeting & Title */}
            <div className="mt-2 mb-4">
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Welcome back, <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-500 to-indigo-400">Operator</span>
              </h2>
              <p className="text-sm text-slate-400 mt-1 max-w-lg mx-auto">
                Voice interaction, intelligent Gemini reasoning, and computer automation ready in active session.
              </p>
            </div>

            {/* Center AI Orb */}
            <AiOrb
              state={assistantState}
              onOrbClick={handleOrbClick}
              errorMessage={voiceErrorMessage}
            />

            {/* Voice Waveform Visualizer */}
            <div className="w-full max-w-md my-2">
              <WaveformVisualizer state={assistantState} />
            </div>

            {/* Interactive Command Input */}
            <div className="w-full mt-4">
              <CommandInput />
            </div>
          </div>

          {/* Quick Actions Grid */}
          <QuickActions />

          {/* Live Session Conversation Stream */}
          <div className="rounded-2xl glass-card p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <div className="flex items-center space-x-2">
                <Terminal className="h-4 w-4 text-cyan-400" />
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
                  Session Transcript &amp; Operator Feed
                </h3>
              </div>
              <div className="flex items-center space-x-3">
                <button
                  onClick={clearConversation}
                  className="text-[11px] text-slate-400 hover:text-rose-300 transition-colors"
                >
                  Clear Feed
                </button>
                <span className="text-[11px] font-mono text-slate-500">
                  {messages.length} MESSAGES
                </span>
              </div>
            </div>

            <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
              {messages.map((msg) => {
                const isAssistant = msg.sender === 'assistant';
                const isErrorMsg = Boolean(msg.isError);

                return (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex items-start space-x-3 p-3 rounded-xl text-xs ${
                      isErrorMsg
                        ? 'bg-rose-950/40 border border-rose-800/60 text-rose-200'
                        : isAssistant
                        ? 'bg-slate-900/80 border border-slate-800 text-slate-200'
                        : 'bg-blue-950/40 border border-blue-900/50 text-blue-100 ml-6'
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-lg flex-shrink-0 ${
                        isErrorMsg
                          ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                          : isAssistant
                          ? 'bg-blue-500/10 text-cyan-400 border border-blue-500/20'
                          : 'bg-blue-600 text-white'
                      }`}
                    >
                      {isErrorMsg ? (
                        <AlertTriangle className="h-4 w-4" />
                      ) : isAssistant ? (
                        <Bot className="h-4 w-4" />
                      ) : (
                        <User className="h-4 w-4" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-slate-300">
                          {isErrorMsg ? 'System Alert' : isAssistant ? 'NEXA 2.0' : 'Operator'}
                        </span>
                        <div className="flex items-center space-x-2">
                          <span className="text-[10px] text-slate-500 font-mono">
                            {msg.timestamp}
                          </span>
                          {isAssistant && !isErrorMsg && (
                            <button
                              onClick={() => speak(msg.text, { lang: voiceLanguage, force: true })}
                              className="p-1 text-slate-500 hover:text-cyan-300 transition-colors"
                              title="Speak this message aloud"
                            >
                              <Volume2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      {isErrorMsg && msg.canRetry && msg.retryText && (
                        <div className="mt-2">
                          <button
                            onClick={() => retryMessage(msg.retryText)}
                            className="inline-flex items-center space-x-1 px-2.5 py-1 rounded bg-rose-600/30 hover:bg-rose-600/50 border border-rose-500/50 text-rose-200 text-[11px] transition-colors"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>Retry</span>
                          </button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })}

              {isProcessing && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start space-x-3 p-3 rounded-xl bg-slate-900/80 border border-cyan-500/30 text-xs text-slate-200"
                >
                  <div className="p-1.5 rounded-lg bg-blue-500/10 text-cyan-400 border border-blue-500/20 flex-shrink-0 animate-pulse">
                    <Bot className="h-4 w-4" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center space-x-1.5 py-0.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                      <span className="h-1.5 w-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                      <span className="text-[11px] text-slate-400 ml-1.5 italic">NEXA is generating response...</span>
                    </div>
                  </div>
                </motion.div>
              )}

              <div ref={messagesEndRef} />
            </div>
          </div>
        </div>

        {/* Right Section: Activity Panel & Telemetry (4 cols on XL) */}
        <div className="xl:col-span-4 flex flex-col space-y-6">
          <ActivityPanel />
        </div>
      </div>
    </div>
  );
}
