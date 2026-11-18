import React, { useState, useEffect, useCallback } from 'react';
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
  Trash2,
  RefreshCw,
  ShieldCheck,
  Server,
  Sparkles,
  Database,
  Brain,
  UserCheck,
  User,
  Shield,
  DownloadCloud,
  Check,
  AlertCircle,
  Radio,
} from 'lucide-react';
import { useAppContext } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import {
  APP_CONFIG,
  API_ENDPOINTS,
  VOICE_LANGUAGES,
  DEFAULT_AI_PROVIDER,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_GEMINI_FALLBACK,
  SUPPORTED_AI_PROVIDERS,
} from '../utils/constants';
import { checkOllamaStatus } from '../services/chat.service';
import StatusBadge from '../components/common/StatusBadge';
import MemoryManagement from '../components/settings/MemoryManagement';

/**
 * Validates that an Ollama base URL strictly targets a safe local loopback endpoint.
 * Prevents SSRF attacks and remote network exposure.
 */
function validateLoopbackUrl(urlStr) {
  if (!urlStr || typeof urlStr !== 'string' || !urlStr.trim()) {
    return 'Ollama Base URL cannot be empty.';
  }
  let parsed;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    return 'Invalid URL format. Expected e.g. http://127.0.0.1:11434';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Only HTTP and HTTPS protocols are supported.';
  }
  if (parsed.username || parsed.password) {
    return 'Base URL must not contain embedded credentials.';
  }
  if (parsed.search || parsed.hash) {
    return 'Base URL must not contain query parameters or fragments.';
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/.test(host);
  if (!isLoopback) {
    return 'Security restriction: Only local loopback endpoints (127.0.0.1, localhost, ::1) are permitted.';
  }
  return '';
}

export default function SettingsPage() {
  const {
    addToast,
    connectionStatus,
    refreshBackendStatus,
    clearConversation,
    messages,
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

  const { user, updatePreferences, claimLegacy } = useAuth();

  const [settings, setSettings] = useState({
    operatorName: 'Operator',
    apiBaseUrl: API_ENDPOINTS.BASE_URL,
    desktopDaemonUrl: API_ENDPOINTS.DESKTOP_BRIDGE_URL,
    autoReconnect: true,
  });

  const [profileState, setProfileState] = useState({
    displayName: user?.displayName || '',
    aiProvider: user?.aiProvider || DEFAULT_AI_PROVIDER,
    ollamaModel: user?.ollamaModel || DEFAULT_OLLAMA_MODEL,
    ollamaBaseUrl: user?.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL,
    geminiFallback: typeof user?.geminiFallback === 'boolean' ? user.geminiFallback : DEFAULT_GEMINI_FALLBACK,
    voiceLanguage: user?.voiceLanguage || 'en-US',
  });

  // Synchronize profile state when authenticated user preferences load/update
  useEffect(() => {
    if (user) {
      setProfileState({
        displayName: user.displayName || '',
        aiProvider: user.aiProvider || DEFAULT_AI_PROVIDER,
        ollamaModel: user.ollamaModel || DEFAULT_OLLAMA_MODEL,
        ollamaBaseUrl: user.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL,
        geminiFallback: typeof user.geminiFallback === 'boolean' ? user.geminiFallback : DEFAULT_GEMINI_FALLBACK,
        voiceLanguage: user.voiceLanguage || 'en-US',
      });
    }
  }, [user]);

  // Ollama Connection Telemetry State
  const [ollamaStatus, setOllamaStatus] = useState({
    isConnected: false,
    status: 'untested',
    models: [],
    error: null,
  });
  const [isTestingOllama, setIsTestingOllama] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [urlValidationError, setUrlValidationError] = useState('');

  const [isTestingMic, setIsTestingMic] = useState(false);
  const [isPingingBackend, setIsPingingBackend] = useState(false);
  const [isClaimingLegacy, setIsClaimingLegacy] = useState(false);

  // Quiet initial connection test on mount
  useEffect(() => {
    let mounted = true;
    checkOllamaStatus({ baseUrl: profileState.ollamaBaseUrl })
      .then((res) => {
        if (mounted) {
          setOllamaStatus({
            isConnected: res.isConnected,
            status: res.status,
            models: res.models || [],
            error: res.error || null,
          });
        }
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const handleTestOllamaConnection = useCallback(async () => {
    const errorMsg = validateLoopbackUrl(profileState.ollamaBaseUrl);
    if (errorMsg) {
      setUrlValidationError(errorMsg);
      addToast('Invalid Ollama URL', errorMsg, 'error');
      return;
    }
    setUrlValidationError('');
    setIsTestingOllama(true);

    try {
      const res = await checkOllamaStatus({ baseUrl: profileState.ollamaBaseUrl });
      setOllamaStatus({
        isConnected: res.isConnected,
        status: res.status,
        models: res.models || [],
        error: res.error || null,
      });

      if (res.isConnected) {
        addToast(
          'Ollama Connection Verified',
          `Connected to ${res.baseUrl}. Found ${res.models?.length || 0} installed model(s).`,
          'success'
        );
      } else {
        addToast(
          'Ollama Connection Failed',
          res.error || 'Could not connect to Ollama daemon on loopback. Ensure `ollama serve` is running.',
          'error'
        );
      }
    } catch (err) {
      setOllamaStatus({
        isConnected: false,
        status: 'disconnected',
        models: [],
        error: err.message,
      });
      addToast('Connection Check Error', err.message, 'error');
    } finally {
      setIsTestingOllama(false);
    }
  }, [profileState.ollamaBaseUrl, addToast]);

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

  const handlePingBackend = async () => {
    setIsPingingBackend(true);
    const health = await refreshBackendStatus();
    setIsPingingBackend(false);
    if (health.isOnline) {
      addToast(
        'Backend Online',
        `NEXA Core online. Gemini: ${health.geminiConfigured ? 'Configured' : 'Missing Key'} • Ollama: ${health.ollama?.isConnected ? 'Connected' : 'Offline'}.`,
        'success'
      );
    } else {
      addToast(
        'Backend Offline',
        health.error || 'Could not connect to http://localhost:5000.',
        'error'
      );
    }
  };

  const handleClaimLegacyClick = async () => {
    setIsClaimingLegacy(true);
    try {
      const res = await claimLegacy();
      addToast(
        'Legacy Migration Complete',
        res.message || 'Legacy records claimed successfully.',
        'success'
      );
    } catch (err) {
      addToast('Migration Error', err.message || 'Could not claim legacy records.', 'error');
    } finally {
      setIsClaimingLegacy(false);
    }
  };

  const handleSave = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const errorMsg = validateLoopbackUrl(profileState.ollamaBaseUrl);
    if (errorMsg) {
      setUrlValidationError(errorMsg);
      addToast('Cannot Save Preferences', errorMsg, 'error');
      return;
    }
    setUrlValidationError('');
    setIsSaving(true);
    try {
      if (updatePreferences) {
        await updatePreferences(profileState);
      }
      addToast('Settings Saved', 'Operator preferences and AI configuration updated successfully.', 'success');
    } catch (err) {
      addToast('Save Failed', err.message || 'Failed to update preferences.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setSpeechRate(1.0);
    setSpeechPitch(1.0);
    setTtsEnabled(true);
    setVoiceLanguage('en-US');
    setUrlValidationError('');
    setProfileState({
      displayName: user?.displayName || '',
      aiProvider: DEFAULT_AI_PROVIDER,
      ollamaModel: DEFAULT_OLLAMA_MODEL,
      ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
      geminiFallback: DEFAULT_GEMINI_FALLBACK,
      voiceLanguage: 'en-US',
    });
    addToast('Defaults Restored', 'Configuration settings returned to Ollama-first default baseline.', 'info');
  };

  const isBackendOnline = connectionStatus.backend === 'Connected';
  const isAiActive = connectionStatus.aiBrain?.includes('Active');

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
                Manage AI provider preferences, Ollama local engine, cloud fallbacks, and audio synthesis.
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
            <span>Reset Defaults</span>
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="inline-flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-semibold shadow-lg shadow-blue-600/30 transition-all cursor-pointer"
          >
            <Save className={`h-3.5 w-3.5 ${isSaving ? 'animate-spin' : ''}`} />
            <span>{isSaving ? 'Saving...' : 'Save Configuration'}</span>
          </button>
        </div>
      </div>

      <form onSubmit={handleSave} className="space-y-6">
        {/* Section 0: Operator Identity & Multi-Tenant Preferences */}
        <div className="p-6 rounded-3xl glass-card space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-2">
              <UserCheck className="h-4 w-4 text-blue-400" />
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
                Operator Identity &amp; Multi-Tenant Profile
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono border bg-blue-500/10 text-blue-400 border-blue-500/20 flex items-center space-x-1">
                <Shield className="h-3 w-3" />
                <span>USER_ISOLATION_ACTIVE</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 text-xs">
            {/* Operator Account Info */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Account Credentials</span>
                <span className="font-mono text-[10px] text-slate-400">ID: {user?.id?.slice(-8) || 'LOCAL'}</span>
              </div>
              <div className="space-y-2">
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Email (Authenticated)</label>
                  <input
                    type="text"
                    disabled
                    value={user?.email || 'operator@nexa.ai'}
                    className="w-full px-3 py-1.5 rounded-xl bg-slate-900/50 border border-slate-800 text-slate-400 font-mono text-[11px]"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-slate-400 block mb-1">Display Name</label>
                  <input
                    type="text"
                    value={profileState.displayName}
                    onChange={(e) => setProfileState({ ...profileState, displayName: e.target.value })}
                    placeholder="Operator"
                    className="w-full px-3 py-1.5 rounded-xl glass-input text-slate-200 text-xs focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            {/* Legacy Data Claim */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Session & Data Migration</span>
                <span className="font-mono text-cyan-400 text-[11px]">PHASE 5/6 BRIDGE</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                If you created memories or conversation turns during early Phase 5 development under the legacy default namespace (<code className="text-cyan-300 font-mono">shivam</code>), claim them to your authenticated account.
              </p>
              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[11px] text-slate-400">Claim Legacy Records</span>
                <button
                  type="button"
                  onClick={handleClaimLegacyClick}
                  disabled={isClaimingLegacy}
                  className="px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-[11px] font-medium flex items-center space-x-1.5 transition-colors cursor-pointer"
                >
                  <DownloadCloud className={`h-3.5 w-3.5 ${isClaimingLegacy ? 'animate-bounce' : ''}`} />
                  <span>{isClaimingLegacy ? 'Claiming...' : 'Claim "shivam" Records'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Section 0.5: AI Provider Selection & Ollama Configuration (Milestone 2.4) */}
        <div className="p-6 rounded-3xl glass-card space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-2">
              <Brain className="h-4 w-4 text-cyan-400" />
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
                AI Provider Selection &amp; Engine Configuration
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-mono border bg-cyan-500/10 text-cyan-400 border-cyan-500/20 flex items-center space-x-1">
                <Sparkles className="h-3 w-3" />
                <span>ACTIVE: {profileState.aiProvider.toUpperCase()}</span>
              </span>
            </div>
          </div>

          {/* Provider Selection Radio Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SUPPORTED_AI_PROVIDERS.map((provider) => {
              const isSelected = profileState.aiProvider === provider.id;
              return (
                <div
                  key={provider.id}
                  onClick={() => setProfileState({ ...profileState, aiProvider: provider.id })}
                  className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between space-y-3 ${
                    isSelected
                      ? 'bg-blue-950/40 border-cyan-500/60 shadow-lg shadow-cyan-950/40'
                      : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2.5">
                      <div className={`p-2 rounded-xl border ${
                        isSelected
                          ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                          : 'bg-slate-900 text-slate-400 border-slate-800'
                      }`}>
                        {provider.id === 'ollama' ? <Cpu className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
                      </div>
                      <div>
                        <h4 className="font-semibold text-slate-200 text-sm flex items-center space-x-2">
                          <span>{provider.name}</span>
                          {provider.recommended && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                              RECOMMENDED
                            </span>
                          )}
                        </h4>
                        <span className="text-[10px] font-mono text-cyan-400">{provider.badge}</span>
                      </div>
                    </div>

                    <div className={`h-4 w-4 rounded-full border flex items-center justify-center ${
                      isSelected ? 'border-cyan-400 bg-cyan-500' : 'border-slate-700 bg-slate-900'
                    }`}>
                      {isSelected && <div className="h-1.5 w-1.5 rounded-full bg-slate-950"></div>}
                    </div>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {provider.description}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Detailed Ollama Configuration Block */}
          <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800/90 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
              <div className="flex items-center space-x-2">
                <Cpu className="h-4 w-4 text-cyan-400" />
                <span className="font-semibold text-slate-200">Local Ollama Service Parameters</span>
              </div>
              <div className="flex items-center space-x-2">
                <StatusBadge
                  status={ollamaStatus.isConnected ? 'ready' : ollamaStatus.status === 'untested' ? 'pending' : 'disconnected'}
                  label={ollamaStatus.isConnected ? 'Ollama Online' : ollamaStatus.status === 'untested' ? 'Untested' : 'Ollama Offline'}
                  size="xs"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Ollama Base URL & Test Connection */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-300 font-medium block">
                  Ollama Base URL (Loopback Only)
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={profileState.ollamaBaseUrl}
                    onChange={(e) => {
                      setProfileState({ ...profileState, ollamaBaseUrl: e.target.value });
                      setUrlValidationError(validateLoopbackUrl(e.target.value));
                    }}
                    placeholder="http://127.0.0.1:11434"
                    className={`flex-1 px-3 py-1.5 rounded-xl glass-input text-slate-200 text-xs font-mono focus:outline-none ${
                      urlValidationError ? 'border-rose-500 focus:border-rose-500' : 'focus:border-cyan-500'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={handleTestOllamaConnection}
                    disabled={isTestingOllama}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 font-medium text-xs border border-slate-700 transition-colors flex items-center space-x-1.5 cursor-pointer disabled:opacity-50 flex-shrink-0"
                    title="Test connectivity to Ollama"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 text-cyan-400 ${isTestingOllama ? 'animate-spin' : ''}`} />
                    <span>{isTestingOllama ? 'Testing...' : 'Test Connection'}</span>
                  </button>
                </div>

                {urlValidationError ? (
                  <p className="text-[10px] text-rose-400 flex items-center space-x-1 pt-0.5">
                    <AlertCircle className="h-3 w-3 flex-shrink-0" />
                    <span>{urlValidationError}</span>
                  </p>
                ) : (
                  <p className="text-[10px] text-slate-500 leading-tight">
                    Must be a local loopback endpoint (<code className="text-cyan-400 font-mono">127.0.0.1</code>, <code className="text-cyan-400 font-mono">localhost</code>, or <code className="text-cyan-400 font-mono">::1</code>).
                  </p>
                )}

                {/* Status Feedback banner */}
                {ollamaStatus.isConnected ? (
                  <div className="p-2 rounded-xl bg-emerald-950/30 border border-emerald-800/40 text-emerald-300 text-[11px] flex items-center space-x-2 mt-1">
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 flex-shrink-0" />
                    <span>Daemon active. {ollamaStatus.models?.length || 0} local model(s) detected.</span>
                  </div>
                ) : ollamaStatus.error ? (
                  <div className="p-2 rounded-xl bg-rose-950/30 border border-rose-800/40 text-rose-300 text-[11px] flex items-start space-x-2 mt-1">
                    <AlertTriangle className="h-3.5 w-3.5 text-rose-400 flex-shrink-0 mt-0.5" />
                    <span className="leading-tight">{ollamaStatus.error}</span>
                  </div>
                ) : null}
              </div>

              {/* Ollama Model Selection */}
              <div className="space-y-1.5">
                <label className="text-[11px] text-slate-300 font-medium block">
                  Ollama Inference Model
                </label>
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    value={profileState.ollamaModel}
                    onChange={(e) => setProfileState({ ...profileState, ollamaModel: e.target.value })}
                    placeholder="llama3.2"
                    className="flex-1 px-3 py-1.5 rounded-xl glass-input text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-500"
                  />
                  {ollamaStatus.models?.length > 0 && (
                    <select
                      value={ollamaStatus.models.includes(profileState.ollamaModel) ? profileState.ollamaModel : ''}
                      onChange={(e) => {
                        if (e.target.value) setProfileState({ ...profileState, ollamaModel: e.target.value });
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-700 text-slate-200 text-xs focus:outline-none cursor-pointer"
                    >
                      <option value="">Detected ({ollamaStatus.models.length})...</option>
                      {ollamaStatus.models.map((modelName) => (
                        <option key={modelName} value={modelName}>
                          {modelName}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <p className="text-[10px] text-slate-500 leading-tight">
                  Default: <code className="text-cyan-400 font-mono">llama3.2</code>. You can also specify other installed tags (e.g. <code className="text-slate-400 font-mono">mistral</code>, <code className="text-slate-400 font-mono">qwen2.5</code>).
                </p>
              </div>
            </div>

            {/* Gemini Fallback Toggle */}
            <div className="p-3 rounded-xl bg-slate-900/80 border border-slate-800/80 flex items-start justify-between gap-3 pt-3">
              <div className="space-y-0.5 flex-1">
                <div className="flex items-center space-x-2">
                  <span className="text-slate-200 font-semibold text-xs">Enable Google Gemini Cloud Fallback</span>
                  <span className="px-1.5 py-0.5 rounded text-[9px] font-mono bg-amber-500/20 text-amber-300 border border-amber-500/30">
                    EXPLICIT ONLY
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  If Ollama is unreachable, model missing, or inference times out, automatically fall back to Google Gemini to prevent disruptions.
                </p>
                <p className="text-[10px] text-slate-500">
                  🛡️ Fallbacks are never silent. An explicit warning badge and toast will notify you whenever cloud fallback is invoked.
                </p>
              </div>
              <input
                type="checkbox"
                id="geminiFallbackToggle"
                checked={profileState.geminiFallback}
                onChange={(e) => setProfileState({ ...profileState, geminiFallback: e.target.checked })}
                className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-blue-600 focus:ring-0 cursor-pointer mt-1"
              />
            </div>
          </div>
        </div>

        {/* Section 1: AI Reasoning & Backend Status (Phase 4 Gemini Integration) */}
        <div className="p-6 rounded-3xl glass-card space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-2">
              <Cpu className="h-4 w-4 text-cyan-400" />
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
                AI Brain &amp; Backend Telemetry
              </h3>
            </div>
            <div className="flex items-center space-x-2">
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono border flex items-center space-x-1 ${
                  isBackendOnline
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}
              >
                <Server className="h-3 w-3" />
                <span>BACKEND: {connectionStatus.backend.toUpperCase()}</span>
              </span>

              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono border flex items-center space-x-1 ${
                  connectionStatus.database === 'Connected'
                    ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                <Database className="h-3 w-3" />
                <span>DB: {connectionStatus.database?.toUpperCase() || 'OFFLINE'}</span>
              </span>

              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono border flex items-center space-x-1 ${
                  isAiActive
                    ? 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20'
                    : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                <Sparkles className="h-3 w-3" />
                <span>AI BRAIN: {connectionStatus.aiBrain}</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            {/* Backend Service Status Card */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Express Backend</span>
                <span
                  className={`px-2 py-0.5 rounded-md font-mono text-[10px] uppercase font-bold ${
                    isBackendOnline
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  {connectionStatus.backend}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Connects to the Express service on port 5000. Handles authentication, validation, and AI provider routing.
              </p>
              <div className="flex items-center space-x-2 pt-1">
                <input
                  type="text"
                  value={settings.apiBaseUrl}
                  onChange={(e) => setSettings({ ...settings, apiBaseUrl: e.target.value })}
                  className="flex-1 px-3 py-1.5 rounded-xl glass-input text-slate-200 font-mono text-[11px] focus:outline-none focus:border-cyan-500/60"
                  placeholder="http://localhost:5000/api"
                />
                <button
                  type="button"
                  onClick={handlePingBackend}
                  disabled={isPingingBackend}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium transition-colors flex items-center space-x-1.5 flex-shrink-0 cursor-pointer"
                  title="Ping backend health endpoint"
                >
                  <RefreshCw className={`h-3.5 w-3.5 text-cyan-400 ${isPingingBackend ? 'animate-spin' : ''}`} />
                  <span>Check</span>
                </button>
              </div>
            </div>

            {/* Ollama Service Status Card */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Ollama Local Engine</span>
                <span
                  className={`px-2 py-0.5 rounded-md font-mono text-[10px] uppercase font-bold ${
                    ollamaStatus.isConnected
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                  }`}
                >
                  {ollamaStatus.isConnected ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Local on-device inference via native Ollama REST API. Model: <code className="text-cyan-300 font-mono">{profileState.ollamaModel}</code>.
              </p>
              <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center space-x-2 text-[11px] text-slate-400">
                <ShieldCheck className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                <span className="truncate">
                  {ollamaStatus.isConnected
                    ? `${ollamaStatus.models?.length || 0} local model(s) ready on loopback.`
                    : 'Run `ollama serve` to activate local engine.'}
                </span>
              </div>
            </div>

            {/* Google Gemini Cloud Status Card */}
            <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-200">Google Gemini Cloud</span>
                <span className="font-mono text-cyan-400 text-[11px]">{connectionStatus.aiBrain}</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Multilingual reasoning via Google Gen AI SDK. API key is secured inside <code className="text-cyan-300">nexa-backend/.env</code>.
              </p>
              <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center space-x-2 text-[11px] text-slate-400">
                <ShieldCheck className="h-4 w-4 text-emerald-400 flex-shrink-0" />
                <span>
                  API keys are never transmitted to browser clients.
                </span>
              </div>
            </div>
          </div>

          {/* Conversation Management Strip */}
          <div className="p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
            <div>
              <span className="font-semibold text-slate-200">Active Conversation Memory</span>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Current thread contains <span className="text-cyan-400 font-mono">{messages.length}</span> message(s). Context is maintained during the active browser session.
              </p>
            </div>
            <button
              type="button"
              onClick={clearConversation}
              className="px-3.5 py-2 rounded-xl bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/60 text-rose-300 text-xs font-medium transition-colors flex items-center space-x-1.5 self-start sm:self-auto"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Clear Session Dialogue</span>
            </button>
          </div>
        </div>

        {/* Section 2: Persistent User Memory System (Phase 5 MongoDB Integration) */}
        <MemoryManagement addToast={addToast} />

        {/* Section 3: Browser Voice Engine (Web Speech STT & TTS) */}
        <div className="p-6 rounded-3xl glass-card space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
            <div className="flex items-center space-x-2">
              <Mic className="h-4 w-4 text-cyan-400" />
              <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
                Voice Response &amp; Speech Synthesis Settings
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
                  ttsEnabled && isSynthesisSupported
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                }`}
              >
                TTS: {ttsEnabled && isSynthesisSupported ? 'ACTIVE' : 'MUTED'}
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
                {ttsEnabled ? <Volume2 className="h-3.5 w-3.5 text-emerald-400" /> : <VolumeX className="h-3.5 w-3.5 text-slate-500" />}
                <span>{ttsEnabled ? 'Voice Responses Enabled' : 'Voice Responses Muted'}</span>
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

        {/* Section 3: Desktop Operator Daemon Bridge */}
        <div className="p-6 rounded-3xl glass-card space-y-4">
          <div className="flex items-center space-x-2 border-b border-slate-800/80 pb-3">
            <Monitor className="h-4 w-4 text-blue-400" />
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-300 font-semibold">
              Desktop Automation Bridge
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
              AI-Powered Personal Computer Operator &bull; Ollama-First AI Engine
            </p>
          </div>

          <div className="text-slate-500 font-mono text-[11px]">
            Node Express + Ollama Local Core &bull; Optional Gemini Cloud Fallback
          </div>
        </div>
      </form>
    </div>
  );
}
