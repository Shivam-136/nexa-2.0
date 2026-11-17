import React, { useState } from 'react';
import { motion } from 'framer-motion';
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
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import AiOrb from '../components/chat/AiOrb';
import WaveformVisualizer from '../components/chat/WaveformVisualizer';
import CommandInput from '../components/chat/CommandInput';
import { VOICE_LANGUAGES } from '../utils/constants';

export default function AssistantPage() {
  const {
    assistantState,
    handleOrbClick,
    messages,
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

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 flex flex-col space-y-6">
      {/* Top Banner & Control Strip */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 rounded-2xl glass-card gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="p-1 rounded-md bg-blue-500/10 text-cyan-400 border border-blue-500/20">
              <Bot className="h-4 w-4" />
            </span>
            <h2 className="text-base font-bold text-white">Dedicated AI Assistant Console</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Browser Web Speech Engine &bull; Speech-to-Text (EN/HI) &bull; Native Speech Synthesis
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
              or another Chromium-based browser. Keyboard command dispatch and SpeechSynthesis voice playback remain active.
            </p>
          </div>
        </div>
      )}

      {/* Main Interactive Assistant Stage */}
      <div className="rounded-3xl glass-panel p-6 sm:p-10 flex flex-col items-center text-center relative overflow-hidden shadow-glass">
        {/* Hardware Status Strip */}
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

        {/* AI Orb (All 5 states) */}
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
              Dialogue Transcript &bull; Speech Stream
            </h3>
          </div>
          <button
            onClick={() => addToast('Transcript Synced', 'Local session buffer is up to date.', 'info')}
            className="text-xs text-slate-400 hover:text-white flex items-center space-x-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Sync</span>
          </button>
        </div>

        <div className="space-y-4 max-h-96 overflow-y-auto pr-1">
          {messages.map((msg) => {
            const isAssistant = msg.sender === 'assistant';
            return (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex items-start space-x-3 p-4 rounded-xl text-sm ${
                  isAssistant
                    ? 'bg-slate-900/90 border border-slate-800/80 text-slate-200'
                    : 'bg-blue-950/40 border border-blue-900/50 text-blue-100 ml-8'
                }`}
              >
                <div
                  className={`p-2 rounded-xl flex-shrink-0 ${
                    isAssistant
                      ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20'
                      : 'bg-blue-600 text-white'
                  }`}
                >
                  {isAssistant ? <Bot className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="font-semibold text-slate-200">
                      {isAssistant ? 'NEXA 2.0 Assistant' : 'Operator'}
                    </span>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs text-slate-500 font-mono">{msg.timestamp}</span>
                      {isAssistant && (
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
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
