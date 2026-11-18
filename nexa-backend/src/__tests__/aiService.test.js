import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatConversationContents,
  NEXA_SYSTEM_INSTRUCTION,
  DEFAULT_USER_CONTEXT,
  buildSystemInstruction,
  getSessionUserContext,
  setSessionUserContext,
  clearSessionUserContext,
  normalizeGeminiError,
} from '../services/ai.service.js';
import { isGeminiConfigured, getGeminiModel, DEFAULT_GEMINI_MODEL } from '../config/gemini.js';

describe('NEXA 2.0 Backend AI Service Test Suite', () => {
  describe('1. Configuration & Persona Rules', () => {
    it('should have a well-defined system instruction mentioning NEXA and multilingual support', () => {
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('NEXA'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Hindi'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('English'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Hinglish'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('honest'));
    });

    it('should know its own name is NEXA', () => {
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Your name is NEXA'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('introduce yourself clearly as NEXA'));
    });

    it('should know the user name is Shivam', () => {
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('The user\'s name is Shivam'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Address the user naturally as Shivam'));
    });

    it('should understand that Shivam is building NEXA 2.0', () => {
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Shivam is building NEXA 2.0'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('creator and developer of NEXA 2.0'));
    });

    it('should accurately explain purpose, technology stack, and implemented capabilities', () => {
      // Tech stack
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('React + Vite'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Node.js + Express'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Google Gemini API'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Browser Web Speech API'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('SpeechRecognition'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('SpeechSynthesis'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Desktop Agent: Planned future phase'));

      // Capabilities
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Conversational reasoning'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Multilingual speech recognition'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Multi-turn conversational dialogue'));
    });

    it('should explicitly prohibit fabricating personal information about Shivam', () => {
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Do NOT fabricate or invent personal details'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('private facts about Shivam'));
    });

    it('should strictly prohibit claiming desktop control or unexecuted automation', () => {
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Desktop control and operating system automation'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('PLANNED FUTURE PHASE'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('NOT currently implemented'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Do NOT pretend, claim, or simulate'));
    });

    it('should return a valid default Gemini model', () => {
      const model = getGeminiModel();
      assert.ok(typeof model === 'string' && model.length > 0);
      assert.equal(DEFAULT_GEMINI_MODEL, 'gemini-2.5-flash');
    });

    it('should accurately report unconfigured state when GEMINI_API_KEY is not set or default placeholder', () => {
      const original = process.env.GEMINI_API_KEY;
      process.env.GEMINI_API_KEY = 'your_gemini_api_key_here';
      assert.equal(isGeminiConfigured(), false);

      process.env.GEMINI_API_KEY = '';
      assert.equal(isGeminiConfigured(), false);

      process.env.GEMINI_API_KEY = 'valid-test-key-12345';
      assert.equal(isGeminiConfigured(), true);

      // Restore
      if (original !== undefined) {
        process.env.GEMINI_API_KEY = original;
      } else {
        delete process.env.GEMINI_API_KEY;
      }
    });
  });

  describe('2. User Context & Session Separation', () => {
    it('DEFAULT_USER_CONTEXT should contain Shivam, NEXA 2.0, and technology specs', () => {
      assert.equal(DEFAULT_USER_CONTEXT.userName, 'Shivam');
      assert.equal(DEFAULT_USER_CONTEXT.projectName, 'NEXA 2.0');
      assert.equal(DEFAULT_USER_CONTEXT.developer, 'Shivam');
      assert.equal(DEFAULT_USER_CONTEXT.technology.frontend, 'React + Vite');
      assert.equal(DEFAULT_USER_CONTEXT.technology.backend, 'Node.js + Express');
      assert.ok(DEFAULT_USER_CONTEXT.technology.ai.includes('Ollama Local'));
      assert.equal(DEFAULT_USER_CONTEXT.technology.primaryAi, 'Ollama Local');
      assert.equal(DEFAULT_USER_CONTEXT.technology.defaultModel, 'llama3.2:latest');
      assert.equal(DEFAULT_USER_CONTEXT.technology.fallbackAi, 'Google Gemini API');
      assert.equal(DEFAULT_USER_CONTEXT.technology.database, 'MongoDB + Mongoose');
      assert.ok(DEFAULT_USER_CONTEXT.technology.voice.includes('Web Speech API'));
      assert.ok(DEFAULT_USER_CONTEXT.technology.desktopAgent.includes('Electron Desktop Agent'));
    });

    it('buildSystemInstruction should dynamically inject custom userContext while preserving rules', () => {
      const custom = {
        userName: 'Shivam',
        projectName: 'NEXA 2.0 Custom',
        developer: 'Shivam',
        projectDescription: 'an autonomous assistant',
      };
      const instruction = buildSystemInstruction(custom);
      assert.ok(instruction.includes('NEXA 2.0 Custom'));
      assert.ok(instruction.includes('The user\'s name is Shivam'));
      assert.ok(instruction.includes('NOT currently implemented'));
    });

    it('session context store should manage session-specific user contexts and clear them cleanly', () => {
      const testSessionId = 'session-test-456';
      assert.deepEqual(getSessionUserContext(testSessionId), DEFAULT_USER_CONTEXT);

      setSessionUserContext(testSessionId, { userName: 'Shivam', customNote: 'Special Session' });
      const stored = getSessionUserContext(testSessionId);
      assert.equal(stored.userName, 'Shivam');
      assert.equal(stored.customNote, 'Special Session');

      clearSessionUserContext(testSessionId);
      assert.deepEqual(getSessionUserContext(testSessionId), DEFAULT_USER_CONTEXT);
    });

    it('should keep user context separate from conversation history in new conversations', () => {
      // In a new conversation, history is empty []
      const contents = formatConversationContents([], 'Who am I?');
      assert.equal(contents.length, 1);
      assert.equal(contents[0].role, 'user');
      assert.equal(contents[0].parts[0].text, 'Who am I?');

      // Contents contains purely the user prompt, NOT userContext objects or metadata
      assert.equal(JSON.stringify(contents).includes('DEFAULT_USER_CONTEXT'), false);
    });
  });

  describe('3. Multi-turn Conversation Formatting', () => {
    it('should format simple user message with no history', () => {
      const contents = formatConversationContents([], 'What is React?');
      assert.equal(contents.length, 1);
      assert.equal(contents[0].role, 'user');
      assert.equal(contents[0].parts[0].text, 'What is React?');
    });

    it('should correctly map user and assistant turns into user and model roles', () => {
      const history = [
        { role: 'user', text: 'Hello' },
        { role: 'assistant', text: 'Hi! How can I help?' },
      ];
      const contents = formatConversationContents(history, 'Tell me a joke');

      assert.equal(contents.length, 3);
      assert.equal(contents[0].role, 'user');
      assert.equal(contents[0].parts[0].text, 'Hello');
      assert.equal(contents[1].role, 'model');
      assert.equal(contents[1].parts[0].text, 'Hi! How can I help?');
      assert.equal(contents[2].role, 'user');
      assert.equal(contents[2].parts[0].text, 'Tell me a joke');
    });

    it('should strip leading model turns so conversation starts with user', () => {
      const history = [
        { role: 'assistant', text: 'Initial greeting from NEXA' },
        { role: 'user', text: 'Hi' },
        { role: 'assistant', text: 'Hello!' },
      ];
      const contents = formatConversationContents(history, 'How are you?');

      assert.equal(contents.length, 3);
      assert.equal(contents[0].role, 'user');
      assert.equal(contents[0].parts[0].text, 'Hi');
      assert.equal(contents[1].role, 'model');
      assert.equal(contents[2].role, 'user');
    });

    it('should handle alternative property names like sender and content', () => {
      const history = [
        { sender: 'user', content: 'Kya haal hai?' },
        { sender: 'assistant', content: 'Main theek hoon! Aap batayein.' },
      ];
      const contents = formatConversationContents(history, 'NEXA kya hai?');

      assert.equal(contents.length, 3);
      assert.equal(contents[0].role, 'user');
      assert.equal(contents[0].parts[0].text, 'Kya haal hai?');
      assert.equal(contents[1].role, 'model');
      assert.equal(contents[1].parts[0].text, 'Main theek hoon! Aap batayein.');
      assert.equal(contents[2].role, 'user');
      assert.equal(contents[2].parts[0].text, 'NEXA kya hai?');
    });

    it('should merge consecutive turns with the same role cleanly', () => {
      const history = [
        { role: 'user', text: 'Message 1' },
        { role: 'user', text: 'Message 2' },
      ];
      const contents = formatConversationContents(history, 'Message 3');

      assert.equal(contents.length, 1);
      assert.equal(contents[0].role, 'user');
      assert.ok(contents[0].parts[0].text.includes('Message 1'));
      assert.ok(contents[0].parts[0].text.includes('Message 2'));
      assert.ok(contents[0].parts[0].text.includes('Message 3'));
    });

    it('should limit turns to maxTurns', () => {
      const longHistory = Array.from({ length: 40 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        text: `Turn ${i}`,
      }));

      const contents = formatConversationContents(longHistory, 'Latest', 10);
      assert.ok(contents.length <= 11);
    });
  });

  describe('4. Error Handling & Normalization', () => {
    it('should map HTTP 400 invalid argument error to 400 without claiming invalid API key', () => {
      const err = new Error(
        'ApiError: {"error":{"code":400,"message":"Developer instruction is not enabled for api version v1. Use api version v1beta instead.","status":"INVALID_ARGUMENT"}}'
      );
      err.status = 400;

      const normalized = normalizeGeminiError(err);
      assert.equal(normalized.statusCode, 400);
      assert.ok(normalized.message.includes('Developer instruction'));
      assert.equal(normalized.message.includes('Invalid Gemini API Key'), false);
    });

    it('should map HTTP 401/403 auth failures to 401 with API key message', () => {
      const err = new Error(
        'ApiError: {"error":{"code":403,"message":"API key not valid. Please pass a valid API key.","status":"API_KEY_INVALID"}}'
      );
      err.status = 403;

      const normalized = normalizeGeminiError(err);
      assert.equal(normalized.statusCode, 401);
      assert.ok(normalized.message.includes('Invalid Gemini API Key'));
    });

    it('should map HTTP 429 quota/rate limit error to 429', () => {
      const err = new Error('Resource has been exhausted (e.g. check quota).');
      err.status = 429;

      const normalized = normalizeGeminiError(err);
      assert.equal(normalized.statusCode, 429);
      assert.ok(normalized.message.includes('quota'));
    });

    it('should map timeout errors to HTTP 504', () => {
      const err = new Error('Gemini API request timed out after 30 seconds.');
      const normalized = normalizeGeminiError(err);
      assert.equal(normalized.statusCode, 504);
      assert.ok(normalized.message.includes('timed out'));
    });

    it('should map internal server error (500) to 500', () => {
      const err = new Error('Internal service error');
      err.status = 500;

      const normalized = normalizeGeminiError(err);
      assert.equal(normalized.statusCode, 500);
      assert.ok(normalized.message.includes('internal error'));
    });
  });

  describe('5. Ollama-First AI Identity & Provider-Aware Instructions', () => {
    it('NEXA_SYSTEM_INSTRUCTION should identify Ollama Local as primary provider and llama3.2:latest as default', () => {
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Primary AI Provider: Ollama Local'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('llama3.2:latest'));
      assert.ok(NEXA_SYSTEM_INSTRUCTION.includes('Optional Cloud Provider: Google Gemini API'));
    });

    it('buildSystemInstruction for Ollama should strictly forbid claiming Gemini is active', () => {
      const instruction = buildSystemInstruction({
        activeProvider: 'ollama',
        activeModel: 'llama3.2:latest',
      });

      assert.ok(instruction.includes('Active AI Provider: Ollama Local (model: llama3.2:latest)'));
      assert.ok(instruction.includes('Never claim or state that Google Gemini is active'));
      assert.ok(instruction.includes('running locally on the user\'s computer via Ollama'));
    });

    it('buildSystemInstruction for Ollama with custom model should reflect custom model', () => {
      const instruction = buildSystemInstruction({
        activeProvider: 'ollama',
        activeModel: 'qwen2.5:7b',
      });

      assert.ok(instruction.includes('Active AI Provider: Ollama Local (model: qwen2.5:7b)'));
      assert.ok(instruction.includes('Never claim or state that Google Gemini is active'));
    });

    it('buildSystemInstruction for Gemini should acknowledge optional cloud operation and Ollama-first design', () => {
      const instruction = buildSystemInstruction({
        activeProvider: 'gemini',
        activeModel: 'gemini-2.5-flash',
        isFallback: false,
      });

      assert.ok(instruction.includes('Active AI Provider: Google Gemini API (model: gemini-2.5-flash)'));
      assert.ok(instruction.includes('operating per explicit user provider selection'));
      assert.ok(instruction.includes('designed as an Ollama-first local AI assistant'));
    });

    it('buildSystemInstruction for Gemini fallback should explicitly explain fallback state', () => {
      const instruction = buildSystemInstruction({
        activeProvider: 'gemini',
        activeModel: 'gemini-1.5-flash',
        isFallback: true,
      });

      assert.ok(instruction.includes('Active AI Provider: Google Gemini API (model: gemini-1.5-flash)'));
      assert.ok(instruction.includes('operating as an explicit fallback because Ollama Local was unavailable'));
    });

    it('should strictly prohibit claiming desktop automation is available when Desktop Agent is not connected', () => {
      const instruction = buildSystemInstruction({
        activeProvider: 'ollama',
        activeModel: 'llama3.2:latest',
      });

      assert.ok(instruction.includes('Electron Desktop Agent'));
      assert.ok(instruction.includes('require the Electron Desktop Agent') || instruction.includes('requires the Electron Desktop Agent'));
      assert.ok(instruction.includes('Currently, the Desktop Agent is NOT connected'));
      assert.ok(instruction.includes('Never claim, pretend, or simulate that desktop automation or computer control is active or available when the Desktop Agent is not connected'));
      assert.ok(instruction.includes('Do NOT pretend, claim, or simulate that you have direct access to the user\'s local operating system'));
    });
  });
});
