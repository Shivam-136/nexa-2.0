import { useState, useEffect, useRef, useCallback } from 'react';
import {
  isSynthesisSupported,
  getAvailableVoices,
  speakUtterance,
  cancelUtterance,
  pauseUtterance,
  resumeUtterance,
  filterVoicesByLanguage,
  selectBestVoice,
  cleanTextForSpeech,
} from '../services/voice.service';

/**
 * Custom React Hook for browser-native SpeechSynthesis (Text-to-Speech).
 * Handles voice listing, voice selection, speaking state, speech rate/pitch/volume controls,
 * intelligent voice & script matching, and speech enable/disable preferences.
 */
export function useSpeechSynthesis({
  defaultRate = 1.0,
  defaultPitch = 1.0,
  defaultVolume = 1.0,
  defaultLang = 'en-US',
  defaultEnabled = true,
  onStart,
  onEnd,
  onError,
} = {}) {
  const isSupported = isSynthesisSupported();

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [voices, setVoices] = useState([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState('');
  const [speechRate, setSpeechRate] = useState(defaultRate);
  const [speechPitch, setSpeechPitch] = useState(defaultPitch);
  const [speechVolume, setSpeechVolume] = useState(defaultVolume);
  const [ttsEnabled, setTtsEnabled] = useState(defaultEnabled);
  const [error, setError] = useState(null);

  const activeCancelRef = useRef(null);
  const onStartRef = useRef(onStart);
  const onEndRef = useRef(onEnd);
  const onErrorRef = useRef(onError);
  const voicesRef = useRef(voices);
  const selectedVoiceURIRef = useRef(selectedVoiceURI);

  useEffect(() => {
    onStartRef.current = onStart;
  }, [onStart]);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    voicesRef.current = voices;
  }, [voices]);

  useEffect(() => {
    selectedVoiceURIRef.current = selectedVoiceURI;
  }, [selectedVoiceURI]);

  // Load voices asynchronously
  useEffect(() => {
    if (!isSupported) return;

    let mounted = true;

    getAvailableVoices().then((availableVoices) => {
      if (!mounted) return;
      setVoices(availableVoices);
      voicesRef.current = availableVoices;

      // Default voice selection strategy if not yet set
      if (availableVoices.length > 0 && !selectedVoiceURI) {
        const matched =
          availableVoices.find((v) => v.lang === defaultLang) ||
          availableVoices.find((v) => v.lang.startsWith(defaultLang.split('-')[0])) ||
          availableVoices.find((v) => v.default) ||
          availableVoices[0];

        if (matched) {
          setSelectedVoiceURI(matched.voiceURI);
          selectedVoiceURIRef.current = matched.voiceURI;
        }
      }
    });

    return () => {
      mounted = false;
    };
  }, [isSupported, defaultLang, selectedVoiceURI]);

  // Find currently selected voice object
  const selectedVoice = voices.find((v) => v.voiceURI === selectedVoiceURI) || null;

  // Speak method
  const speak = useCallback(
    (text, overrideOptions = {}) => {
      if (!isSupported) {
        const err = { message: 'SpeechSynthesis is not supported in this browser.' };
        setError(err);
        if (onErrorRef.current) onErrorRef.current(err);
        return false;
      }

      if (!ttsEnabled && !overrideOptions.force) {
        return false;
      }

      if (!text || !text.trim()) {
        return false;
      }

      // Clean markdown, code fences, and awkward symbols for natural voice pronunciation
      const cleanedText = cleanTextForSpeech(text);
      if (!cleanedText) {
        return false;
      }

      // Stop any active utterance first to prevent duplicate speech
      if (activeCancelRef.current) {
        try {
          activeCancelRef.current();
        } catch (e) {}
        activeCancelRef.current = null;
      } else {
        cancelUtterance();
      }

      // Intelligent voice and script selection
      const availableVoices = voicesRef.current.length > 0 ? voicesRef.current : voices;
      const targetLang = overrideOptions.lang || defaultLang;

      let voice = overrideOptions.voice;
      let lang = targetLang;

      if (!voice) {
        const resolution = selectBestVoice({
          voices: availableVoices,
          text: cleanedText,
          preferredLang: targetLang,
          selectedVoiceURI: selectedVoiceURIRef.current,
        });
        voice = resolution.voice;
        lang = resolution.lang;
      }

      const rate = overrideOptions.rate !== undefined ? overrideOptions.rate : speechRate;
      const pitch = overrideOptions.pitch !== undefined ? overrideOptions.pitch : speechPitch;
      const volume = overrideOptions.volume !== undefined ? overrideOptions.volume : speechVolume;

      const cancelFn = speakUtterance(cleanedText, {
        voice,
        lang,
        rate,
        pitch,
        volume,
        onStart: (evt) => {
          setIsSpeaking(true);
          setIsPaused(false);
          setError(null);
          if (onStartRef.current) onStartRef.current(evt);
        },
        onEnd: (evt) => {
          setIsSpeaking(false);
          setIsPaused(false);
          activeCancelRef.current = null;
          if (onEndRef.current) onEndRef.current(evt);
        },
        onError: (errEvt) => {
          setIsSpeaking(false);
          setIsPaused(false);
          activeCancelRef.current = null;
          const err = { message: errEvt.error || 'Speech synthesis error.' };
          setError(err);
          if (onErrorRef.current) onErrorRef.current(err);
        },
        onPause: () => setIsPaused(true),
        onResume: () => setIsPaused(false),
      });

      activeCancelRef.current = cancelFn;
      return true;
    },
    [
      isSupported,
      ttsEnabled,
      voices,
      defaultLang,
      speechRate,
      speechPitch,
      speechVolume,
    ]
  );

  // Stop speaking immediately
  const stop = useCallback(() => {
    if (activeCancelRef.current) {
      try {
        activeCancelRef.current();
      } catch (e) {}
      activeCancelRef.current = null;
    } else {
      cancelUtterance();
    }
    setIsSpeaking(false);
    setIsPaused(false);
  }, []);

  // Pause speaking
  const pause = useCallback(() => {
    pauseUtterance();
    setIsPaused(true);
  }, []);

  // Resume speaking
  const resume = useCallback(() => {
    resumeUtterance();
    setIsPaused(false);
  }, []);

  // Test voice helper
  const testVoice = useCallback(
    (sampleText = 'NEXA 2.0 voice synthesis test.') => {
      return speak(sampleText, { force: true });
    },
    [speak]
  );

  // Voices filtered for English and Hindi
  const englishVoices = filterVoicesByLanguage(voices, 'en');
  const hindiVoices = filterVoicesByLanguage(voices, 'hi');

  // Cancel speech on unmount
  useEffect(() => {
    return () => {
      if (activeCancelRef.current) {
        try {
          activeCancelRef.current();
        } catch (e) {}
      } else {
        cancelUtterance();
      }
    };
  }, []);

  return {
    isSupported,
    isSpeaking,
    isPaused,
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
    speechVolume,
    setSpeechVolume,
    speak,
    stop,
    pause,
    resume,
    testVoice,
    error,
  };
}

export default useSpeechSynthesis;
