import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { APP_CONFIG, ASSISTANT_STATES } from '../utils/constants';
import { useVoiceRecognition } from '../hooks/useVoiceRecognition';
import { useSpeechSynthesis } from '../hooks/useSpeechSynthesis';
import { checkMicrophonePermission } from '../services/voice.service';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [assistantState, setAssistantState] = useState(ASSISTANT_STATES.IDLE);
  const [voiceErrorMessage, setVoiceErrorMessage] = useState('');
  const [commandInputText, setCommandInputText] = useState('');

  // Selected language for speech recognition and synthesis ('en-US' or 'hi-IN')
  const [voiceLanguage, setVoiceLanguageState] = useState('en-US');

  // Connection States (No fabricated metrics)
  const [connectionStatus, setConnectionStatus] = useState({
    core: 'Ready',
    desktopAgent: 'Not Connected',
    browserAutomation: 'Standby',
    audioEngine: 'Initializing...',
    memoryUsage: '--',
    latency: 'Not Connected',
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
      text: 'Good day, Operator. NEXA 2.0 system core is initialized with browser voice interaction ready. How can I assist your workflow today?',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  // Ref to track assistantState for async callbacks
  const assistantStateRef = useRef(assistantState);
  useEffect(() => {
    assistantStateRef.current = assistantState;
  }, [assistantState]);

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
      // Return to IDLE if previously speaking
      setAssistantState((prev) => (prev === ASSISTANT_STATES.SPEAKING ? ASSISTANT_STATES.IDLE : prev));
    },
    onError: (err) => {
      setAssistantState((prev) => (prev === ASSISTANT_STATES.SPEAKING ? ASSISTANT_STATES.IDLE : prev));
      if (err?.message && err.message !== 'canceled' && err.message !== 'interrupted') {
        addToast('Voice Output Error', err.message, 'warning');
      }
    },
  });

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

  // Command submission handler
  const submitCommand = useCallback((commandText) => {
    if (!commandText || !commandText.trim()) return;

    // Stop listening if user manually dispatches
    if (isListening) {
      rawStopListening();
    }

    const trimmed = commandText.trim();
    const timeNow = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // 1. Append user message
    const userMsg = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text: trimmed,
      timestamp: timeNow,
    };

    setMessages((prev) => [...prev, userMsg]);
    setAssistantState(ASSISTANT_STATES.PROCESSING);

    // 2. Append to recent activity
    setRecentActivity((prev) => [
      {
        id: `act-${Date.now()}`,
        title: `Command: "${trimmed.length > 32 ? trimmed.substring(0, 32) + '...' : trimmed}"`,
        description: 'Command parsed by operator interface. Desktop bridge disconnected.',
        time: 'Just now',
        type: 'command',
        status: 'pending',
      },
      ...prev.slice(0, 7),
    ]);

    // 3. Realistic processing simulation with honest assistant response
    setTimeout(() => {
      const assistantMsg = {
        id: `ast-${Date.now()}`,
        sender: 'assistant',
        text: `Instruction logged: "${trimmed}". The native Desktop Agent is currently disconnected (Phase 3). Once the desktop daemon connects, this task will execute directly on your workstation.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, assistantMsg]);

      // If text-to-speech is enabled, speak the assistant response
      if (ttsEnabled && isSynthesisSupported) {
        setAssistantState(ASSISTANT_STATES.SPEAKING);
        rawSpeak(assistantMsg.text, {
          lang: voiceLanguage,
          voice: selectedVoice,
        });
      } else {
        setAssistantState(ASSISTANT_STATES.IDLE);
      }
    }, 700);
  }, [isListening, rawStopListening, ttsEnabled, isSynthesisSupported, rawSpeak, voiceLanguage, selectedVoice]);

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
        toasts,
        addToast,
        removeToast,
        recentActivity,
        activeTasks,
        messages,
        submitCommand,
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
