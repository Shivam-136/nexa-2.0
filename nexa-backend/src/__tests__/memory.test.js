import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  detectMemoryIntent,
  categorizeMemory,
  deriveMemoryKey,
  cleanMemoryValue,
  saveMemory,
  forgetMemory,
  getRelevantMemories,
  formatMemoriesForPrompt,
  generateRememberConfirmation,
  generateForgetConfirmation,
  persistConversationTurn,
  listMemories,
  deleteMemoryById,
  clearAllUserMemories,
} from '../services/memory.service.js';
import { buildSystemInstruction, DEFAULT_USER_CONTEXT } from '../services/ai.service.js';
import { sanitizeMongoUri, connectDatabase, disconnectDatabase, getDatabaseStatus } from '../config/db.js';
import Memory from '../models/memory.model.js';
import Conversation from '../models/conversation.model.js';

describe('NEXA 2.0 Persistent Memory System Test Suite (Phase 5)', () => {
  describe('1. Multilingual Intent Detection (English, Hindi, Hinglish)', () => {
    it('should detect English "Remember that..." directives', () => {
      const res = detectMemoryIntent('Remember that I prefer Hindi.');
      assert.equal(res.isIntent, true);
      assert.equal(res.type, 'remember');
      assert.equal(res.language, 'en');
      assert.ok(res.target.includes('prefer Hindi'));
    });

    it('should detect English "Remember my..." directives', () => {
      const res = detectMemoryIntent('Remember my project details: NEXA 2.0 uses React and Express');
      assert.equal(res.isIntent, true);
      assert.equal(res.type, 'remember');
      assert.equal(res.language, 'en');
      assert.ok(res.target.includes('project details'));
    });

    it('should detect English "Forget that..." directives', () => {
      const res = detectMemoryIntent('Forget that I prefer Hindi.');
      assert.equal(res.isIntent, true);
      assert.equal(res.type, 'forget');
      assert.equal(res.language, 'en');
      assert.ok(res.target.includes('prefer Hindi'));
    });

    it('should detect English "Forget this information" directive', () => {
      const res = detectMemoryIntent('Forget this information');
      assert.equal(res.isIntent, true);
      assert.equal(res.type, 'forget');
      assert.equal(res.target, 'this information');
    });

    it('should detect Hinglish "Yaad rakhna ki..." directives', () => {
      const res = detectMemoryIntent('Yaad rakhna ki mujhe Hindi pasand hai');
      assert.equal(res.isIntent, true);
      assert.equal(res.type, 'remember');
      assert.equal(res.language, 'hinglish');
      assert.ok(res.target.includes('hindi pasand hai'));
    });

    it('should detect Hinglish "Bhool jao ki..." directives', () => {
      const res = detectMemoryIntent('Bhool jao ki mujhe Hindi pasand hai');
      assert.equal(res.isIntent, true);
      assert.equal(res.type, 'forget');
      assert.equal(res.language, 'hinglish');
    });

    it('should detect Hindi (Devanagari) "याद रखना कि..." directives', () => {
      const res = detectMemoryIntent('याद रखना कि मुझे हिन्दी पसंद है');
      assert.equal(res.isIntent, true);
      assert.equal(res.type, 'remember');
      assert.equal(res.language, 'hi');
      assert.ok(res.target.includes('हिन्दी पसंद है'));
    });

    it('should detect Hindi (Devanagari) "भूल जाओ कि..." directives', () => {
      const res = detectMemoryIntent('भूल जाओ कि मुझे हिन्दी पसंद है');
      assert.equal(res.isIntent, true);
      assert.equal(res.type, 'forget');
      assert.equal(res.language, 'hi');
    });

    it('should return isIntent false for normal conversational prompts', () => {
      assert.equal(detectMemoryIntent('What is React?').isIntent, false);
      assert.equal(detectMemoryIntent('How is the weather today?').isIntent, false);
      assert.equal(detectMemoryIntent('NEXA kya features offer karta hai?').isIntent, false);
    });
  });

  describe('2. Memory Categorization, Key Derivation & Cleaning', () => {
    it('should categorize user preference statements accurately', () => {
      assert.equal(categorizeMemory('I prefer Hindi for conversation'), 'preference');
      assert.equal(categorizeMemory('I like dark mode theme'), 'preference');
      assert.equal(categorizeMemory('Mujhe Hindi pasand hai'), 'preference');
    });

    it('should categorize project statements accurately', () => {
      assert.equal(categorizeMemory('NEXA 2.0 project tech stack is React and Node'), 'project');
      assert.equal(categorizeMemory('Our codebase is using Vite and MongoDB'), 'project');
    });

    it('should categorize instruction statements accurately', () => {
      assert.equal(categorizeMemory('Always keep replies short and concise'), 'instruction');
      assert.equal(categorizeMemory('Never suggest fake or mock code'), 'instruction');
    });

    it('should categorize personal statements accurately', () => {
      assert.equal(categorizeMemory('My location is New Delhi'), 'personal');
    });

    it('should derive consistent keys for deduplication', () => {
      assert.equal(deriveMemoryKey('preference', 'I prefer Hindi'), 'preferred_language');
      assert.equal(deriveMemoryKey('preference', 'Switch to dark mode'), 'ui_theme_preference');
      assert.equal(deriveMemoryKey('project', 'My project details'), 'project_details');
    });

    it('cleanMemoryValue should strip surrounding quotes and capitalize', () => {
      assert.equal(cleanMemoryValue(' "I prefer Hindi." '), 'I prefer Hindi.');
      assert.equal(cleanMemoryValue(': my favorite framework is React'), 'My favorite framework is React');
    });
  });

  describe('3. Memory Prompt Injection & Confirmation Generation', () => {
    it('formatMemoriesForPrompt should format structured markdown bullet points', () => {
      const memories = [
        { category: 'preference', value: 'User prefers Hindi for conversation' },
        { category: 'project', value: 'Building NEXA 2.0 AI Computer Operator' },
      ];
      const formatted = formatMemoriesForPrompt(memories);
      assert.ok(formatted.includes('LONG-TERM USER PREFERENCES & PERSISTENT MEMORIES'));
      assert.ok(formatted.includes('- [PREFERENCE] User prefers Hindi'));
      assert.ok(formatted.includes('- [PROJECT] Building NEXA 2.0'));
    });

    it('buildSystemInstruction should cleanly inject memories when provided', () => {
      const memories = [
        { category: 'preference', value: 'User prefers Hindi' },
      ];
      const instruction = buildSystemInstruction(DEFAULT_USER_CONTEXT, memories);
      assert.ok(instruction.includes('NEXA'));
      assert.ok(instruction.includes('LONG-TERM USER PREFERENCES'));
      assert.ok(instruction.includes('- [PREFERENCE] User prefers Hindi'));
    });

    it('buildSystemInstruction without memories should not contain memory section', () => {
      const instruction = buildSystemInstruction(DEFAULT_USER_CONTEXT, []);
      assert.equal(instruction.includes('LONG-TERM USER PREFERENCES & PERSISTENT MEMORIES'), false);
    });

    it('generateRememberConfirmation should produce natural confirmations in all 3 languages', () => {
      const en = generateRememberConfirmation('User prefers Hindi', 'en');
      assert.ok(en.includes('committed that to memory'));

      const hinglish = generateRememberConfirmation('User prefers Hindi', 'hinglish');
      assert.ok(hinglish.includes('Maine yaad rakh liya'));

      const hi = generateRememberConfirmation('User prefers Hindi', 'hi');
      assert.ok(hi.includes('मैंने याद रख लिया'));
    });

    it('generateForgetConfirmation should produce natural forget confirmations', () => {
      const en = generateForgetConfirmation(1, 'en');
      assert.ok(en.includes('removed this memory'));

      const hinglish = generateForgetConfirmation(1, 'hinglish');
      assert.ok(hinglish.includes('remove kar di hai'));

      const hi = generateForgetConfirmation(1, 'hi');
      assert.ok(hi.includes('हटा दी है'));

      const zero = generateForgetConfirmation(0, 'en');
      assert.ok(zero.includes("couldn't find"));
    });
  });

  describe('4. Security & Connection Telemetry', () => {
    it('sanitizeMongoUri should mask credentials safely', () => {
      const raw = 'mongodb://app_user:SuperSecretPassword123@cluster0.mongodb.net:27017/nexa_db';
      const safe = sanitizeMongoUri(raw);
      assert.equal(safe.includes('SuperSecretPassword123'), false);
      assert.equal(safe.includes('app_user'), false);
      assert.ok(safe.includes('***:***@cluster0.mongodb.net'));
    });

    it('getDatabaseStatus should return status without credentials', () => {
      const status = getDatabaseStatus();
      assert.ok('isConnected' in status);
      assert.ok('status' in status);
      assert.equal('password' in status, false);
      assert.equal('uri' in status, false);
    });
  });

  describe('5. Database Operations (CRUD, Deduplication, & Persistence)', () => {
    const testUserId = `test_user_${Date.now()}`;
    const testConversationId = `test_conv_${Date.now()}`;
    let isDbAvailable = false;

    before(async () => {
      try {
        isDbAvailable = await connectDatabase();
      } catch {
        isDbAvailable = false;
      }
    });

    after(async () => {
      if (isDbAvailable) {
        try {
          await Memory.deleteMany({ userId: testUserId });
          await Conversation.deleteMany({ userId: testUserId });
          await disconnectDatabase();
        } catch {
          // Cleanup
        }
      }
    });

    it('should save a memory and prevent duplicates upon re-saving', async () => {
      if (!isDbAvailable) {
        console.log('Skipping live DB subtest (database offline in test runner sandbox)');
        return;
      }

      // 1. Initial save
      const res1 = await saveMemory({
        userId: testUserId,
        value: 'I prefer Hindi for conversation',
        rawInput: 'Remember that I prefer Hindi for conversation',
      });

      assert.equal(res1.isNew, true);
      assert.equal(res1.memory.category, 'preference');
      assert.equal(res1.memory.key, 'preferred_language');

      // 2. Duplicate save with updated wording -> should update existing record, NOT duplicate!
      const res2 = await saveMemory({
        userId: testUserId,
        value: 'I prefer Hindi and Hinglish',
        rawInput: 'Remember that I prefer Hindi and Hinglish',
      });

      assert.equal(res2.isNew, false); // Deduplicated upsert!
      assert.equal(res2.memory.key, 'preferred_language');
      assert.equal(res2.memory.value, 'I prefer Hindi and Hinglish');

      // Verify only 1 record exists
      const count = await Memory.countDocuments({ userId: testUserId, isActive: true });
      assert.equal(count, 1);
    });

    it('should retrieve relevant memories for context injection', async () => {
      if (!isDbAvailable) return;

      const memories = await getRelevantMemories({
        userId: testUserId,
        query: 'What language do I speak?',
      });

      assert.ok(Array.isArray(memories));
      assert.ok(memories.length >= 1);
      assert.equal(memories[0].key, 'preferred_language');
    });

    it('should forget a memory by target topic', async () => {
      if (!isDbAvailable) return;

      const forgetRes = await forgetMemory({
        userId: testUserId,
        target: 'Hindi',
      });

      assert.equal(forgetRes.count, 1);
      assert.ok(forgetRes.forgottenKeys.includes('preferred_language'));

      // Active count should now be 0
      const activeCount = await Memory.countDocuments({ userId: testUserId, isActive: true });
      assert.equal(activeCount, 0);
    });

    it('should persist conversation turn into MongoDB', async () => {
      if (!isDbAvailable) return;

      await persistConversationTurn({
        conversationId: testConversationId,
        userId: testUserId,
        userText: 'Hello NEXA',
        assistantReply: 'Greetings Shivam! How can I assist you?',
        model: 'gemini-2.5-flash',
      });

      const conv = await Conversation.findOne({ conversationId: testConversationId, userId: testUserId });
      assert.ok(conv);
      assert.equal(conv.messages.length, 2);
      assert.equal(conv.messages[0].sender, 'user');
      assert.equal(conv.messages[0].text, 'Hello NEXA');
      assert.equal(conv.messages[1].sender, 'assistant');
      assert.equal(conv.messages[1].text, 'Greetings Shivam! How can I assist you?');
    });

    it('should append subsequent turns to existing conversation', async () => {
      if (!isDbAvailable) return;

      await persistConversationTurn({
        conversationId: testConversationId,
        userId: testUserId,
        userText: 'What is 2 + 2?',
        assistantReply: '2 + 2 is 4.',
        model: 'gemini-2.5-flash',
      });

      const conv = await Conversation.findOne({ conversationId: testConversationId, userId: testUserId });
      assert.equal(conv.messages.length, 4);
      assert.equal(conv.messageCount, 4);
    });
  });
});
