import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getSpeechRecognition,
  isRecognitionSupported,
  checkMicrophonePermission,
  requestMicrophoneAccess,
} from '../services/voice.service';

/**
 * Custom React Hook for browser-native SpeechRecognition.
 * Handles microphone permissions, interim & final transcription,
 * language switching (en-US / hi-IN), continuous listening, and error states.
 */
export function useVoiceRecognition({
  defaultLang = 'en-US',
  continuous = true,
  interimResults = true,
  onFinalTranscript,
  onInterimTranscript,
  onError,
} = {}) {
  const isSupported = isRecognitionSupported();

  const [isListening, setIsListening] = useState(false);
  const [language, setLanguage] = useState(defaultLang);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [error, setError] = useState(null);
  const [permissionStatus, setPermissionStatus] = useState('prompt'); // 'prompt' | 'granted' | 'denied' | 'unsupported'

  const recognitionRef = useRef(null);
  const shouldBeListeningRef = useRef(false);
  const isRestartingRef = useRef(false);

  // Keep latest callbacks in refs to avoid re-binding event listeners
  const onFinalRef = useRef(onFinalTranscript);
  const onInterimRef = useRef(onInterimTranscript);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onFinalRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    onInterimRef.current = onInterimTranscript;
  }, [onInterimTranscript]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // Initial permission check on mount
  useEffect(() => {
    let mounted = true;
    if (!isSupported) {
      setPermissionStatus('unsupported');
      return;
    }

    checkMicrophonePermission().then((status) => {
      if (mounted) {
        setPermissionStatus(status);
      }
    });

    return () => {
      mounted = false;
    };
  }, [isSupported]);

  // Clean up recognition instance
  const cleanupRecognition = useCallback(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.abort();
      } catch (e) {
        // Ignore cleanup abort errors
      }
      recognitionRef.current = null;
    }
  }, []);

  // Initialize SpeechRecognition instance
  const initRecognition = useCallback(() => {
    if (!isSupported) return null;

    cleanupRecognition();

    const RecognitionClass = getSpeechRecognition();
    const instance = new RecognitionClass();

    instance.continuous = continuous;
    instance.interimResults = interimResults;
    instance.lang = language;
    instance.maxAlternatives = 1;

    instance.onstart = () => {
      setIsListening(true);
      setError(null);
      setInterimTranscript('');
      setPermissionStatus('granted');
    };

    instance.onresult = (event) => {
      let currentInterim = '';
      let newlyFinal = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const item = event.results[i];
        const text = item[0]?.transcript || '';

        if (item.isFinal) {
          newlyFinal += text;
        } else {
          currentInterim += text;
        }
      }

      if (currentInterim) {
        setInterimTranscript(currentInterim);
        if (onInterimRef.current) {
          onInterimRef.current(currentInterim);
        }
      } else {
        setInterimTranscript('');
      }

      if (newlyFinal) {
        const trimmed = newlyFinal.trim();
        setFinalTranscript((prev) => (prev ? `${prev} ${trimmed}` : trimmed));
        setInterimTranscript('');

        if (onFinalRef.current) {
          onFinalRef.current(trimmed);
        }
      }
    };

    instance.onerror = (event) => {
      const errCode = event.error;
      let userFriendlyMessage = 'Speech recognition encountered an issue.';

      switch (errCode) {
        case 'not-allowed':
        case 'service-not-allowed':
          userFriendlyMessage = 'Microphone permission denied. Please allow microphone access in your browser.';
          setPermissionStatus('denied');
          shouldBeListeningRef.current = false;
          break;
        case 'no-speech':
          // Non-fatal silence; do not stop session in continuous mode
          userFriendlyMessage = 'No speech detected.';
          return;
        case 'audio-capture':
          userFriendlyMessage = 'No microphone device was detected or audio capture failed.';
          shouldBeListeningRef.current = false;
          break;
        case 'network':
          userFriendlyMessage = 'Network connection to the speech recognition service failed.';
          break;
        case 'aborted':
          // Triggered by intentional stop/abort
          return;
        default:
          userFriendlyMessage = `Speech recognition error: ${errCode}`;
      }

      const errPayload = { code: errCode, message: userFriendlyMessage };
      setError(errPayload);

      if (onErrorRef.current) {
        onErrorRef.current(errPayload);
      }
    };

    instance.onend = () => {
      // If user did not intentionally stop listening and continuous is true, auto-restart
      if (shouldBeListeningRef.current && continuous && !isRestartingRef.current) {
        isRestartingRef.current = true;
        try {
          instance.start();
          isRestartingRef.current = false;
          return;
        } catch (e) {
          isRestartingRef.current = false;
        }
      }

      setIsListening(false);
      setInterimTranscript('');
    };

    recognitionRef.current = instance;
    return instance;
  }, [isSupported, continuous, interimResults, language, cleanupRecognition]);

  // Start listening
  const startListening = useCallback(async () => {
    if (!isSupported) {
      const errPayload = {
        code: 'unsupported',
        message: 'SpeechRecognition API is not supported in this browser. Please use Google Chrome or Microsoft Edge.',
      };
      setError(errPayload);
      if (onErrorRef.current) onErrorRef.current(errPayload);
      return false;
    }

    setError(null);
    shouldBeListeningRef.current = true;

    // First ensure permission if needed
    if (permissionStatus !== 'granted') {
      const micAccess = await requestMicrophoneAccess();
      if (!micAccess.granted) {
        setPermissionStatus('denied');
        const errPayload = {
          code: 'not-allowed',
          message: micAccess.error || 'Microphone permission was denied.',
        };
        setError(errPayload);
        shouldBeListeningRef.current = false;
        if (onErrorRef.current) onErrorRef.current(errPayload);
        return false;
      }
      setPermissionStatus('granted');
    }

    try {
      const instance = initRecognition();
      if (instance) {
        instance.start();
        return true;
      }
    } catch (err) {
      // If already started or another instance is running
      if (err.name === 'InvalidStateError') {
        setIsListening(true);
        return true;
      }
      const errPayload = { code: 'start-failed', message: err.message || 'Failed to start speech recognition.' };
      setError(errPayload);
      shouldBeListeningRef.current = false;
      if (onErrorRef.current) onErrorRef.current(errPayload);
      return false;
    }

    return false;
  }, [isSupported, permissionStatus, initRecognition]);

  // Stop listening gracefully
  const stopListening = useCallback(() => {
    shouldBeListeningRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        // In case already stopped
      }
    }
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  // Toggle listening
  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Change language dynamically
  const switchLanguage = useCallback(
    (newLang) => {
      setLanguage(newLang);
      if (isListening) {
        stopListening();
        setTimeout(() => {
          setLanguage(newLang);
          shouldBeListeningRef.current = true;
          // Re-init recognition with updated language
          const instance = initRecognition();
          if (instance) {
            instance.lang = newLang;
            instance.start();
          }
        }, 150);
      }
    },
    [isListening, stopListening, initRecognition]
  );

  // Clear transcribed buffer
  const resetTranscript = useCallback(() => {
    setFinalTranscript('');
    setInterimTranscript('');
  }, []);

  // Teardown on unmount
  useEffect(() => {
    return () => {
      shouldBeListeningRef.current = false;
      cleanupRecognition();
    };
  }, [cleanupRecognition]);

  return {
    isSupported,
    isListening,
    language,
    interimTranscript,
    finalTranscript,
    error,
    permissionStatus,
    startListening,
    stopListening,
    toggleListening,
    switchLanguage,
    resetTranscript,
    requestMicrophoneAccess,
  };
}

export default useVoiceRecognition;

