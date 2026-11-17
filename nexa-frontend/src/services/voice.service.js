/**
 * Voice Service - Web Speech API Integration
 * Provides browser-native SpeechRecognition and SpeechSynthesis abstraction.
 */

// Detect browser SpeechRecognition support (standard or webkit-prefixed)
export const getSpeechRecognition = () => {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
};

export const isRecognitionSupported = () => {
  return Boolean(getSpeechRecognition());
};

export const isSynthesisSupported = () => {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
};

/**
 * Check current microphone permission status without necessarily opening a stream.
 * @returns {Promise<'granted' | 'denied' | 'prompt' | 'unsupported'>}
 */
export const checkMicrophonePermission = async () => {
  if (typeof navigator === 'undefined' || !navigator.permissions || !navigator.permissions.query) {
    // If permissions query API isn't supported, check if getUserMedia exists
    return navigator?.mediaDevices?.getUserMedia ? 'prompt' : 'unsupported';
  }

  try {
    const status = await navigator.permissions.query({ name: 'microphone' });
    return status.state; // 'granted' | 'denied' | 'prompt'
  } catch (err) {
    // Some browsers throw on querying { name: 'microphone' }
    return 'prompt';
  }
};

/**
 * Explicitly request microphone access via getUserMedia to prompt the user
 * and immediately release the hardware stream.
 * @returns {Promise<{ granted: boolean, error?: string }>}
 */
export const requestMicrophoneAccess = async () => {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    return {
      granted: false,
      error: 'Audio input hardware or getUserMedia API is not supported in this browser environment.',
    };
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop all audio tracks immediately after obtaining permission
    stream.getTracks().forEach((track) => track.stop());
    return { granted: true };
  } catch (err) {
    let errorMessage = 'Microphone permission request failed.';
    if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
      errorMessage = 'Microphone permission was denied by the operator or blocked by browser policy.';
    } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
      errorMessage = 'No audio input hardware (microphone) was detected on this device.';
    } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
      errorMessage = 'Microphone is already occupied or blocked by another application.';
    }
    return { granted: false, error: errorMessage };
  }
};

/**
 * Instantiate and configure a new native SpeechRecognition object.
 * @param {Object} config
 * @param {string} config.lang - e.g. 'en-US' or 'hi-IN'
 * @param {boolean} config.continuous - Keep listening until explicitly stopped
 * @param {boolean} config.interimResults - Emit partial transcripts
 * @returns {SpeechRecognition | null}
 */
export const createSpeechRecognition = ({
  lang = 'en-US',
  continuous = true,
  interimResults = true,
  maxAlternatives = 1,
} = {}) => {
  const RecognitionClass = getSpeechRecognition();
  if (!RecognitionClass) return null;

  const recognition = new RecognitionClass();
  recognition.lang = lang;
  recognition.continuous = continuous;
  recognition.interimResults = interimResults;
  recognition.maxAlternatives = maxAlternatives;

  return recognition;
};

/**
 * Fetch voices asynchronously with support for browsers that load voices asynchronously (Chrome/Safari).
 * @returns {Promise<SpeechSynthesisVoice[]>}
 */
export const getAvailableVoices = () => {
  return new Promise((resolve) => {
    if (!isSynthesisSupported()) {
      resolve([]);
      return;
    }

    const synth = window.speechSynthesis;
    let voices = synth.getVoices();

    if (voices && voices.length > 0) {
      resolve(voices);
      return;
    }

    // Chrome and Safari fire voiceschanged event when voices are loaded asynchronously
    const handleVoicesChanged = () => {
      synth.removeEventListener('voiceschanged', handleVoicesChanged);
      resolve(synth.getVoices() || []);
    };

    synth.addEventListener('voiceschanged', handleVoicesChanged);

    // Fallback safety timeout in case event does not fire
    setTimeout(() => {
      synth.removeEventListener('voiceschanged', handleVoicesChanged);
      resolve(synth.getVoices() || []);
    }, 1200);
  });
};

/**
 * Filter voices that match a specific language code or language group.
 * @param {SpeechSynthesisVoice[]} voices
 * @param {string} langCode - 'en' or 'hi' or full code 'hi-IN', 'en-US'
 * @returns {SpeechSynthesisVoice[]}
 */
export const filterVoicesByLanguage = (voices = [], langCode = 'en') => {
  if (!Array.isArray(voices)) return [];
  const target = langCode.toLowerCase().split('-')[0];
  return voices.filter((v) => {
    const vLang = (v.lang || '').toLowerCase();
    return vLang.startsWith(target);
  });
};

/**
 * Detects whether the text is Devanagari Hindi, Roman-script Hinglish, or English.
 *
 * @param {string} text
 * @param {string} [preferredLang='en-US']
 * @returns {'hindi-devanagari' | 'roman-hinglish' | 'english'}
 */
export const detectTextLanguage = (text = '', preferredLang = 'en-US') => {
  if (!text || typeof text !== 'string') return 'english';

  // 1. Check for Devanagari Unicode characters (U+0900 to U+097F)
  const hasDevanagari = /[\u0900-\u097F]/.test(text);
  if (hasDevanagari) {
    return 'hindi-devanagari';
  }

  // 2. Check for Roman-script Hinglish
  // Look for common conversational Hinglish grammatical marker words
  const hinglishMarkers = /\b(main|mera|meri|mere|aap|aapke|aapko|tum|tumhara|kaise|kaisi|kaisa|kya|kyun|kyu|hai|hain|hoon|ho|aur|yeh|ye|woh|wo|toh|to|nahi|nahin|theek|thik|bhi|karo|karna|rahe|raha|rahi|batayein|batao|accha|acha|kripya|namaste|dhanyawad|kaun|kab|kahan|kuch|apna|apne)\b/i;

  const isHiPreferred = preferredLang && preferredLang.toLowerCase().startsWith('hi');
  if (hinglishMarkers.test(text) || (isHiPreferred && !/^[\x00-\x7F\s.,!?'"()-]+$/.test(text))) {
    return 'roman-hinglish';
  }

  return 'english';
};

/**
 * Cleans text for natural speech synthesis pronunciation by removing markdown formatting,
 * code blocks, URLs, and awkward symbols while preserving natural conversational punctuation.
 *
 * @param {string} text
 * @returns {string} Cleaned spoken text
 */
export const cleanTextForSpeech = (text = '') => {
  if (!text || typeof text !== 'string') return '';

  return text
    // Remove multi-line code blocks ``` ... ```
    .replace(/```[\s\S]*?```/g, ' ')
    // Remove inline code ` ... `
    .replace(/`([^`]+)`/g, '$1')
    // Remove markdown links [text](url) -> text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remove headers #, ##, ###
    .replace(/^#{1,6}\s+/gm, '')
    // Remove bold/italic markers (* or _)
    .replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, '$1')
    // Remove bullet points / list numbers
    .replace(/^[\s]*[-*+]\s+/gm, '')
    .replace(/^[\s]*\d+\.\s+/gm, '')
    // Remove blockquotes
    .replace(/^>\s+/gm, '')
    // Remove horizontal rules
    .replace(/^[-*_]{3,}\s*$/gm, '')
    // Replace pipe tables and tildes
    .replace(/[|~]/g, ' ')
    // Normalize excessive spaces and linebreaks
    .replace(/\s+/g, ' ')
    .trim();
};

/**
 * Intelligently selects the best SpeechSynthesisVoice based on text script and language.
 *
 * Requirements:
 * - Hindi Devanagari: Prefer hi-IN voice.
 * - English: Prefer en-IN or en-US voice.
 * - Roman Hinglish: Prefer en-IN voice when available.
 * - Fall back gracefully if the preferred voice is unavailable.
 *
 * @param {Object} options
 * @param {SpeechSynthesisVoice[]} [options.voices=[]] - Array of available voices
 * @param {string} [options.text=''] - The text to be spoken
 * @param {string} [options.preferredLang='en-US'] - Configured voice language ('en-US' or 'hi-IN')
 * @param {string} [options.selectedVoiceURI=''] - User's explicitly chosen voice URI in settings
 * @returns {{ voice: SpeechSynthesisVoice | null, lang: string, textType: string }}
 */
export const selectBestVoice = ({
  voices = [],
  text = '',
  preferredLang = 'en-US',
  selectedVoiceURI = '',
} = {}) => {
  const textType = detectTextLanguage(text, preferredLang);

  if (!Array.isArray(voices) || voices.length === 0) {
    const lang =
      textType === 'hindi-devanagari' ? 'hi-IN' : textType === 'roman-hinglish' ? 'en-IN' : preferredLang;
    return { voice: null, lang, textType };
  }

  // Voice matchers
  const isHiVoice = (v) => {
    const l = (v.lang || '').toLowerCase();
    return l === 'hi-in' || l.startsWith('hi');
  };

  const isEnInVoice = (v) => {
    const l = (v.lang || '').toLowerCase();
    const n = (v.name || '').toLowerCase();
    return l === 'en-in' || (l.startsWith('en') && (n.includes('india') || n.includes('indian')));
  };

  const isEnUsVoice = (v) => {
    const l = (v.lang || '').toLowerCase();
    return l === 'en-us';
  };

  const isAnyEnVoice = (v) => {
    const l = (v.lang || '').toLowerCase();
    return l.startsWith('en');
  };

  const userSelected = selectedVoiceURI ? voices.find((v) => v.voiceURI === selectedVoiceURI) : null;

  // 1. Hindi Devanagari: Prefer hi-IN voice
  if (textType === 'hindi-devanagari') {
    if (userSelected && isHiVoice(userSelected)) {
      return { voice: userSelected, lang: 'hi-IN', textType };
    }
    const hiVoice = voices.find(isHiVoice);
    if (hiVoice) {
      return { voice: hiVoice, lang: 'hi-IN', textType };
    }
    // Graceful fallback if no hi-IN voice installed:
    // Prefer en-IN (often has Indian phoneme handling) or user-selected or default
    const fallback =
      voices.find(isEnInVoice) ||
      userSelected ||
      voices.find((v) => v.default) ||
      voices[0];
    return { voice: fallback, lang: 'hi-IN', textType };
  }

  // 2. Roman Hinglish: Prefer en-IN voice when available
  if (textType === 'roman-hinglish') {
    if (userSelected && isEnInVoice(userSelected)) {
      return { voice: userSelected, lang: 'en-IN', textType };
    }
    const enInVoice = voices.find(isEnInVoice);
    if (enInVoice) {
      return { voice: enInVoice, lang: 'en-IN', textType };
    }
    // Graceful fallback: user-selected > en-US > any en > hi > default
    const fallback =
      userSelected ||
      voices.find(isEnUsVoice) ||
      voices.find(isAnyEnVoice) ||
      voices.find(isHiVoice) ||
      voices.find((v) => v.default) ||
      voices[0];
    return { voice: fallback, lang: 'en-IN', textType };
  }

  // 3. English: Prefer en-IN or en-US voice
  if (userSelected && isAnyEnVoice(userSelected)) {
    return { voice: userSelected, lang: userSelected.lang || 'en-US', textType };
  }
  const enVoice =
    voices.find(isEnInVoice) ||
    voices.find(isEnUsVoice) ||
    voices.find(isAnyEnVoice) ||
    userSelected ||
    voices.find((v) => v.default) ||
    voices[0];

  return { voice: enVoice, lang: enVoice?.lang || 'en-US', textType };
};

// Module-level persistent reference to prevent Chrome GC of active utterance
let activeUtteranceInstance = null;

/**
 * Speak text using native SpeechSynthesis with chunking and pause-resume keepalive for Chrome.
 * Includes garbage-collection prevention and duplicate speech suppression.
 *
 * @param {string} text
 * @param {Object} options
 * @returns {() => void} Cancel function
 */
export const speakUtterance = (
  text,
  {
    voice = null,
    lang = 'en-US',
    rate = 1.0,
    pitch = 1.0,
    volume = 1.0,
    onStart = () => {},
    onEnd = () => {},
    onError = () => {},
    onPause = () => {},
    onResume = () => {},
  } = {}
) => {
  if (!isSynthesisSupported() || !text || !text.trim()) {
    if (!isSynthesisSupported()) {
      onError({ error: 'SpeechSynthesis is not supported in this browser.' });
    }
    return () => {};
  }

  const synth = window.speechSynthesis;
  const UtteranceClass = window.SpeechSynthesisUtterance || globalThis.SpeechSynthesisUtterance;

  if (!UtteranceClass) {
    onError({ error: 'SpeechSynthesisUtterance constructor not available.' });
    return () => {};
  }

  // Always cancel any prior active utterance to prevent duplicate playback or queue deadlock
  try {
    synth.cancel();
  } catch (e) {
    // Ignore cancel errors
  }

  // Unpause engine if stuck in paused state in Chrome/Safari
  if (synth.paused) {
    try {
      synth.resume();
    } catch (e) {
      // Ignore resume errors
    }
  }

  const utterance = new UtteranceClass(text.trim());
  utterance.lang = lang;
  utterance.rate = Math.min(Math.max(rate, 0.5), 2.0);
  utterance.pitch = Math.min(Math.max(pitch, 0.5), 1.5);
  utterance.volume = Math.min(Math.max(volume, 0.0), 1.0);

  if (voice) {
    utterance.voice = voice;
  }

  // Retain persistent reference to prevent browser GC from cutting off speech midway
  activeUtteranceInstance = utterance;
  if (typeof window !== 'undefined') {
    window.__nexaActiveUtterance = utterance;
  }

  // Chrome workaround: utterances longer than ~15 seconds can stall.
  // We keep a lightweight keepalive timer while utterance is active.
  let keepAliveInterval = null;

  utterance.onstart = (evt) => {
    keepAliveInterval = setInterval(() => {
      if (synth.speaking && !synth.paused) {
        synth.pause();
        synth.resume();
      }
    }, 10000);
    onStart(evt);
  };

  const cleanup = () => {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
    if (activeUtteranceInstance === utterance) {
      activeUtteranceInstance = null;
    }
    if (typeof window !== 'undefined' && window.__nexaActiveUtterance === utterance) {
      window.__nexaActiveUtterance = null;
    }
  };

  utterance.onend = (evt) => {
    cleanup();
    onEnd(evt);
  };

  utterance.onerror = (evt) => {
    cleanup();
    // "canceled" or "interrupted" is normal when stopped manually
    if (evt.error !== 'canceled' && evt.error !== 'interrupted') {
      onError(evt);
    } else {
      onEnd(evt);
    }
  };

  utterance.onpause = onPause;
  utterance.onresume = onResume;

  try {
    synth.speak(utterance);
  } catch (err) {
    cleanup();
    onError({ error: err.message || 'Failed to dispatch utterance to SpeechSynthesis.' });
  }

  // Return cancel handle
  return () => {
    cleanup();
    try {
      synth.cancel();
    } catch (e) {}
  };
};

export const cancelUtterance = () => {
  if (isSynthesisSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch (e) {}
  }
};

export const pauseUtterance = () => {
  if (isSynthesisSupported()) {
    try {
      window.speechSynthesis.pause();
    } catch (e) {}
  }
};

export const resumeUtterance = () => {
  if (isSynthesisSupported()) {
    try {
      window.speechSynthesis.resume();
    } catch (e) {}
  }
};
