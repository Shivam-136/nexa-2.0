import React, { useRef } from 'react';
import {
  Mic,
  MicOff,
  CornerDownLeft,
  Sparkles,
  X,
  Volume2,
  VolumeX,
  Globe,
  AlertCircle,
} from 'lucide-react';
import { useAppContext } from '../../context/AppContext';
import { ASSISTANT_STATES, VOICE_LANGUAGES } from '../../utils/constants';

export default function CommandInput({
  placeholder = "Type a command or instruction for NEXA 2.0 (e.g. 'Open project workspace')...",
}) {
  const inputRef = useRef(null);
  const {
    assistantState,
    submitCommand,
    commandInputText,
    setCommandInputText,
    isVoiceSupported,
    isListening,
    toggleListening,
    voiceLanguage,
    setVoiceLanguage,
    interimTranscript,
    micPermission,
    ttsEnabled,
    setTtsEnabled,
    isSpeaking,
    stopSpeaking,
  } = useAppContext();

  const isProcessing = assistantState === ASSISTANT_STATES.PROCESSING;

  const handleSubmit = (e) => {
    e?.preventDefault();
    if (!commandInputText || !commandInputText.trim() || isProcessing) return;

    submitCommand(commandInputText.trim());
    setCommandInputText('');
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleClear = () => {
    setCommandInputText('');
    inputRef.current?.focus();
  };

  const toggleLanguage = () => {
    const nextLang = voiceLanguage === 'en-US' ? 'hi-IN' : 'en-US';
    setVoiceLanguage(nextLang);
  };

  return (
    <div className="w-full max-w-3xl mx-auto">
      {/* Live Interim Voice Transcription Banner */}
      {isListening && (
        <div className="flex items-center space-x-2.5 px-4 py-2 mb-2 rounded-xl bg-cyan-950/60 border border-cyan-800/60 text-cyan-300 text-xs font-mono shadow-lg shadow-cyan-950/50">
          <span className="relative flex h-2 w-2 flex-shrink-0">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
          </span>
          <span className="font-semibold text-cyan-200">
            {voiceLanguage === 'hi-IN' ? 'आवाज़ पहचान (Hindi):' : 'Voice Capture (English):'}
          </span>
          <span className="italic truncate text-slate-100 flex-1">
            {interimTranscript ? `"${interimTranscript}"` : 'Listening... Speak clearly into your microphone'}
          </span>
          <span className="text-[10px] text-cyan-400 uppercase tracking-widest hidden sm:inline">
            INTERIM STREAM
          </span>
        </div>
      )}

      {/* Microphone Permission Warning Banner */}
      {micPermission === 'denied' && (
        <div className="flex items-center justify-between px-3.5 py-1.5 mb-2 rounded-xl bg-rose-950/60 border border-rose-800/50 text-rose-300 text-xs">
          <div className="flex items-center space-x-2">
            <AlertCircle className="h-4 w-4 text-rose-400 flex-shrink-0" />
            <span>Microphone permission denied. Unblock microphone in your browser address bar.</span>
          </div>
        </div>
      )}

      {/* Main Command Input Field Container */}
      <form
        onSubmit={handleSubmit}
        className={`relative flex items-center p-2 rounded-2xl glass-input transition-all duration-300 ${
          isListening
            ? 'ring-2 ring-cyan-500/60 shadow-glow-cyan bg-slate-900/90'
            : isProcessing
            ? 'ring-2 ring-blue-500/50 shadow-glow-blue'
            : isSpeaking
            ? 'ring-2 ring-emerald-500/40'
            : 'focus-within:border-blue-500/60 focus-within:ring-1 focus-within:ring-blue-500/30'
        }`}
      >
        {/* Voice Microphone Toggle Button */}
        <button
          type="button"
          onClick={toggleListening}
          disabled={!isVoiceSupported}
          className={`p-3 rounded-xl transition-all duration-200 flex items-center justify-center relative ${
            !isVoiceSupported
              ? 'text-slate-600 cursor-not-allowed opacity-50'
              : isListening
              ? 'bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/40 animate-pulse'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/80'
          }`}
          title={
            !isVoiceSupported
              ? 'Web Speech API not supported in this browser'
              : isListening
              ? 'Stop voice listening'
              : `Start voice input (${voiceLanguage === 'hi-IN' ? 'Hindi' : 'English'})`
          }
          aria-label={isListening ? 'Stop listening' : 'Start voice input'}
        >
          {isListening ? (
            <MicOff className="h-5 w-5" />
          ) : (
            <Mic className={`h-5 w-5 ${!isVoiceSupported ? 'opacity-40' : ''}`} />
          )}
        </button>

        {/* Input Text Field */}
        <input
          ref={inputRef}
          type="text"
          value={commandInputText}
          onChange={(e) => setCommandInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isListening
              ? voiceLanguage === 'hi-IN'
                ? 'बोलिए... आपकी आवाज़ यहाँ टाइप होगी'
                : 'Listening... your words will populate here'
              : placeholder
          }
          disabled={isProcessing}
          className="flex-1 bg-transparent px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none disabled:opacity-50"
        />

        {/* Language Selection Pill Toggle */}
        <button
          type="button"
          onClick={toggleLanguage}
          className="px-2.5 py-1 mr-1 rounded-lg bg-slate-800/80 hover:bg-slate-700/80 border border-slate-700/60 text-[11px] font-mono text-cyan-300 hover:text-cyan-200 transition-colors flex items-center space-x-1"
          title={`Click to switch recognition language (current: ${
            voiceLanguage === 'hi-IN' ? 'Hindi' : 'English'
          })`}
        >
          <Globe className="h-3 w-3 opacity-80" />
          <span>{voiceLanguage === 'hi-IN' ? 'HI' : 'EN'}</span>
        </button>

        {/* Text-to-Speech Toggle Button */}
        <button
          type="button"
          onClick={() => {
            if (isSpeaking) {
              stopSpeaking();
            }
            setTtsEnabled(!ttsEnabled);
          }}
          className={`p-2 rounded-xl transition-colors mr-1 ${
            ttsEnabled
              ? 'text-cyan-400 hover:text-cyan-300 hover:bg-slate-800/80'
              : 'text-slate-600 hover:text-slate-400 hover:bg-slate-800/50'
          }`}
          title={ttsEnabled ? 'Voice responses active (Click to mute TTS)' : 'Voice responses muted (Click to enable TTS)'}
          aria-label="Toggle voice output"
        >
          {ttsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>

        {/* Clear Button (Visible when text entered) */}
        {commandInputText && (
          <button
            type="button"
            onClick={handleClear}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-slate-800/60 transition-colors"
            title="Clear text"
          >
            <X className="h-4 w-4" />
          </button>
        )}

        {/* Send Button */}
        <button
          type="submit"
          disabled={!commandInputText.trim() || isProcessing}
          className={`ml-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold flex items-center space-x-1.5 transition-all duration-200 ${
            commandInputText.trim() && !isProcessing
              ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30'
              : 'bg-slate-800/60 text-slate-600 cursor-not-allowed'
          }`}
        >
          <span>Send</span>
          <CornerDownLeft className="h-3.5 w-3.5 opacity-80" />
        </button>
      </form>

      {/* Input keyboard & speech hint */}
      <div className="flex items-center justify-between px-3 mt-2 text-[11px] text-slate-500 font-mono">
        <span className="flex items-center space-x-1.5 truncate">
          <Sparkles className="h-3 w-3 text-cyan-400 flex-shrink-0" />
          <span>
            {voiceLanguage === 'hi-IN'
              ? 'हिन्दी आवाज़ &bull; English Speech &bull; Keyboard Commands'
              : 'Speech-to-Text &bull; Browser TTS &bull; Procedural Commands'}
          </span>
        </span>
        <span className="hidden sm:inline">Press Enter ↵ to dispatch</span>
      </div>
    </div>
  );
}
