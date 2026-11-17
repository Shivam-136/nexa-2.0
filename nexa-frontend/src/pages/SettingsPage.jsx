import React, { useState } from 'react';
import {
  Settings,
  Cpu,
  Mic,
  Monitor,
  Save,
  RotateCcw,
  Volume2,
  VolumeX,
  CheckCircle2,
  AlertTriangle,
  Play,
  Square,
  Globe,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { APP_CONFIG, API_ENDPOINTS, VOICE_LANGUAGES } from '../utils/constants';

export default function SettingsPage() {
  const {
    addToast,
    isVoiceSupported,
    micPermission,
    requestMicrophoneAccess,
    voiceLanguage,
    setVoiceLanguage,
    isSynthesisSupported,
    ttsEnabled,
    setTtsEnabled,
    voices,
    selectedVoiceURI,
    setSelectedVoiceURI,
    speechRate,
    setSpeechRate,
    speechPitch,
    setSpeechPitch,
    isSpeaking,
    testVoice,
    stopSpeaking,
  } = useAppContext();

  const [settings, setSettings] = useState({
    operatorName: 'Operator',
    audioChimes: true,
    llmProvider: 'local-ollama',
    ollamaEndpoint: 'http://localhost:11434',
    geminiGateway: 'http://localhost:8000/api/v1/reasoning',
    desktopDaemonUrl: API_ENDPOINTS.DESKTOP_BRIDGE_URL,
    autoReconnect: true,
  });

  const [isTestingMic, setIsTestingMic] = useState(false);

  const handleTestMic = async () => {
    setIsTestingMic(true);
    const res = await requestMicrophoneAccess();
    setIsTestingMic(false);
    if (res.granted) {
      addToast('Microphone Verified', 'Browser microphone access granted and functional.', 'success');
    } else {
      addToast('Microphone Check Failed', res.error || 'Access denied by browser.', 'error');
    }
  };

  const handleSave = (e) => {
    e.preventDefault();
    addToast('Settings Saved', 'Operator preferences and voice configuration updated.', 'success');
  };

  const handleReset = () => {
    setSpeechRate(1.0);
    setSpeechPitch(1.0);
    setTtsEnabled(true);
    setVoiceLanguage('en-US');
    addToast('Defaults Restored', 'Configuration settings returned to default baseline.', 'info');
  };

  return (
    <div className="flex-1 w-full max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-6 rounded-3xl glass-panel gap-4">
        <div>
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-blue-500/10 text-cyan-400 border border-blue-500/20">
              <Settings className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">System Configuration</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Manage AI reasoning endpoints, desktop bridge sockets, voice parameters, and Web Speech settings.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={handleReset}
            className="inline-flex items-center space-x-1.5 px-3.5 py-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span>Reset</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all"
          >
            <Save className="h-3.5 w-3.5" />
            <span>Save Configuration</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 1: AI Reasoning Model Gateway */}
        <div className="p-6 rounded-3xl glass-card space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3">
            <Cpu className="h-4 w-4 text-cyan-400" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
              AI Reasoning Engine Configuration
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-300 font-medium mb-1.5">
                Inference Provider Mode
              </label>
              <select
                value={settings.llmProvider}
                onChange={(e) => setSettings({ ...settings, llmProvider: e.target.value })}
                className="w-full px-3 py-2 rounded-xl glass-input text-slate-200 focus:outline-none focus:border-blue-500/60"
              >
                <option value="local-ollama" className="bg-slate-900">Local LLM (Ollama Engine)</option>
                <option value="gemini-gateway" className="bg-slate-900">Cloud AI Gateway (Gemini API)</option>
                <option value="hybrid" className="bg-slate-900">Hybrid Adaptive Engine</option>
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                Zero secret keys are stored in frontend. All model calls route via backend proxy.
              </p>
            </div>

            <div>
              <label className="block text-slate-300 font-medium mb-1.5">
                Local Ollama Host Endpoint
              </label>
              <input
                type="text"
                value={settings.ollamaEndpoint}
                onChange={(e) => setSettings({ ...settings, ollamaEndpoint: e.target.value })}
                className="w-full px-3 py-2 rounded-xl glass-input text-slate-200 font-mono text-[11px] focus:outline-none focus:border-blue-500/60"
              />
              <p className="text-[11px] text-slate-500 mt-1">Default local port for Ollama daemon.</p>
            </div>
          </div>
        </div>

        {/* Section 2: Desktop Operator Daemon Bridge */}
        <div className="p-6 rounded-3xl glass-card space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3">
            <Monitor className="h-4 w-4 text-blue-400" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
              Desktop Automation Bridge (Phase 3)
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-300 font-medium mb-1.5">
                WebSocket Bridge URI
              </label>
              <input
                type="text"
                value={settings.desktopDaemonUrl}
                onChange={(e) => setSettings({ ...settings, desktopDaemonUrl: e.target.value })}
                className="w-full px-3 py-2 rounded-xl glass-input text-slate-200 font-mono text-[11px] focus:outline-none focus:border-blue-500/60"
              />
              <p className="text-[11px] text-slate-500 mt-1">Local workstation IPC daemon address.</p>
            </div>

            <div className="flex items-center space-x-3 pt-6">
              <input
                type="checkbox"
                id="autoReconnect"
                checked={settings.autoReconnect}
                onChange={(e) => setSettings({ ...settings, autoReconnect: e.target.checked })}
                className="rounded border-slate-700 text-blue-600 focus:ring-0 bg-slate-900 h-4 w-4"
              />
              <label htmlFor="autoReconnect" className="text-slate-300 text-xs">
                Auto-reconnect to Desktop Daemon when available
              </label>
            </div>
          </div>
        </div>

        {/* Section 3: Browser Voice Engine (Web Speech STT & TTS) */}
        <div className="p-6 rounded-3xl glass-card space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-2">
              <Mic className="h-4 w-4 text-cyan-400" />
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
                Web Speech Voice Interaction &amp; Audio Synthesis
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                  isVoiceSupported
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                STT: {isVoiceSupported ? 'SUPPORTED' : 'UNSUPPORTED'}
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                  isSynthesisSupported
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}
              >
                TTS: {isSynthesisSupported ? 'ACTIVE' : 'OFF'}
              </span>
            </div>
          </div>

          {/* Sub-grid: Microphone & Language Settings */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
            {/* Microphone Permission Status */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Microphone Access</span>
                <span
                  className={`px-2 py-0.5 rounded-md font-mono text-[10px] uppercase font-bold ${
                    micPermission === 'granted'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : micPermission === 'denied'
                      ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}
                >
                  {micPermission}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                NEXA 2.0 captures voice locally using the browser's native Web Speech Recognition API. Audio is processed directly in-browser.
              </p>
              <button
                type="button"
                onClick={handleTestMic}
                disabled={isTestingMic}
                className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors flex items-center justify-center space-x-1.5"
              >
                <Mic className="h-3.5 w-3.5 text-cyan-400" />
                <span>{isTestingMic ? 'Checking Access...' : 'Request / Verify Microphone Access'}</span>
              </button>
            </div>

            {/* Language Selection */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Recognition Language</span>
                <span className="font-mono text-cyan-400 text-[11px]">{voiceLanguage}</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Choose the primary spoken language for continuous speech transcription and synthesis.
              </p>
              <div className="grid grid-cols-2 gap-2 pt-1">
                {VOICE_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    type="button"
                    onClick={() => setVoiceLanguage(lang.code)}
                    className={`py-2 px-3 rounded-xl font-medium text-xs transition-all border flex items-center justify-center space-x-2 ${
                      voiceLanguage === lang.code
                        ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300 font-semibold shadow-sm'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    <Globe className="h-3.5 w-3.5" />
                    <span>{lang.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Sub-grid: Text-to-Speech Settings */}
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-4 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800/80 pb-3">
              <div>
                <span className="font-semibold text-slate-200 text-sm">Speech Synthesis (TTS) Engine</span>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Natural spoken responses generated through the browser's native SpeechSynthesis API.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTtsEnabled(!ttsEnabled)}
                className={`px-3 py-1.5 rounded-xl font-semibold text-xs transition-colors flex items-center space-x-1.5 ${
                  ttsEnabled
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    : 'bg-slate-800 text-slate-400 border border-slate-700'
                }`}
              >
                {ttsEnabled ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                <span>{ttsEnabled ? 'Speech Output Enabled' : 'Speech Output Muted'}</span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Voice Selection */}
              <div className="md:col-span-1">
                <label className="block text-slate-300 font-medium mb-1.5">
                  Synthesizer Voice ({voices.length} detected)
                </label>
                <select
                  value={selectedVoiceURI}
                  onChange={(e) => setSelectedVoiceURI(e.target.value)}
                  disabled={!isSynthesisSupported || voices.length === 0}
                  className="w-full px-3 py-2 rounded-xl glass-input text-slate-200 text-xs focus:outline-none focus:border-cyan-500/60 disabled:opacity-50"
                >
                  {voices.map((v) => (
                    <option key={v.voiceURI} value={v.voiceURI} className="bg-slate-900">
                      {v.name} ({v.lang}) {v.default ? '★' : ''}
                    </option>
                  ))}
                  {voices.length === 0 && (
                    <option value="" className="bg-slate-900">Browser default voice</option>
                  )}
                </select>
              </div>

              {/* Speech Rate Slider */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-slate-300 font-medium">Speech Rate</span>
                  <span className="text-slate-400 font-mono">{speechRate.toFixed(1)}x</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="2.0"
                  step="0.1"
                  value={speechRate}
                  onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
              </div>

              {/* Speech Pitch Slider */}
              <div>
                <div className="flex justify-between mb-1.5">
                  <span className="text-slate-300 font-medium">Pitch Modulation</span>
                  <span className="text-slate-400 font-mono">{speechPitch.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="1.5"
                  step="0.1"
                  value={speechPitch}
                  onChange={(e) => setSpeechPitch(parseFloat(e.target.value))}
                  className="w-full accent-cyan-400 bg-slate-800 h-1.5 rounded-lg cursor-pointer"
                />
              </div>
            </div>

            {/* Test Voice Button Row */}
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={() =>
                  testVoice(
                    voiceLanguage === 'hi-IN'
                      ? 'नमस्ते, नेक्सा 2.0 आवाज़ परीक्षण सफल रहा।'
                      : 'NEXA 2.0 neural operator speech synthesis test complete. Audio channels operational.'
                  )
                }
                className="py-2 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-slate-950 font-semibold text-xs transition-colors flex items-center space-x-1.5 shadow-md shadow-cyan-600/20"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                <span>Test Voice Output ({voiceLanguage === 'hi-IN' ? 'Hindi' : 'English'})</span>
              </button>

              {isSpeaking && (
                <button
                  type="button"
                  onClick={stopSpeaking}
                  className="py-2 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs transition-colors flex items-center space-x-1.5"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  <span>Stop Playback</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Section 4: About NEXA 2.0 */}
        <div className="p-6 rounded-3xl glass-card flex flex-col sm:flex-row sm:items-center justify-between text-xs gap-4">
          <div>
            <h4 className="font-bold text-white text-sm flex items-center space-x-2">
              <span>{APP_CONFIG.NAME}</span>
              <span className="px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 text-[10px] font-mono">
                v{APP_CONFIG.VERSION}
              </span>
            </h4>
            <p className="text-slate-400 mt-1">
              AI-Powered Personal Computer Operator &bull; Modern Decoupled Architecture
            </p>
          </div>

          <div className="text-slate-500 font-mono text-[11px]">
            Frontend: React 18 + Vite 5 + Web Speech API &bull; Phase 3 Voice Active
          </div>
        </div>
      </form>
    </div>
  );
}
