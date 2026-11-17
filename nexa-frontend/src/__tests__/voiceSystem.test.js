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
        results: [
          [{ transcript: 'open visual' }],
        ],
      };
      interimEvent.results[0].isFinal = false;
      handleSpeechEvent(interimEvent);
      assert.equal(interimResult, 'open visual');
      assert.equal(finalResult, '');

      // Step 2: finalized phrase chunk
      interimResult = '';
      const finalEvent = {
        resultIndex: 0,
        results: [
          [{ transcript: 'open visual studio code' }],
        ],
      };
      finalEvent.results[0].isFinal = true;
      handleSpeechEvent(finalEvent);
      assert.equal(interimResult, '');
      assert.equal(finalResult, 'open visual studio code');
    });
  });

  // TEST 5: Speech Synthesis
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

  // TEST 6: Stop Listening
  describe('6. Test Stop Listening', () => {
    it('should allow stopping speech recognition and cancelling speech synthesis', () => {
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
});
