import mongoose from 'mongoose';
import Memory, { MEMORY_CATEGORIES } from '../models/memory.model.js';
import Conversation from '../models/conversation.model.js';

/**
 * Normalizes text by trimming and collapsing multiple spaces.
 * @param {string} str
 * @returns {string}
 */
const cleanString = (str) => (str || '').replace(/\s+/g, ' ').trim();

/**
 * Detects whether an incoming user message is an explicit "Remember" or "Forget" command.
 * Supports English, Hindi (Devanagari), and Hinglish (Roman script).
 *
 * @param {string} message - User message
 * @returns {{ isIntent: boolean, type?: 'remember' | 'forget', target?: string, language?: 'en' | 'hi' | 'hinglish' }}
 */
export function detectMemoryIntent(message) {
  if (!message || typeof message !== 'string') {
    return { isIntent: false };
  }

  const text = cleanString(message);
  const lower = text.toLowerCase();

  // 1. Hindi (Devanagari) Patterns
  // Remember: याद रखना कि..., याद रखो कि..., याद रखो...
  const hiRememberMatch = text.match(/^(?:कृपया\s+)?याद\s+(?:रखना|रखो)(?:\s+कि|\s*:)?\s*(.+)$/i);
  if (hiRememberMatch && hiRememberMatch[1].trim()) {
    return {
      isIntent: true,
      type: 'remember',
      target: hiRememberMatch[1].trim(),
      language: 'hi',
    };
  }

  // Forget: भूल जाओ कि..., भूल जाओ..., मिटा दो...
  const hiForgetMatch = text.match(/^(?:कृपया\s+)?(?:भूल\s+जाओ|मिटा\s+दो)(?:\s+कि|\s*:)?\s*(.+)$/i);
  if (hiForgetMatch && hiForgetMatch[1].trim()) {
    return {
      isIntent: true,
      type: 'forget',
      target: hiForgetMatch[1].trim(),
      language: 'hi',
    };
  }

  // 2. Hinglish Patterns
  // Remember: yaad rakhna ki..., yaad rakho ki..., yaad rakhna...
  const hinglishRememberMatch = lower.match(
    /^(?:please\s+|zara\s+)?yaad\s+(?:rakhna|rakho)(?:\s+ki|\s*:)?\s*(.+)$/i
  );
  if (hinglishRememberMatch && hinglishRememberMatch[1].trim()) {
    return {
      isIntent: true,
      type: 'remember',
      target: hinglishRememberMatch[1].trim(),
      language: 'hinglish',
    };
  }

  // Forget: bhool jao ki..., bhool jao..., bhula do...
  const hinglishForgetMatch = lower.match(
    /^(?:please\s+|zara\s+)?(?:bhool\s+jao|bhula\s+do|mita\s+do)(?:\s+ki|\s*:)?\s*(.+)$/i
  );
  if (hinglishForgetMatch && hinglishForgetMatch[1].trim()) {
    return {
      isIntent: true,
      type: 'forget',
      target: hinglishForgetMatch[1].trim(),
      language: 'hinglish',
    };
  }

  // 3. English Patterns
  // Exact forget-this commands
  if (lower === 'forget this' || lower === 'forget this information' || lower === 'forget this info') {
    return {
      isIntent: true,
      type: 'forget',
      target: 'this information',
      language: 'en',
    };
  }

  // Forget patterns:
  // "Forget that I prefer Hindi", "Forget my project details", "Delete memory about..."
  const enForgetMatch = text.match(
    /^(?:please\s+|can\s+you\s+)?(?:forget\s+(?:that\s+|my\s+|about\s+)?|delete\s+memory\s+(?:about\s+)?|remove\s+memory\s+(?:about\s+)?)(.+)$/i
  );
  if (enForgetMatch && enForgetMatch[1].trim()) {
    return {
      isIntent: true,
      type: 'forget',
      target: enForgetMatch[1].trim(),
      language: 'en',
    };
  }

  // Remember patterns:
  // "Remember that I prefer Hindi.", "Remember my project details: ...", "Take note that...", "Note that..."
  const enRememberMatch = text.match(
    /^(?:please\s+|can\s+you\s+)?(?:remember\s+(?:that\s+|my\s+)?|take\s+note\s+(?:that\s+)?|note\s+(?:that\s+)?|keep\s+in\s+mind\s+(?:that\s+)?)(.+)$/i
  );
  if (enRememberMatch && enRememberMatch[1].trim()) {
    return {
      isIntent: true,
      type: 'remember',
      target: enRememberMatch[1].trim(),
      language: 'en',
    };
  }

  return { isIntent: false };
}

/**
 * Categorizes a memory string into one of the canonical categories.
 *
 * @param {string} text - The memory statement or directive
 * @returns {'preference' | 'project' | 'personal' | 'instruction' | 'fact' | 'other'}
 */
export function categorizeMemory(text) {
  if (!text) return 'fact';
  const lower = text.toLowerCase();

  // 1. Explicit Instructions / Rules (checked first to prioritize operational directives)
  if (
    lower.includes('always') ||
    lower.includes('never') ||
    lower.includes('rule') ||
    lower.includes('instruction') ||
    lower.includes('hamesha') ||
    lower.includes('kabhi mat')
  ) {
    return 'instruction';
  }

  // 2. Language / Communication Preferences
  if (
    lower.includes('prefer') ||
    lower.includes('preference') ||
    lower.includes('like') ||
    lower.includes('favorite') ||
    lower.includes('favourite') ||
    lower.includes('pasand') ||
    lower.includes('chahta hoon') ||
    lower.includes('theme') ||
    lower.includes('mode') ||
    lower.includes('voice') ||
    lower.includes('tone')
  ) {
    return 'preference';
  }

  // 3. Personal facts
  if (
    lower.includes('name is') ||
    lower.includes('naam') ||
    lower.includes('live in') ||
    lower.includes('location') ||
    lower.includes('city') ||
    lower.includes('birthday') ||
    lower.includes('rehta hoon') ||
    lower.includes('engineer') ||
    lower.includes('developer')
  ) {
    return 'personal';
  }

  // 4. Project details & Technical stack
  if (
    lower.includes('project') ||
    lower.includes('nexa') ||
    lower.includes('stack') ||
    lower.includes('react') ||
    lower.includes('node') ||
    lower.includes('express') ||
    lower.includes('vite') ||
    lower.includes('mongodb') ||
    lower.includes('repo') ||
    lower.includes('code') ||
    lower.includes('build') ||
    lower.includes('developing')
  ) {
    return 'project';
  }

  return 'fact';
}

/**
 * Derives a normalized unique key for deduplication based on content.
 *
 * @param {string} category
 * @param {string} text
 * @returns {string} Key identifier (e.g. 'preferred_language', 'project_details')
 */
export function deriveMemoryKey(category, text) {
  const lower = (text || '').toLowerCase();

  // Common language preference detection
  if (lower.includes('hindi') || lower.includes('हिन्दी') || lower.includes('hinglish')) {
    return 'preferred_language';
  }
  if (lower.includes('english')) {
    return 'preferred_language';
  }
  if (lower.includes('dark mode') || lower.includes('light mode') || lower.includes('theme')) {
    return 'ui_theme_preference';
  }
  if (lower.includes('project details') || lower.includes('project detail')) {
    return 'project_details';
  }
  if (lower.includes('tech stack') || lower.includes('technology stack')) {
    return 'tech_stack';
  }

  // Fallback: derive slug from first 4 significant alphanumeric words
  const words = lower
    .replace(/[^a-z0-9\s]/g, '')
    .split(/\s+/)
    .filter((w) => w && !['i', 'my', 'that', 'the', 'a', 'an', 'is', 'to', 'in', 'of', 'and'].includes(w))
    .slice(0, 4);

  const slug = words.join('_');
  return slug ? `${category}_${slug}` : `${category}_${Date.now()}`;
}

/**
 * Formats a clean memory value string from the raw target directive.
 *
 * @param {string} target
 * @returns {string} Clean memory statement
 */
export function cleanMemoryValue(target) {
  let val = cleanString(target);
  // Remove leading punctuation or quotes
  val = val.replace(/^[:\-–—"'\s]+/, '').replace(/["'\s]+$/, '');
  // Capitalize first letter
  if (val.length > 0) {
    val = val.charAt(0).toUpperCase() + val.slice(1);
  }
  return val;
}

/**
 * Saves or updates a memory entry with automatic deduplication.
 * If an active memory with the same key already exists for the user,
 * it updates the value rather than creating duplicate entries.
 *
 * @param {Object} params
 * @param {string} [params.userId='shivam']
 * @param {string} [params.category]
 * @param {string} [params.key]
 * @param {string} params.value
 * @param {string} [params.rawInput]
 * @param {Object} [params.metadata]
 * @returns {Promise<{ memory: Object, isNew: boolean }>}
 */
export async function saveMemory({
  userId = 'shivam',
  category,
  key,
  value,
  rawInput = '',
  metadata = {},
}) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Database is currently not connected. Cannot persist memory.');
  }

  const cleanVal = cleanMemoryValue(value);
  if (!cleanVal) {
    throw new Error('Memory value cannot be empty.');
  }

  const detectedCategory = category && MEMORY_CATEGORIES.includes(category)
    ? category
    : categorizeMemory(cleanVal);

  const normalizedKey = key ? key.toLowerCase().trim() : deriveMemoryKey(detectedCategory, cleanVal);

  // Check for existing active memory with the same key or exact value for this user
  let existing = await Memory.findOne({
    userId,
    isActive: true,
    $or: [{ key: normalizedKey }, { value: cleanVal }],
  });

  if (existing) {
    existing.value = cleanVal;
    existing.category = detectedCategory;
    existing.rawInput = rawInput || existing.rawInput;
    existing.metadata = { ...existing.metadata, ...metadata, updatedVia: 'dedup_upsert' };
    await existing.save();
    return { memory: existing.toObject(), isNew: false };
  }

  const newMemory = await Memory.create({
    userId,
    category: detectedCategory,
    key: normalizedKey,
    value: cleanVal,
    rawInput: rawInput || cleanVal,
    metadata: { ...metadata, source: metadata.source || 'chat' },
    isActive: true,
  });

  return { memory: newMemory.toObject(), isNew: true };
}

/**
 * Deactivates or removes memory entries matching a user's forget directive.
 *
 * @param {Object} params
 * @param {string} [params.userId='shivam']
 * @param {string} params.target - What the user wants to forget
 * @returns {Promise<{ count: number, forgottenKeys: string[] }>}
 */
export async function forgetMemory({ userId = 'shivam', target }) {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Database is currently not connected. Cannot modify memory.');
  }

  const cleanTarget = cleanString(target).toLowerCase();
  if (!cleanTarget) {
    return { count: 0, forgottenKeys: [] };
  }

  // 1. If target is "this" or "this information", forget the most recently created active memory
  if (cleanTarget === 'this' || cleanTarget === 'this information' || cleanTarget === 'this info') {
    const latest = await Memory.findOne({ userId, isActive: true }).sort({ createdAt: -1 });
    if (latest) {
      latest.isActive = false;
      await latest.save();
      return { count: 1, forgottenKeys: [latest.key] };
    }
    return { count: 0, forgottenKeys: [] };
  }

  // 2. Identify by key or regex matching on key, value, or rawInput
  const searchRegex = new RegExp(cleanTarget.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

  const matches = await Memory.find({
    userId,
    isActive: true,
    $or: [
      { key: searchRegex },
      { value: searchRegex },
      { rawInput: searchRegex },
    ],
  });

  if (matches.length === 0) {
    // Try word-based matching if specific exact phrase didn't match
    const words = cleanTarget.split(' ').filter((w) => w.length > 3);
    if (words.length > 0) {
      const orConditions = words.map((w) => ({
        value: new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      }));
      const fallbackMatches = await Memory.find({
        userId,
        isActive: true,
        $or: orConditions,
      });

      if (fallbackMatches.length > 0) {
        const forgottenKeys = [];
        for (const m of fallbackMatches) {
          m.isActive = false;
          await m.save();
          forgottenKeys.push(m.key);
        }
        return { count: fallbackMatches.length, forgottenKeys };
      }
    }

    return { count: 0, forgottenKeys: [] };
  }

  const forgottenKeys = [];
  for (const m of matches) {
    m.isActive = false;
    await m.save();
    forgottenKeys.push(m.key);
  }

  return { count: matches.length, forgottenKeys };
}

/**
 * Retrieves relevant active memories for context injection into Gemini requests.
 * Prioritizes user preferences and memories matching the query terms.
 * Avoids sending unnecessary or unrelated memories to preserve token budget.
 *
 * @param {Object} params
 * @param {string} [params.userId='shivam']
 * @param {string} [params.query='']
 * @param {number} [params.limit=10]
 * @returns {Promise<Array<Object>>}
 */
export async function getRelevantMemories({ userId = 'shivam', query = '', limit = 10 }) {
  if (mongoose.connection.readyState !== 1) {
    return [];
  }

  try {
    // Retrieve all active memories for the user (typically < 100 for a personal assistant)
    const allMemories = await Memory.find({ userId, isActive: true })
      .sort({ createdAt: -1 })
      .lean();

    if (!allMemories || allMemories.length === 0) {
      return [];
    }

    // If total memories is small, return all of them up to limit (preferences first)
    if (allMemories.length <= limit) {
      return allMemories.sort((a, b) => {
        if (a.category === 'preference' && b.category !== 'preference') return -1;
        if (b.category === 'preference' && a.category !== 'preference') return 1;
        return 0;
      });
    }

    // When query is provided, score memories by relevance
    const queryTerms = cleanString(query)
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const scored = allMemories.map((mem) => {
      let score = 0;
      // Preferences and instructions always get baseline priority
      if (mem.category === 'preference') score += 5;
      if (mem.category === 'instruction') score += 4;
      if (mem.category === 'project') score += 3;

      const memText = `${mem.key} ${mem.value} ${mem.rawInput}`.toLowerCase();
      for (const term of queryTerms) {
        if (memText.includes(term)) {
          score += 10;
        }
      }

      return { mem, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => s.mem);
  } catch (error) {
    console.error('[Memory Retrieval Error]:', error.message);
    return [];
  }
}

/**
 * Formats an array of memories into a structured markdown block for the Gemini system prompt.
 *
 * @param {Array<Object>} memories
 * @returns {string} Formatted instructions section
 */
export function formatMemoriesForPrompt(memories = []) {
  if (!Array.isArray(memories) || memories.length === 0) {
    return '';
  }

  const lines = memories.map((m) => {
    const cat = (m.category || 'fact').toUpperCase();
    return `- [${cat}] ${m.value}`;
  });

  return `\n\nLONG-TERM USER PREFERENCES & PERSISTENT MEMORIES:
The user has explicitly saved the following long-term preferences, project facts, and instructions:
${lines.join('\n')}
OPERATIONAL RULE: Always respect and seamlessly apply these saved preferences (e.g. preferred language, tone, technical specs) throughout your responses without requiring the user to restate them.`;
}

/**
 * Generates an empathetic and natural confirmation message for a remembered fact.
 *
 * @param {string} value
 * @param {'en' | 'hi' | 'hinglish'} [lang='en']
 * @returns {string}
 */
export function generateRememberConfirmation(value, lang = 'en') {
  if (lang === 'hi') {
    return `मैंने याद रख लिया है कि "${value}"। मैं आपकी इस पसंद का हमेशा ध्यान रखूँगा।`;
  }
  if (lang === 'hinglish') {
    return `Maine yaad rakh liya hai ki: "${value}". Main aage se is baat ka dhyan rakhunga!`;
  }
  return `I have committed that to memory: "${value}". I will remember this across our conversations.`;
}

/**
 * Generates a natural confirmation message for a forgotten fact.
 *
 * @param {number} count
 * @param {'en' | 'hi' | 'hinglish'} [lang='en']
 * @returns {string}
 */
export function generateForgetConfirmation(count, lang = 'en') {
  if (count === 0) {
    if (lang === 'hi') {
      return 'मुझे अपनी मेमोरी में इससे संबंधित कोई जानकारी नहीं मिली।';
    }
    if (lang === 'hinglish') {
      return 'Mujhe memory me isse related koi saved info nahi mili.';
    }
    return "I couldn't find any saved memories matching that description.";
  }

  if (lang === 'hi') {
    return `ठीक है, मैंने यह जानकारी अपनी मेमोरी से हटा दी है।`;
  }
  if (lang === 'hinglish') {
    return `Theek hai, maine yeh information apni memory se remove kar di hai.`;
  }
  return `Understood. I have removed ${count === 1 ? 'this memory' : `${count} matching memories`} from my persistent storage.`;
}

/**
 * Asynchronously persists a conversation turn (user prompt and assistant response) into MongoDB.
 * Non-blocking: failures are logged without disrupting the HTTP chat response.
 *
 * @param {Object} params
 * @param {string} params.conversationId
 * @param {string} [params.userId='shivam']
 * @param {string} params.userText
 * @param {string} params.assistantReply
 * @param {string} [params.model]
 */
export async function persistConversationTurn({
  conversationId,
  userId = 'shivam',
  userText,
  assistantReply,
  model,
}) {
  if (mongoose.connection.readyState !== 1 || !conversationId) {
    return;
  }

  try {
    let conversation = await Conversation.findOne({ conversationId, userId });

    const userMessage = {
      id: `msg_${Date.now()}_u`,
      sender: 'user',
      role: 'user',
      text: userText,
      timestamp: new Date(),
    };

    const assistantMessage = {
      id: `msg_${Date.now()}_a`,
      sender: 'assistant',
      role: 'model',
      text: assistantReply,
      model: model || 'Gemini',
      timestamp: new Date(),
    };

    if (!conversation) {
      // Derive a friendly title from the first prompt
      const title = userText.length > 50 ? `${userText.substring(0, 47)}...` : userText;

      await Conversation.create({
        conversationId,
        userId,
        title,
        messages: [userMessage, assistantMessage],
        messageCount: 2,
        lastActivityAt: new Date(),
      });
    } else {
      conversation.messages.push(userMessage, assistantMessage);
      conversation.messageCount = conversation.messages.length;
      conversation.lastActivityAt = new Date();
      await conversation.save();
    }
  } catch (error) {
    console.warn('[Conversation Persistence Warning]:', error.message);
  }
}

/**
 * Lists memories with pagination, category filtering, and keyword search.
 */
export async function listMemories({ userId = 'shivam', category, search, page = 1, limit = 50 }) {
  if (mongoose.connection.readyState !== 1) {
    return { memories: [], total: 0, page, totalPages: 0 };
  }

  const query = { userId, isActive: true };

  if (category && category !== 'All' && MEMORY_CATEGORIES.includes(category)) {
    query.category = category;
  }

  if (search && search.trim()) {
    const s = search.trim();
    query.$or = [
      { key: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
      { value: new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') },
    ];
  }

  const skip = (Math.max(1, page) - 1) * limit;
  const [memories, total] = await Promise.all([
    Memory.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Memory.countDocuments(query),
  ]);

  return {
    memories,
    total,
    page: Number(page),
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Deletes an individual memory by ID.
 */
export async function deleteMemoryById(id, userId = 'shivam') {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Database is not connected.');
  }

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new Error('Invalid memory ID format.');
  }

  const result = await Memory.findOneAndDelete({ _id: id, userId });
  return Boolean(result);
}

/**
 * Clears all active memories for a given user.
 */
export async function clearAllUserMemories(userId = 'shivam') {
  if (mongoose.connection.readyState !== 1) {
    throw new Error('Database is not connected.');
  }

  const result = await Memory.deleteMany({ userId });
  return result.deletedCount || 0;
}

export default {
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
};
