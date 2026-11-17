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
 * Speak text using native SpeechSynthesis with chunking and pause-resume keepalive for Chrome.
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

  // Always cancel any prior active utterance to prevent queue deadlock
  synth.cancel();

  const utterance = new UtteranceClass(text.trim());
  utterance.lang = lang;
  utterance.rate = Math.min(Math.max(rate, 0.5), 2.0);
  utterance.pitch = Math.min(Math.max(pitch, 0.5), 1.5);
  utterance.volume = Math.min(Math.max(volume, 0.0), 1.0);

  if (voice) {
    utterance.voice = voice;
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

  utterance.onend = (evt) => {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
    onEnd(evt);
  };

  utterance.onerror = (evt) => {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
    // "canceled" or "interrupted" is normal when stopped manually
    if (evt.error !== 'canceled' && evt.error !== 'interrupted') {
      onError(evt);
    } else {
      onEnd(evt);
    }
  };

  utterance.onpause = onPause;
  utterance.onresume = onResume;

  synth.speak(utterance);

  // Return cancel handle
  return () => {
    if (keepAliveInterval) {
      clearInterval(keepAliveInterval);
      keepAliveInterval = null;
    }
    synth.cancel();
  };
};

export const cancelUtterance = () => {
  if (isSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
};

export const pauseUtterance = () => {
  if (isSynthesisSupported()) {
    window.speechSynthesis.pause();
  }
};

export const resumeUtterance = () => {
  if (isSynthesisSupported()) {
    window.speechSynthesis.resume();
  }
};
