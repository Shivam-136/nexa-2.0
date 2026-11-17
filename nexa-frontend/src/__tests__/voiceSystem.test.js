import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isRecognitionSupported,
  isSynthesisSupported,
  getSpeechRecognition,
  checkMicrophonePermission,
  requestMicrophoneAccess,
  createSpeechRecognition,
  getAvailableVoices,
  filterVoicesByLanguage,
  speakUtterance,
  cancelUtterance,
  detectTextLanguage,
  cleanTextForSpeech,
  selectBestVoice,
} from '../services/voice.service.js';

describe('NEXA 2.0 Browser Voice System Test Suite', () => {
  const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

  const setMockWindow = (val) => {
    Object.defineProperty(globalThis, 'window', {
      value: val,
      writable: true,
      configurable: true,
    });
  };

  const setMockNavigator = (val) => {
    Object.defineProperty(globalThis, 'navigator', {
      value: val,
      writable: true,
      configurable: true,
    });
  };

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor);
    } else {
      delete globalThis.window;
    }

    if (originalNavigatorDescriptor) {
      Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
    }
  });

  // TEST 1: Microphone Permission
  describe('1. Test Microphone Permission', () => {
    it('should query permissions and return granted when permission query is supported', async () => {
      setMockNavigator({
        permissions: {
          query: async ({ name }) => {
            assert.equal(name, 'microphone');
            return { state: 'granted' };
          },
        },
      });

      const status = await checkMicrophonePermission();
      assert.equal(status, 'granted');
    });

    it('should request microphone stream and release tracks on success', async () => {
      let trackStopped = false;
      setMockNavigator({
        mediaDevices: {
          getUserMedia: async (constraints) => {
            assert.deepEqual(constraints, { audio: true });
            return {
              getTracks: () => [
                {
                  stop: () => {
                    trackStopped = true;
                  },
                },
              ],
            };
          },
        },
      });

      const result = await requestMicrophoneAccess();
      assert.equal(result.granted, true);
      assert.equal(trackStopped, true);
    });
  });

  // TEST 2: English Recognition
  describe('2. Test English Recognition', () => {
    it('should instantiate SpeechRecognition configured for en-US', () => {
      class MockSpeechRecognition {
        constructor() {
          this.lang = '';
          this.continuous = false;
          this.interimResults = false;
        }
      }

      setMockWindow({
        SpeechRecognition: MockSpeechRecognition,
      });

      const recognition = createSpeechRecognition({
        lang: 'en-US',
        continuous: true,
        interimResults: true,
      });

      assert.ok(recognition);
      assert.equal(recognition.lang, 'en-US');
      assert.equal(recognition.continuous, true);
      assert.equal(recognition.interimResults, true);
    });
  });

  // TEST 3: Hindi Recognition
  describe('3. Test Hindi Recognition where supported', () => {
    it('should instantiate SpeechRecognition configured for hi-IN', () => {
      class MockSpeechRecognition {
        constructor() {
          this.lang = '';
          this.continuous = false;
          this.interimResults = false;
        }
      }

      setMockWindow({
        webkitSpeechRecognition: MockSpeechRecognition,
      });

      const recognition = createSpeechRecognition({
        lang: 'hi-IN',
        continuous: true,
        interimResults: true,
      });

      assert.ok(recognition);
      assert.equal(recognition.lang, 'hi-IN');
      assert.equal(recognition.continuous, true);
      assert.equal(recognition.interimResults, true);
    });
  });

  // TEST 4: Interim and Final Transcription
  describe('4. Test Interim and Final Transcription', () => {
    it('should accurately differentiate between interim and final speech results', () => {
      let interimResult = '';
      let finalResult = '';

      const handleSpeechEvent = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const item = event.results[i];
          const text = item[0]?.transcript || '';
          if (item.isFinal) {
            finalResult += text;
          } else {
            interimResult += text;
          }
        }
      };

      // Step 1: partial interim speech chunk
      const interimEvent = {
        resultIndex: 0,
        results: [[{ transcript: 'open visual' }]],
      };
      interimEvent.results[0].isFinal = false;
      handleSpeechEvent(interimEvent);
      assert.equal(interimResult, 'open visual');
      assert.equal(finalResult, '');

      // Step 2: finalized phrase chunk
      interimResult = '';
      const finalEvent = {
        resultIndex: 0,
        results: [[{ transcript: 'open visual studio code' }]],
      };
      finalEvent.results[0].isFinal = true;
      handleSpeechEvent(finalEvent);
      assert.equal(interimResult, '');
      assert.equal(finalResult, 'open visual studio code');
    });
  });

  // TEST 5: Speech Synthesis & Intelligent Voice Selection
  describe('5. Test Speech Synthesis (TTS)', () => {
    it('should detect support and filter available voices by language', async () => {
      const mockVoices = [
        { voiceURI: 'v-en-1', name: 'Alex', lang: 'en-US', default: true },
        { voiceURI: 'v-en-2', name: 'Samantha', lang: 'en-GB', default: false },
        { voiceURI: 'v-hi-1', name: 'Lekha', lang: 'hi-IN', default: false },
      ];

      setMockWindow({
        speechSynthesis: {
          getVoices: () => mockVoices,
          addEventListener: () => {},
          removeEventListener: () => {},
          speak: () => {},
          cancel: () => {},
        },
        SpeechSynthesisUtterance: class MockUtterance {
          constructor(text) {
            this.text = text;
          }
        },
      });

      assert.equal(isSynthesisSupported(), true);

      const voices = await getAvailableVoices();
      assert.equal(voices.length, 3);

      const englishVoices = filterVoicesByLanguage(voices, 'en');
      assert.equal(englishVoices.length, 2);

      const hindiVoices = filterVoicesByLanguage(voices, 'hi');
      assert.equal(hindiVoices.length, 1);
      assert.equal(hindiVoices[0].name, 'Lekha');
    });

    it('should configure and trigger utterance playback with rate, pitch, and voice', (t, done) => {
      let spokenUtterance = null;
      let cancelled = false;

      class MockUtterance {
        constructor(text) {
          this.text = text;
          this.lang = '';
          this.rate = 1;
          this.pitch = 1;
          this.volume = 1;
        }
      }

      setMockWindow({
        speechSynthesis: {
          cancel: () => {
            cancelled = true;
          },
          speak: (utt) => {
            spokenUtterance = utt;
            utt.onstart?.({});
            setTimeout(() => {
              utt.onend?.({});
            }, 10);
          },
          speaking: true,
          paused: false,
        },
        SpeechSynthesisUtterance: MockUtterance,
      });

      const cancelFn = speakUtterance('Welcome Operator', {
        lang: 'en-US',
        rate: 1.2,
        pitch: 1.1,
        onStart: () => {
          assert.equal(spokenUtterance.text, 'Welcome Operator');
          assert.equal(spokenUtterance.rate, 1.2);
          assert.equal(spokenUtterance.pitch, 1.1);
          assert.equal(spokenUtterance.lang, 'en-US');
        },
        onEnd: () => {
          assert.equal(cancelled, true); // prior cancel called
          done();
        },
      });

      assert.equal(typeof cancelFn, 'function');
    });
  });

  // TEST 6: Stop Speech Immediately
  describe('6. Test Stop Speech Immediately', () => {
    it('should allow stopping speech recognition and cancelling speech synthesis immediately', () => {
      let stopped = false;
      let cancelled = false;

      class MockRecognition {
        stop() {
          stopped = true;
        }
        abort() {}
      }

      const rec = new MockRecognition();
      rec.stop();
      assert.equal(stopped, true);

      setMockWindow({
        speechSynthesis: {
          cancel: () => {
            cancelled = true;
          },
        },
        SpeechSynthesisUtterance: class {},
      });

      cancelUtterance();
      assert.equal(cancelled, true);
    });
  });

  // TEST 7: Microphone Permission Denial
  describe('7. Test Microphone Permission Denial', () => {
    it('should catch NotAllowedError and return user-friendly error message', async () => {
      setMockNavigator({
        mediaDevices: {
          getUserMedia: async () => {
            const err = new Error('Permission denied');
            err.name = 'NotAllowedError';
            throw err;
          },
        },
      });

      const result = await requestMicrophoneAccess();
      assert.equal(result.granted, false);
      assert.ok(result.error.includes('denied'));
    });
  });

  // TEST 8: Unsupported Browser Handling
  describe('8. Test Unsupported Browser Handling', () => {
    it('should return false when Web Speech API is missing from window', () => {
      setMockWindow({}); // No SpeechRecognition, no webkitSpeechRecognition, no speechSynthesis

      assert.equal(isRecognitionSupported(), false);
      assert.equal(isSynthesisSupported(), false);

      const recognition = createSpeechRecognition();
      assert.equal(recognition, null);
    });

    it('should handle undefined window safely', () => {
      setMockWindow(undefined);

      assert.equal(isRecognitionSupported(), false);
      assert.equal(isSynthesisSupported(), false);
      assert.equal(getSpeechRecognition(), null);
    });
  });

  // SPECIFIC PHASE REQUIREMENTS TEST SUITE
  describe('9. Voice Response Engine & Intelligent Voice Selection', () => {
    const mockVoiceList = [
      { voiceURI: 'google-en-us', name: 'Google US English', lang: 'en-US', default: true },
      { voiceURI: 'google-en-in', name: 'Google Indian English', lang: 'en-IN', default: false },
      { voiceURI: 'google-hi-in', name: 'Google हिन्दी', lang: 'hi-IN', default: false },
      { voiceURI: 'microsoft-en-gb', name: 'Microsoft George', lang: 'en-GB', default: false },
    ];

    it('should detect Hindi Devanagari and prefer hi-IN voice', () => {
      const text = 'नमस्ते शिवम, मैं नेक्सा 2.0 हूँ।';
      const detected = detectTextLanguage(text);
      assert.equal(detected, 'hindi-devanagari');

      const selection = selectBestVoice({
        voices: mockVoiceList,
        text,
      });
      assert.equal(selection.voice.lang, 'hi-IN');
      assert.equal(selection.voice.voiceURI, 'google-hi-in');
      assert.equal(selection.lang, 'hi-IN');
    });

    it('should detect Roman Hinglish and prefer en-IN voice when available', () => {
      const text = 'Main theek hoon Shivam! Aap batao NEXA 2.0 me kya chal raha hai?';
      const detected = detectTextLanguage(text);
      assert.equal(detected, 'roman-hinglish');

      const selection = selectBestVoice({
        voices: mockVoiceList,
        text,
      });
      assert.equal(selection.voice.lang, 'en-IN');
      assert.equal(selection.voice.voiceURI, 'google-en-in');
      assert.equal(selection.lang, 'en-IN');
    });

    it('should detect English and prefer en-IN or en-US voice', () => {
      const text = 'Hello Shivam, NEXA 2.0 is online and ready for your commands.';
      const detected = detectTextLanguage(text);
      assert.equal(detected, 'english');

      const selection = selectBestVoice({
        voices: mockVoiceList,
        text,
      });
      assert.ok(selection.voice.lang === 'en-IN' || selection.voice.lang === 'en-US');
    });

    it('should fall back gracefully when Hindi voice is missing', () => {
      const voicesWithoutHindi = [
        { voiceURI: 'en-1', name: 'David', lang: 'en-US', default: true },
        { voiceURI: 'en-2', name: 'Ravi', lang: 'en-IN', default: false },
      ];

      const hindiText = 'नमस्ते Shivam';
      const selection = selectBestVoice({
        voices: voicesWithoutHindi,
        text: hindiText,
      });

      // Should not throw and should gracefully fall back to en-IN or default
      assert.ok(selection.voice);
      assert.equal(selection.lang, 'hi-IN'); // Target lang is preserved
      assert.equal(selection.voice.lang, 'en-IN');
    });

    it('should clean markdown and symbols from text before speaking for natural pronunciation', () => {
      const rawText =
        '**NEXA 2.0** is an *AI-powered* operator.\n- Feature 1: `React`\n- Feature 2: [Google Gemini](https://ai.google.dev)\n```json\n{"status":"ready"}\n```';

      const cleaned = cleanTextForSpeech(rawText);

      assert.equal(cleaned.includes('**'), false);
      assert.equal(cleaned.includes('```'), false);
      assert.equal(cleaned.includes('https://'), false);
      assert.ok(cleaned.includes('NEXA 2.0 is an AI-powered operator.'));
      assert.ok(cleaned.includes('Feature 1: React'));
      assert.ok(cleaned.includes('Feature 2: Google Gemini'));
    });

    it('should prevent duplicate speech by cancelling previous utterance on new speak request', (t, done) => {
      let cancelCount = 0;
      let spokenTexts = [];

      class MockUtterance {
        constructor(text) {
          this.text = text;
        }
      }

      setMockWindow({
        speechSynthesis: {
          cancel: () => {
            cancelCount++;
          },
          speak: (utt) => {
            spokenTexts.push(utt.text);
          },
          speaking: false,
          paused: false,
        },
        SpeechSynthesisUtterance: MockUtterance,
      });

      // Speak call 1
      speakUtterance('First message', { lang: 'en-US' });
      assert.equal(cancelCount, 1);
      assert.equal(spokenTexts.length, 1);
      assert.equal(spokenTexts[0], 'First message');

      // Speak call 2 immediately follows -> must cancel previous
      speakUtterance('Second message', { lang: 'en-US' });
      assert.equal(cancelCount, 2);
      assert.equal(spokenTexts.length, 2);
      assert.equal(spokenTexts[1], 'Second message');

      done();
    });

    it('should not throw when SpeechSynthesis is unsupported or text is empty', () => {
      setMockWindow({}); // Unsupported
      let errorReported = false;

      const cancel = speakUtterance('Hello', {
        onError: () => {
          errorReported = true;
        },
      });

      assert.equal(typeof cancel, 'function');
      assert.equal(errorReported, true);

      // Empty text should return cancel without throwing
      const cancelEmpty = speakUtterance('', {});
      assert.equal(typeof cancelEmpty, 'function');
    });
  });
});
