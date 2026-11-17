import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  Mic,
  MicOff,
  Terminal,
  RefreshCw,
  Globe,
  Volume2,
  VolumeX,
  AlertTriangle,
  CheckCircle2,
  Trash2,
  RotateCcw,
  Copy,
  Check,
  Sparkles,
  Cpu,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import AiOrb from '../components/chat/AiOrb';
import WaveformVisualizer from '../components/chat/WaveformVisualizer';
import CommandInput from '../components/chat/CommandInput';
import { VOICE_LANGUAGES, ASSISTANT_STATES } from '../utils/constants';

export default function AssistantPage() {
  const {
    assistantState,
    handleOrbClick,
    messages,
    retryMessage,
    clearConversation,
    connectionStatus,
    refreshBackendStatus,
    addToast,
    isVoiceSupported,
    isListening,
    toggleListening,
    voiceLanguage,
    setVoiceLanguage,
    micPermission,
    ttsEnabled,
    setTtsEnabled,
    isSpeaking,
    stopSpeaking,
    speak,
    voiceErrorMessage,
  } = useAppContext();

  const [interactionMode, setInteractionMode] = useState('hybrid'); // 'hybrid' | 'voice' | 'text'
  const [copiedId, setCopiedId] = useState(null);
  const messagesEndRef = useRef(null);

  const isProcessing = assistantState === ASSISTANT_STATES.PROCESSING;

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  const handleCopyMessage = (id, text) => {
    navigator.clipboard?.writeText(text);
    setCopiedId(id);
    addToast('Copied to Clipboard', 'Message content copied.', 'info');
    setTimeout(() => {
      setCopiedId(null);
    }, 2000);
  };

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 flex flex-col space-y-6">
      {/* Top Banner & Control Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl glass-card gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1 rounded-md bg-blue-500/10 text-cyan-400 border border-blue-500/20">
              <Bot className="h-4 w-4" />
            </span>
            <h2 className="text-base font-bold text-white">NEXA 2.0 AI Brain & Assistant Console</h2>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
              {connectionStatus.aiBrain.includes('Active') ? connectionStatus.aiBrain : 'Gemini Core'}
            </span>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Google Gemini Reasoning Engine &bull; Web Speech Recognition (EN/HI) &bull; Native TTS Playback
          </p>
        </div>

        {/* Voice Mode Selector & Quick Toggles */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Language Selector */}
          <div className="flex items-center p-1 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
            {VOICE_LANGUAGES.map((lang) => (
              <button
                key={lang.code}
                onClick={() => setVoiceLanguage(lang.code)}
                className={`px-2.5 py-1 rounded-lg font-medium transition-colors ${
                  voiceLanguage === lang.code
                    ? 'bg-cyan-500 text-slate-950 font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
                title={`Switch recognition to ${lang.label}`}
              >
                {lang.short}
              </button>
            ))}
          </div>

          {/* Mode Selector */}
          <div className="flex items-center p-1 rounded-xl bg-slate-950/80 border border-slate-800 text-xs">
            <button
              onClick={() => setInteractionMode('hybrid')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                interactionMode === 'hybrid'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Hybrid
            </button>
            <button
              onClick={() => setInteractionMode('voice')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                interactionMode === 'voice'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Voice
            </button>
            <button
              onClick={() => setInteractionMode('text')}
              className={`px-3 py-1 rounded-lg font-medium transition-colors ${
                interactionMode === 'text'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Text
            </button>
          </div>
        </div>
      </div>

      {/* Browser Support Warning Banner (if unsupported) */}
      {!isVoiceSupported && (
        <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-800/60 text-amber-300 text-xs flex items-start space-x-3">
          <AlertTriangle className="h-5 w-5 text-amber-400 flex-shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold text-amber-200">
              Web Speech Recognition is not natively supported in this browser.
            </p>
            <p className="text-amber-300/80 leading-relaxed">
              For real-time voice dictation (English &amp; Hindi), please open NEXA 2.0 in Google Chrome, Microsoft Edge,
              or another Chromium-based browser. Keyboard command dispatch, AI reasoning, and voice playback remain fully operational.
            </p>
          </div>
        </div>
      )}

      {/* Main Interactive Assistant Stage */}
      <div className="rounded-3xl glass-panel p-6 sm:p-10 flex flex-col items-center text-center relative overflow-hidden shadow-glass">
        {/* Hardware & Telemetry Status Strip */}
        <div className="absolute top-4 left-6 right-6 flex items-center justify-between text-[11px] font-mono text-slate-400">
          <div className="flex items-center space-x-2">
            <span
              className={`h-2 w-2 rounded-full ${
                micPermission === 'granted'
                  ? 'bg-emerald-400'
                  : micPermission === 'denied'
                  ? 'bg-rose-400'
                  : 'bg-amber-400'
              }`}
            />
            <span>
              MIC: {micPermission.toUpperCase()} &bull; LANG: {voiceLanguage}
            </span>
          </div>

          <div className="flex items-center space-x-3">
            <button
              onClick={() => {
                if (isSpeaking) stopSpeaking();
                setTtsEnabled(!ttsEnabled);
              }}
              className="flex items-center space-x-1 hover:text-cyan-300 transition-colors"
              title="Toggle Text-to-Speech playback"
            >
              {ttsEnabled ? <Volume2 className="h-3.5 w-3.5 text-cyan-400" /> : <VolumeX className="h-3.5 w-3.5 text-slate-500" />}
              <span>TTS: {ttsEnabled ? 'ON' : 'MUTED'}</span>
            </button>
          </div>
        </div>

        {/* AI Orb (All 5 states: IDLE, LISTENING, PROCESSING, SPEAKING, ERROR) */}
        <div className="mt-4">
          <AiOrb
            state={assistantState}
            onOrbClick={handleOrbClick}
            errorMessage={voiceErrorMessage}
          />
        </div>

        {/* Waveform Visualizer */}
        <div className="w-full max-w-md my-3">
          <WaveformVisualizer state={assistantState} />
        </div>

        {/* Command Input Field */}
        {interactionMode !== 'voice' && (
          <div className="w-full mt-4 max-w-2xl">
            <CommandInput placeholder="Ask NEXA anything or issue a direct computer automation command..." />
          </div>
        )}

        {interactionMode === 'voice' && (
          <div className="w-full mt-4 max-w-md p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300">
            <p className="font-semibold text-cyan-300 mb-1">Hands-Free Voice Mode Active</p>
            <p className="text-slate-400">
              Speak your instructions clearly. Recognized voice input will populate the operator buffer.
            </p>
            <button
              onClick={toggleListening}
              className={`mt-3 px-4 py-2 rounded-xl font-semibold text-xs transition-colors flex items-center justify-center space-x-2 mx-auto ${
                isListening
                  ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/30'
                  : 'bg-blue-600 hover:bg-blue-500 text-white'
              }`}
            >
              {isListening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              <span>{isListening ? 'Stop Listening' : 'Start Listening'}</span>
            </button>
          </div>
        )}
      </div>

      {/* Conversation Thread */}
      <div className="rounded-2xl glass-card p-6 space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
          <div className="flex items-center space-x-2">
            <Terminal className="h-4 w-4 text-cyan-400" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
              Dialogue Transcript &bull; Gemini Intelligence Stream
            </h3>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={clearConversation}
              className="text-xs text-slate-400 hover:text-rose-300 flex items-center space-x-1 px-2 py-1 rounded-lg hover:bg-slate-800/60 transition-colors"
              title="Reset conversation dialogue and clear session context"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear</span>
            </button>

            <button
              onClick={async () => {
                const health = await refreshBackendStatus();
                addToast(
                  'Backend Synced',
                  `Status: ${health.isOnline ? 'Online' : 'Offline'} (${health.model})`,
                  health.isOnline ? 'success' : 'warning'
                );
              }}
              className="text-xs text-slate-400 hover:text-white flex items-center space-x-1 px-2 py-1 rounded-lg hover:bg-slate-800/60 transition-colors"
              title="Check backend and Gemini connection"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Sync</span>
            </button>
          </div>
        </div>

        <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
          {messages.map((msg) => {
            const isAssistant = msg.sender === 'assistant';
            const isErrorMsg = Boolean(msg.isError);

            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-start space-x-3 p-4 rounded-xl text-sm transition-colors ${
                  isErrorMsg
                    ? 'bg-rose-950/40 border border-rose-800/60 text-rose-200'
                    : isAssistant
                    ? 'bg-slate-900/90 border border-slate-800/80 text-slate-200'
                    : 'bg-blue-950/40 border border-blue-900/50 text-blue-100 ml-8'
                }`}
              >
                <div
                  className={`p-2 rounded-xl flex-shrink-0 ${
                    isErrorMsg
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : isAssistant
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                      : 'bg-blue-600 text-white'
                  }`}
                >
                  {isErrorMsg ? (
                    <AlertTriangle className="h-5 w-5" />
                  ) : isAssistant ? (
                    <Bot className="h-5 w-5" />
                  ) : (
                    <Mic className="h-5 w-5" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-slate-200">
                        {isErrorMsg ? 'System Alert' : isAssistant ? 'NEXA 2.0' : 'Operator'}
                      </span>
                      {msg.model && (
                        <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60">
                          {msg.model}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-slate-500 font-mono">{msg.timestamp}</span>

                      {/* Copy Message Button */}
                      <button
                        onClick={() => handleCopyMessage(msg.id, msg.text)}
                        className="p-1 text-slate-500 hover:text-slate-300 transition-colors"
                        title="Copy message to clipboard"
                      >
                        {copiedId === msg.id ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>

                      {/* Speak Message Button */}
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

                  {/* Retry action for error messages */}
                  {isErrorMsg && msg.canRetry && msg.retryText && (
                    <div className="mt-3 pt-2 border-t border-rose-900/40 flex items-center space-x-3">
                      <button
                        onClick={() => retryMessage(msg.retryText)}
                        className="inline-flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-rose-600/30 hover:bg-rose-600/50 border border-rose-500/50 text-rose-200 text-xs font-medium transition-colors"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Retry Prompt</span>
                      </button>
                      <span className="text-[11px] text-rose-400/80">
                        Check backend terminal and GEMINI_API_KEY if error persists.
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}

          {/* Typing / Loading Animation indicator while processing */}
          {isProcessing && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex items-start space-x-3 p-4 rounded-xl bg-slate-900/90 border border-cyan-500/30 text-slate-200"
            >
              <div className="p-2 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex-shrink-0 animate-pulse">
                <Bot className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center space-x-2 mb-2">
                  <span className="font-semibold text-slate-200">NEXA 2.0</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60 flex items-center space-x-1">
                    <Sparkles className="h-3 w-3 animate-spin" />
                    <span>Gemini Reasoning</span>
                  </span>
                </div>
                <div className="flex items-center space-x-1.5 py-1">
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="h-2 w-2 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '300ms' }}></span>
                  <span className="text-xs text-slate-400 ml-2 italic">Generating intelligent response...</span>
                </div>
              </div>
            </motion.div>
          )}

          {/* Scroll anchor */}
          <div ref={messagesEndRef} />
        </div>
      </div>
    </div>
  );
}
