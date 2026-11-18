import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { APP_CONFIG, ASSISTANT_STATES } from '../utils/constants';
import { useVoiceRecognition } from '../hooks/useVoiceRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { checkMicrophonePermission } from '../services/voice.service';
import { sendChatMessage, checkBackendHealth, checkOllamaStatus } from '../services/chat.service';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [assistantState, setAssistantState] = useState(ASSISTANT_STATES.IDLE);
  const [voiceErrorMessage, setVoiceErrorMessage] = useState('');
  const [commandInputText, setCommandInputText] = useState('');
  const [conversationId, setConversationId] = useState(null);

  // Selected language for speech recognition and synthesis ('en-US' or 'hi-IN')
  const [voiceLanguage, setVoiceLanguageState] = useState('en-US');

  // Connection States
  const [connectionStatus, setConnectionStatus] = useState({
    core: 'Ready',
    backend: 'Checking...',
    aiBrain: 'Checking...',
    ollama: 'Checking...',
    database: 'Checking...',
    desktopAgent: 'Not Connected',
    browserAutomation: 'Standby',
    audioEngine: 'Initializing...',
    memoryUsage: '--',
    latency: '--',
  });

  // Notifications / Toast system
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((title, description, type = 'info') => {
    const id = Date.now() + Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, title, description, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Real session activity log
  const [recentActivity, setRecentActivity] = useState([]);

  // Active Tasks
  const [activeTasks, setActiveTasks] = useState([]);

  // Session messages / command history
  const [messages, setMessages] = useState([
    {
      id: 'msg-init',
      sender: 'assistant',
      text: 'Good day, Operator. NEXA 2.0 AI Brain is connected and voice interaction is ready. How can I assist your workflow today?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  // Ref to track conversationId & assistantState for async callbacks
  const conversationIdRef = useRef(conversationId);
  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  const assistantStateRef = useRef(assistantState);
  useEffect(() => {
    assistantStateRef.current = assistantState;
  }, [assistantState]);

  // Backend, AI Brain, Ollama & Database Health Check
  const refreshBackendStatus = useCallback(async () => {
    const health = await checkBackendHealth();
    let ollamaStatus = { isConnected: false, status: 'disconnected', models: [] };
    try {
      ollamaStatus = await checkOllamaStatus();
    } catch {
      // safe fallback if unauthenticated or offline
    }

    const dbRaw = health.details?.database?.status;
    const dbFormatted =
      dbRaw === 'connected' ? 'Connected' : dbRaw === 'disconnected' ? 'Disconnected' : dbRaw || (health.isOnline ? 'Online' : 'Offline');

    setConnectionStatus((prev) => ({
      ...prev,
      backend: health.isOnline ? 'Connected' : 'Disconnected',
      aiBrain: health.isOnline
        ? ollamaStatus.isConnected
          ? `Ollama Active (${ollamaStatus.models?.[0] || 'llama3.2'})`
          : health.geminiConfigured
          ? `Gemini Active (${health.model})`
          : 'Offline'
        : 'Offline',
      ollama: ollamaStatus.isConnected
        ? `Connected (${ollamaStatus.models?.length || 0} models)`
        : 'Disconnected',
      database: health.isOnline ? dbFormatted : 'Offline',
    }));
    return { ...health, ollama: ollamaStatus };
  }, []);

  useEffect(() => {
    refreshBackendStatus();
    // Periodically verify connection every 30 seconds
    const interval = setInterval(refreshBackendStatus, 30000);
    return () => clearInterval(interval);
  }, [refreshBackendStatus]);

  // ----------------------------------------------------
  // Speech Synthesis Hook (TTS)
  // ----------------------------------------------------
  const {
    isSupported: isSynthesisSupported,
    isSpeaking,
    isPaused: isSpeechPaused,
    ttsEnabled,
    setTtsEnabled,
    voices,
    englishVoices,
    hindiVoices,
    selectedVoice,
    selectedVoiceURI,
    setSelectedVoiceURI,
    speechRate,
    setSpeechRate,
    speechPitch,
    setSpeechPitch,
    speak: rawSpeak,
    stop: stopSpeaking,
    testVoice,
  } = useSpeechSynthesis({
    defaultRate: 1.0,
    defaultLang: voiceLanguage,
    defaultEnabled: true,
    onStart: () => {
      setAssistantState(ASSISTANT_STATES.SPEAKING);
    },
    onEnd: () => {
      // Return to IDLE when speech finishes
      setAssistantState((prev) => (prev === ASSISTANT_STATES.SPEAKING ? ASSISTANT_STATES.IDLE : prev));
    },
    onError: (err) => {
      // Set to ERROR when speech synthesis fails
      setAssistantState((prev) => (prev === ASSISTANT_STATES.SPEAKING ? ASSISTANT_STATES.ERROR : prev));
      if (err?.message && err.message !== 'canceled' && err.message !== 'interrupted') {
        addToast('Voice Output Error', err.message, 'warning');
      }
    },
  });

  // Track latest settings in refs for async callbacks
  const ttsEnabledRef = useRef(ttsEnabled);
  useEffect(() => {
    ttsEnabledRef.current = ttsEnabled;
  }, [ttsEnabled]);

  const voiceLanguageRef = useRef(voiceLanguage);
  useEffect(() => {
    voiceLanguageRef.current = voiceLanguage;
  }, [voiceLanguage]);

  const selectedVoiceRef = useRef(selectedVoice);
  useEffect(() => {
    selectedVoiceRef.current = selectedVoice;
  }, [selectedVoice]);

  // ----------------------------------------------------
  // Voice Recognition Hook (STT)
  // ----------------------------------------------------
  const handleFinalTranscript = useCallback((text) => {
    if (!text || !text.trim()) return;
    const clean = text.trim();
    // Automatically populate the existing command input without automatic execution
    setCommandInputText((prev) => {
      if (!prev) return clean;
      return prev.endsWith(' ') ? `${prev}${clean}` : `${prev} ${clean}`;
    });
  }, []);

  const handleVoiceError = useCallback((err) => {
    setAssistantState(ASSISTANT_STATES.ERROR);
    setVoiceErrorMessage(err.message || 'Voice recognition encountered an error.');
    addToast('Speech Recognition Alert', err.message || 'Error occurred during voice capture.', 'error');
  }, [addToast]);

  const {
    isSupported: isVoiceSupported,
    isListening,
    interimTranscript,
    finalTranscript,
    error: voiceError,
    permissionStatus: micPermission,
    startListening: rawStartListening,
    stopListening: rawStopListening,
    switchLanguage: rawSwitchLanguage,
    resetTranscript,
    requestMicrophoneAccess,
  } = useVoiceRecognition({
    defaultLang: voiceLanguage,
    continuous: true,
    interimResults: true,
    onFinalTranscript: handleFinalTranscript,
    onError: handleVoiceError,
  });

  // Synchronize Audio Engine connection status
  useEffect(() => {
    if (isVoiceSupported && isSynthesisSupported) {
      setConnectionStatus((prev) => ({ ...prev, audioEngine: 'Ready (Speech + STT)' }));
    } else if (isVoiceSupported) {
      setConnectionStatus((prev) => ({ ...prev, audioEngine: 'STT Ready (TTS Limited)' }));
    } else if (isSynthesisSupported) {
      setConnectionStatus((prev) => ({ ...prev, audioEngine: 'TTS Only (STT Unsupported)' }));
    } else {
      setConnectionStatus((prev) => ({ ...prev, audioEngine: 'Unsupported' }));
    }
  }, [isVoiceSupported, isSynthesisSupported]);

  // Language switcher supporting English and Hindi
  const setVoiceLanguage = useCallback((langCode) => {
    setVoiceLanguageState(langCode);
    rawSwitchLanguage(langCode);

    // If switching to Hindi, select a Hindi voice if available
    if (langCode.startsWith('hi')) {
      const hiVoice = hindiVoices.find((v) => v.lang.startsWith('hi'));
      if (hiVoice) {
        setSelectedVoiceURI(hiVoice.voiceURI);
      }
    } else if (langCode.startsWith('en')) {
      const enVoice = englishVoices.find((v) => v.lang.startsWith('en'));
      if (enVoice) {
        setSelectedVoiceURI(enVoice.voiceURI);
      }
    }

    const langName = langCode === 'hi-IN' ? 'Hindi (हिन्दी)' : 'English (US)';
    addToast('Language Updated', `Voice interaction switched to ${langName}.`, 'info');
  }, [rawSwitchLanguage, hindiVoices, englishVoices, setSelectedVoiceURI, addToast]);

  // Voice Recognition Controls
  const startListening = useCallback(async () => {
    if (!isVoiceSupported) {
      setAssistantState(ASSISTANT_STATES.ERROR);
      setVoiceErrorMessage('Web Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      addToast('Browser Unsupported', 'Web Speech Recognition requires Chrome, Edge, or a Chromium browser.', 'warning');
      return;
    }

    // Stop TTS if currently speaking
    if (isSpeaking) {
      stopSpeaking();
    }

    setAssistantState(ASSISTANT_STATES.LISTENING);
    setVoiceErrorMessage('');
    const started = await rawStartListening();
    if (!started) {
      setAssistantState(ASSISTANT_STATES.ERROR);
    }
  }, [isVoiceSupported, isSpeaking, stopSpeaking, rawStartListening, addToast]);

  const stopListening = useCallback(() => {
    rawStopListening();
    setAssistantState((prev) => (prev === ASSISTANT_STATES.LISTENING ? ASSISTANT_STATES.IDLE : prev));
  }, [rawStopListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
      addToast('Voice Capture Stopped', 'Microphone listener toggled off.', 'info');
    } else {
      startListening();
      addToast('Voice Listener Active', `Listening in ${voiceLanguage === 'hi-IN' ? 'Hindi' : 'English'}... Speak now.`, 'success');
    }
  }, [isListening, stopListening, startListening, voiceLanguage, addToast]);

  const clearVoiceError = useCallback(() => {
    setVoiceErrorMessage('');
    setAssistantState(ASSISTANT_STATES.IDLE);
  }, []);

  // AI Orb Click Handler
  const handleOrbClick = useCallback(() => {
    if (assistantState === ASSISTANT_STATES.SPEAKING) {
      stopSpeaking();
      setAssistantState(ASSISTANT_STATES.IDLE);
      addToast('Voice Output Silenced', 'Assistant speech playback stopped.', 'info');
    } else if (assistantState === ASSISTANT_STATES.LISTENING) {
      stopListening();
      addToast('Voice Input Stopped', 'Microphone listener deactivated.', 'info');
    } else if (assistantState === ASSISTANT_STATES.ERROR) {
      clearVoiceError();
    } else if (assistantState === ASSISTANT_STATES.IDLE) {
      startListening();
      addToast('Voice Listener Active', `Listening in ${voiceLanguage === 'hi-IN' ? 'Hindi' : 'English'}... Speak now.`, 'success');
    }
  }, [assistantState, stopSpeaking, stopListening, clearVoiceError, startListening, voiceLanguage, addToast]);

  // Ref to access current messages without triggering re-render cascades
  const messagesRef = useRef(messages);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  // Command & Chat Submission Handler (Phase 4 Gemini Brain Integration)
  const submitCommand = useCallback(
    async (commandText) => {
      if (!commandText || !commandText.trim()) return;

      // Stop voice listening if currently listening
      if (isListening) {
        rawStopListening();
      }

      // Stop speech immediately if currently active to prevent duplicate or overlapping playback
      stopSpeaking();

      const trimmed = commandText.trim();
      const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      // 1. Display user message
      const userMsg = {
        id: `user-${Date.now()}`,
        sender: 'user',
        text: trimmed,
        timestamp: timeNow,
      };

      setMessages((prev) => [...prev, userMsg]);

      // 2. Change AI Orb to PROCESSING
      setAssistantState(ASSISTANT_STATES.PROCESSING);
      setVoiceErrorMessage('');

      // Append to recent activity
      const activityId = `act-${Date.now()}`;
      setRecentActivity((prev) => [
        {
          id: activityId,
          title: `Prompt: "${trimmed.length > 32 ? trimmed.substring(0, 32) + '...' : trimmed}"`,
          description: 'Consulting NEXA AI Brain...',
          time: 'Just now',
          type: 'query',
          status: 'processing',
        },
        ...prev.slice(0, 7),
      ]);

      // 3. Send message to backend and 4. Receive AI response
      try {
        const historySnapshot = [...messagesRef.current];
        const result = await sendChatMessage({
          message: trimmed,
          conversationHistory: historySnapshot,
          conversationId: conversationIdRef.current,
        });

        if (result.conversationId) {
          setConversationId(result.conversationId);
          conversationIdRef.current = result.conversationId;
        }

        // 5. Display assistant response with provider & fallback telemetry
        const assistantMsg = {
          id: `ast-${Date.now()}`,
          sender: 'assistant',
          text: result.reply,
          provider: result.provider,
          model: result.model,
          fallbackUsed: Boolean(result.fallbackUsed),
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        // Explicit fallback notification: never silently enable Gemini fallback
        if (result.fallbackUsed) {
          addToast(
            'Gemini Fallback Activated',
            `Local Ollama was unavailable. Prompt was processed using Google Gemini fallback per your preferences.`,
            'warning'
          );
        }

        // Update telemetry state
        setConnectionStatus((prev) => ({
          ...prev,
          backend: 'Connected',
          aiBrain: `Active (${result.provider?.toUpperCase() || 'AI'}: ${result.model})`,
        }));

        if (result.memoryAction === 'remembered') {
          addToast('Persistent Memory Saved', 'NEXA stored this preference in MongoDB.', 'success');
        } else if (result.memoryAction === 'forgotten') {
          addToast('Memory Removed', 'NEXA removed this entry from persistent storage.', 'info');
        }

        setRecentActivity((prev) =>
          prev.map((act) =>
            act.id === activityId
              ? {
                  ...act,
                  status: 'completed',
                  description: `Replied by ${result.provider?.toUpperCase() || 'AI'} (${result.model})${result.fallbackUsed ? ' [Fallback]' : ''}`,
                }
              : act
          )
        );

        // 6. Automatically speak response if voice output is enabled (both voice & typed inputs)
        if (ttsEnabledRef.current && isSynthesisSupported) {
          const spoke = rawSpeak(result.reply, {
            lang: voiceLanguageRef.current,
            voice: selectedVoiceRef.current,
          });
          if (spoke) {
            setAssistantState(ASSISTANT_STATES.SPEAKING);
          } else {
            setAssistantState(ASSISTANT_STATES.IDLE);
          }
        } else {
          // If voice output is disabled, return Orb to IDLE
          setAssistantState(ASSISTANT_STATES.IDLE);
        }
      } catch (err) {
        console.error('[NEXA AI Brain Error]:', err);
        const errorMessage = err.message || 'Unable to connect to NEXA AI brain.';
        setVoiceErrorMessage(errorMessage);
        setAssistantState(ASSISTANT_STATES.ERROR);

        const errorMsg = {
          id: `err-${Date.now()}`,
          sender: 'assistant',
          text: `⚠️ NEXA Brain Error: ${errorMessage}`,
          isError: true,
          canRetry: true,
          retryText: trimmed,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };

        setMessages((prev) => [...prev, errorMsg]);

        setRecentActivity((prev) =>
          prev.map((act) =>
            act.id === activityId
              ? { ...act, status: 'failed', description: 'Brain reasoning failed' }
              : act
          )
        );

        addToast('AI Brain Alert', errorMessage, 'error');
      }
    },
    [
      isListening,
      rawStopListening,
      isSpeaking,
      stopSpeaking,
      ttsEnabled,
      isSynthesisSupported,
      rawSpeak,
      voiceLanguage,
      selectedVoice,
      addToast,
    ]
  );

  // Retry a failed command
  const retryMessage = useCallback(
    (textToRetry) => {
      if (!textToRetry) return;
      // Remove any trailing error message that matches this retry
      setMessages((prev) => prev.filter((m) => !(m.isError && m.retryText === textToRetry)));
      submitCommand(textToRetry);
    },
    [submitCommand]
  );

  // Clear conversation history
  const clearConversation = useCallback(() => {
    if (isSpeaking) {
      stopSpeaking();
    }
    const initMsg = {
      id: `msg-init-${Date.now()}`,
      sender: 'assistant',
      text: 'Session reset. NEXA 2.0 AI Brain is online and ready for your commands.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setMessages([initMsg]);
    setConversationId(null);
    conversationIdRef.current = null;
    setAssistantState(ASSISTANT_STATES.IDLE);
    setVoiceErrorMessage('');
    addToast('Conversation Cleared', 'Active dialogue history has been reset.', 'info');
  }, [isSpeaking, stopSpeaking, addToast]);

  return (
    <AppContext.Provider
      value={{
        appConfig: APP_CONFIG,
        sidebarCollapsed,
        setSidebarCollapsed,
        mobileMenuOpen,
        setMobileMenuOpen,
        assistantState,
        setAssistantState,
        voiceErrorMessage,
        clearVoiceError,
        handleOrbClick,
        connectionStatus,
        refreshBackendStatus,
        toasts,
        addToast,
        removeToast,
        recentActivity,
        activeTasks,
        messages,
        submitCommand,
        retryMessage,
        clearConversation,
        conversationId,
        commandInputText,
        setCommandInputText,

        // Voice Recognition
        isVoiceSupported,
        isListening,
        voiceLanguage,
        setVoiceLanguage,
        interimTranscript,
        finalTranscript,
        voiceError,
        micPermission,
        startListening,
        stopListening,
        toggleListening,
        resetTranscript,
        requestMicrophoneAccess,

        // Speech Synthesis
        isSynthesisSupported,
        isSpeaking,
        isSpeechPaused,
        ttsEnabled,
        setTtsEnabled,
        voices,
        englishVoices,
        hindiVoices,
        selectedVoice,
        selectedVoiceURI,
        setSelectedVoiceURI,
        speechRate,
        setSpeechRate,
        speechPitch,
        setSpeechPitch,
        speak: rawSpeak,
        stopSpeaking,
        testVoice,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}

export default AppContext;
