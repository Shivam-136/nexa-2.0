import { getGeminiClient, getGeminiModel, isGeminiConfigured } from '../config/gemini.js';

/**
 * User and project context maintained separately from transient conversation history.
 * This ensures identity, creator, and project facts persist across new conversation threads
 * within the configured session without cluttering or depending on prior chat turns.
 */
export const DEFAULT_USER_CONTEXT = Object.freeze({
  userName: 'Shivam',
  projectName: 'NEXA 2.0',
  projectDescription: 'an AI-powered personal computer operator being developed by Shivam',
  developer: 'Shivam',
  technology: {
    frontend: 'React + Vite',
    backend: 'Node.js + Express',
    ai: 'Google Gemini API',
    voice: 'Browser SpeechRecognition and SpeechSynthesis',
    desktopAgent: 'Planned future phase',
  },
  implementedCapabilities: [
    'Conversational AI brain powered by Google Gemini API',
    'Bilingual/Multilingual speech recognition in English and Hindi via Web Speech API',
    'Voice synthesis (TTS) playback with voice and pitch controls',
    'Multi-turn conversational dialogue and history tracking',
    'System health monitoring, telemetry, and rate-limiting',
    'Reactive dashboard with animated AI Orb and waveform visualization',
  ],
  plannedFuturePhases: [
    'Autonomous desktop agent and computer control (planned future phase, not implemented)',
  ],
});

/**
 * In-memory store for session-specific user contexts.
 * Allows preserving custom session user context separately from conversation history.
 */
const sessionContextMap = new Map();

/**
 * Retrieves the user context for a given session, or falls back to DEFAULT_USER_CONTEXT.
 *
 * @param {string} sessionId
 * @returns {Object}
 */
export function getSessionUserContext(sessionId) {
  if (sessionId && sessionContextMap.has(sessionId)) {
    return sessionContextMap.get(sessionId);
  }
  return DEFAULT_USER_CONTEXT;
}

/**
 * Updates or sets the user context for a given session.
 *
 * @param {string} sessionId
 * @param {Object} context
 */
export function setSessionUserContext(sessionId, context) {
  if (!sessionId) return;
  const merged = { ...DEFAULT_USER_CONTEXT, ...context };
  sessionContextMap.set(sessionId, Object.freeze(merged));
}

/**
 * Clears the session user context for a given session.
 *
 * @param {string} sessionId
 */
export function clearSessionUserContext(sessionId) {
  if (sessionId) {
    sessionContextMap.delete(sessionId);
  }
}

/**
 * Builds the comprehensive system instruction for NEXA 2.0.
 * Injects user and project context separately from conversation history turns.
 * Supports injecting long-term persistent memories (Phase 5).
 *
 * @param {Object} [userContext=DEFAULT_USER_CONTEXT]
 * @param {Array<Object>|string} [memories=[]] - Long-term persistent memories
 * @returns {string} System instruction string
 */
export function buildSystemInstruction(userContext = DEFAULT_USER_CONTEXT, memories = []) {
  const userName = userContext?.userName || 'Shivam';
  const projectName = userContext?.projectName || 'NEXA 2.0';
  const projectDesc =
    userContext?.projectDescription ||
    'an AI-powered personal computer operator being developed by Shivam';
  const developer = userContext?.developer || userName;

  let instruction = `You are NEXA, an intelligent, friendly, and conversational AI personal computer operator assistant built for ${projectName}.

OPERATIONAL GUIDELINES & PERSONALITY:

1. Identity:
   - Your name is NEXA.
   - You speak with clarity, confidence, warmth, and professionalism.
   - When asked who you are or your name, introduce yourself clearly as NEXA.

2. User Awareness & Relationship:
   - The user's name is ${userName}.
   - Understand that ${developer} is building ${projectName}.
   - Address the user naturally as ${userName} when appropriate, without being forced or repetitive.

3. Creator & Project Context:
   - ${developer} is the creator and developer of ${projectName}.
   - When asked who created you, who is developing you, or about ${developer}, explain that ${developer} is developing ${projectName}.
   - Do NOT fabricate or invent personal details, background, location, age, employment, contact details, or private facts about ${userName}. You only know that his name is ${userName} and that he is building ${projectName}. If asked about personal or private matters not mentioned, politely and honestly state that you do not have that personal information.

4. Current Project Understanding & Implemented Capabilities:
   When asked about the current project (${projectName}), its purpose, or what you can do, accurately explain:
   - Purpose: ${projectName} is designed to be ${projectDesc}.
   - Technology Stack:
     * Frontend: React + Vite (modern web dashboard, interactive AI Orb, waveform audio visualizer)
     * Backend: Node.js + Express (RESTful API service, rate-limiting, error normalization)
     * AI Brain: Google Gemini API (official @google/genai SDK, multi-turn reasoning)
     * Database: MongoDB + Mongoose (persistent long-term user memories and conversation history)
     * Voice System: Browser Web Speech API (SpeechRecognition for voice input and SpeechSynthesis for text-to-speech)
     * Desktop Agent: Planned future phase (currently NOT implemented)
   - Current Implemented Capabilities:
     * Conversational reasoning and intelligent question-answering powered by Google Gemini API.
     * Persistent long-term memory system across sessions with Remember and Forget directives.
     * Multi-turn conversational dialogue and history tracking.
     * Multilingual speech recognition in English and Hindi via browser SpeechRecognition.
     * Natural voice synthesis (TTS) via browser SpeechSynthesis with customizable voices and pitch.
     * Real-time backend health monitoring, database telemetry, and rate limiting.

5. Honest Capabilities & Desktop Automation Boundaries:
   - Desktop control and operating system automation (such as clicking mouse buttons, typing keystrokes, launching local applications, manipulating windows, modifying files, or running OS terminal commands on the host machine) are in a PLANNED FUTURE PHASE and are NOT currently implemented.
   - Do NOT pretend, claim, or simulate that you have direct access to the user's local operating system, private files, or desktop automation.
   - If asked to perform desktop tasks or automate computer actions, explain honestly and politely that desktop control is a planned future phase and currently only conversational reasoning and voice capabilities are implemented.

6. Language Adaptability & Hinglish Support:
   - You natively understand English, Hindi (हिन्दी in Devanagari script), and Hinglish (Hindi written in Roman/Latin script).
   - Preserve the user's language preference and respond naturally in the same language or dialect that the user used:
     * If addressed in Hinglish (e.g. "kya haal hai", "kaise ho", "NEXA 2.0 me kya features hain"), reply naturally in conversational Roman-script Hinglish. Do NOT unnecessarily convert Hinglish into formal Devanagari Hindi or overly academic language. Keep vocabulary modern, friendly, and natural.
     * If addressed in Hindi (Devanagari script, e.g. "नमस्ते", "आप कैसे हैं?"), reply in natural, clear Hindi in Devanagari script.
     * If addressed in English, reply in natural, fluent English.
   - Preserve natural conversational pronunciation and sentence structure suitable for smooth text-to-speech reading.

7. Brevity & Voice Readiness:
   - Keep responses concise, direct, and conversational. Avoid unnecessarily verbose introductory filler.
   - Your answers are often read aloud via Text-to-Speech (TTS), so format your text smoothly without awkward symbols, excessive asterisks, or messy markdown tables unless requested.

8. Technical Clarity:
   - Explain technical and programming topics accurately, clearly, and concisely.

9. Context Awareness:
   - Maintain awareness of previous messages in the conversation to handle follow-up queries naturally.

10. Truthfulness & Honest Grounding:
    - Never fabricate facts, dates, specifications, or capabilities. If you are uncertain about something or if a feature is not yet built, state honestly what you know and what you do not know.`;

  // Inject long-term persistent memories if provided
  if (Array.isArray(memories) && memories.length > 0) {
    const memoryLines = memories
      .map((m) => {
        const cat = (m.category || 'fact').toUpperCase();
        const val = m.value || m.text || (typeof m === 'string' ? m : '');
        return val ? `- [${cat}] ${val}` : null;
      })
      .filter(Boolean);

    if (memoryLines.length > 0) {
      instruction += `\n\nLONG-TERM USER PREFERENCES & PERSISTENT MEMORIES:
The user has explicitly saved the following long-term preferences, project facts, and instructions:
${memoryLines.join('\n')}
OPERATIONAL RULE: Always respect and seamlessly apply these saved preferences (e.g. preferred language, tone, technical specs) throughout your responses without requiring the user to restate them.`;
    }
  } else if (typeof memories === 'string' && memories.trim()) {
    instruction += `\n\n${memories.trim()}`;
  }

  return instruction;
}

/**
 * System instruction defining NEXA's persona and operational boundaries.
 * Exported for backward compatibility with existing tests and imports.
 */
export const NEXA_SYSTEM_INSTRUCTION = buildSystemInstruction(DEFAULT_USER_CONTEXT);

/**
 * Normalizes and categorizes errors from Gemini API into standard HTTP-status errors.
 *
 * Rules:
 * - HTTP 400: Invalid request or unsupported configuration.
 * - HTTP 401/403: Authentication or API key problem.
 * - HTTP 429: Rate limit or quota issue.
 * - HTTP 500: Internal server error.
 * - HTTP 503: Service temporarily unavailable / high demand.
 * - HTTP 504: Request timeout.
 *
 * @param {Error} error - Caught error object
 * @returns {Error} Normalized error with statusCode property
 */
export function normalizeGeminiError(error) {
  const rawMessage = error.message || '';
  let apiCode = null;
  let apiStatus = null;
  let apiDetail = null;

  // Extract nested JSON error if present in ApiError message
  try {
    const jsonStart = rawMessage.indexOf('{');
    const jsonEnd = rawMessage.lastIndexOf('}');
    if (jsonStart !== -1 && jsonEnd !== -1) {
      const parsed = JSON.parse(rawMessage.substring(jsonStart, jsonEnd + 1));
      if (parsed.error) {
        apiCode = parsed.error.code;
        apiStatus = parsed.error.status;
        apiDetail = parsed.error.message;
      }
    }
  } catch {
    // Plain text error message
  }

  const effectiveStatus = Number(error.status || error.statusCode || apiCode) || null;
  const combined = `${rawMessage} ${apiStatus || ''} ${apiDetail || ''}`.toUpperCase();

  // 1. Request Timeout (504)
  if (
    effectiveStatus === 504 ||
    error.name === 'AbortError' ||
    combined.includes('TIMED OUT') ||
    combined.includes('DEADLINE_EXCEEDED')
  ) {
    const err = new Error('AI brain response timed out. Please check your network connection and retry.');
    err.statusCode = 504;
    return err;
  }

  // 2. Authentication / API Key Problem (401 / 403)
  if (
    effectiveStatus === 401 ||
    effectiveStatus === 403 ||
    combined.includes('API_KEY_INVALID') ||
    combined.includes('API KEY NOT VALID') ||
    combined.includes('UNAUTHENTICATED') ||
    combined.includes('PERMISSION_DENIED')
  ) {
    const err = new Error(
      'Invalid Gemini API Key or authentication failure. Please verify your GEMINI_API_KEY in nexa-backend/.env.'
    );
    err.statusCode = 401;
    return err;
  }

  // 3. Rate Limit / Quota Issue (429)
  if (
    effectiveStatus === 429 ||
    combined.includes('RESOURCE_EXHAUSTED') ||
    combined.includes('QUOTA') ||
    combined.includes('RATE_LIMIT')
  ) {
    const err = new Error('Gemini API rate limit or quota exceeded. Please try again shortly.');
    err.statusCode = 429;
    return err;
  }

  // 4. Invalid Request or Unsupported Configuration (400)
  if (effectiveStatus === 400 || combined.includes('INVALID_ARGUMENT')) {
    const reason = apiDetail || rawMessage || 'Invalid request or unsupported configuration.';
    const err = new Error(`Invalid request or unsupported configuration: ${reason}`);
    err.statusCode = 400;
    return err;
  }

  // 5. Service Temporarily Unavailable / High Demand (503)
  if (
    effectiveStatus === 503 ||
    combined.includes('UNAVAILABLE') ||
    combined.includes('HIGH DEMAND')
  ) {
    const err = new Error('Gemini service is temporarily experiencing high demand. Please try again in a few moments.');
    err.statusCode = 503;
    return err;
  }

  // 6. Internal Server Error (500)
  if (effectiveStatus && effectiveStatus >= 500 && effectiveStatus < 600) {
    const err = new Error('Gemini service encountered an internal error. Please try again later.');
    err.statusCode = 500;
    return err;
  }

  // Fallback: Preserve appropriate status code without assuming invalid API key
  const finalStatus =
    effectiveStatus && effectiveStatus >= 400 && effectiveStatus < 600 ? effectiveStatus : 500;
  const err = new Error(
    apiDetail || rawMessage || 'An unexpected error occurred while communicating with Gemini.'
  );
  err.statusCode = finalStatus;
  return err;
}

/**
 * Validates and converts client-supplied conversation history to the Gemini SDK contents format.
 * Ensures the conversation starts with a 'user' turn and alternates cleanly.
 * Note: Keeps user context separate from conversation history; contents contains ONLY actual chat dialogue turns.
 *
 * @param {Array} history - Prior conversation turns
 * @param {string} currentMessage - The new user prompt
 * @param {number} [maxTurns=20] - Max historical turns to preserve
 * @returns {Array} Gemini contents array
 */
export function formatConversationContents(history = [], currentMessage, maxTurns = 20) {
  const contents = [];

  if (Array.isArray(history)) {
    // Filter out invalid items
    const validHistory = history.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      const text = (item.text || item.content || '').trim();
      return Boolean(text);
    });

    // Take at most the last maxTurns entries
    const trimmedHistory = validHistory.slice(-maxTurns);

    for (const item of trimmedHistory) {
      const rawRole = item.role || item.sender;
      const text = (item.text || item.content || '').trim();

      // Map roles: user -> user, assistant/model -> model
      const role = rawRole === 'assistant' || rawRole === 'model' ? 'model' : 'user';

      // Merge consecutive identical roles
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += `\n${text}`;
      } else {
        contents.push({
          role,
          parts: [{ text }],
        });
      }
    }
  }

  // In multi-turn Gemini conversations, dialogue must start with a 'user' turn.
  // Strip leading 'model' turns (e.g. system welcome message).
  while (contents.length > 0 && contents[0].role === 'model') {
    contents.shift();
  }

  // Append currentMessage as the latest 'user' turn
  const cleanCurrent = currentMessage.trim();
  if (contents.length > 0 && contents[contents.length - 1].role === 'user') {
    // If the latest history turn is already this exact prompt, do not duplicate
    if (contents[contents.length - 1].parts[0].text !== cleanCurrent) {
      contents[contents.length - 1].parts[0].text += `\n${cleanCurrent}`;
    }
  } else {
    contents.push({
      role: 'user',
      parts: [{ text: cleanCurrent }],
    });
  }

  return contents;
}

/**
 * Helper to pause execution for a given number of milliseconds.
 */
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Generates an intelligent AI reply using the official @google/genai SDK (v1beta).
 * User context is maintained separately from conversation history and injected into system instruction.
 * Includes resilience backoff for transient 503 high-demand conditions.
 *
 * @param {Object} params
 * @param {string} params.message - The latest user message.
 * @param {Array} [params.conversationHistory=[]] - Prior conversation turns.
 * @param {Object} [params.userContext] - Optional user context override (defaults to DEFAULT_USER_CONTEXT or session context).
 * @param {string} [params.sessionId] - Optional session ID to resolve persisted session context.
 * @param {Array<Object>|string} [params.memories=[]] - Long-term persistent memories to inject.
 * @param {string} [params.model] - Optional model override.
 * @param {number} [params.timeoutMs=30000] - Request timeout in milliseconds.
 * @param {number} [params.maxRetries=2] - Number of retries on transient errors.
 * @returns {Promise<{ reply: string, model: string }>}
 */
export async function generateAiReply({
  message,
  conversationHistory = [],
  userContext,
  sessionId,
  memories = [],
  model: modelOverride,
  timeoutMs = 30000,
  maxRetries = 2,
}) {
  if (!message || typeof message !== 'string' || !message.trim()) {
    throw new Error('Message cannot be empty.');
  }

  // Resolve user context separately from conversation history
  const activeUserContext =
    userContext ||
    (sessionId ? getSessionUserContext(sessionId) : null) ||
    DEFAULT_USER_CONTEXT;

  const systemInstruction = buildSystemInstruction(activeUserContext, memories);
  const ai = getGeminiClient();
  const model = modelOverride || getGeminiModel();
  const contents = formatConversationContents(conversationHistory, message);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Set up timeout promise
    let timeoutHandle;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Gemini API request timed out after ${timeoutMs / 1000} seconds.`));
      }, timeoutMs);
    });

    try {
      const apiCall = ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          temperature: 0.7,
          maxOutputTokens: 2048,
        },
      });

      const response = await Promise.race([apiCall, timeoutPromise]);
      clearTimeout(timeoutHandle);

      // Extract text from response
      const reply = response.text || '';
      if (!reply) {
        throw new Error('Gemini API returned an empty response. The content may have triggered safety filters.');
      }

      return {
        reply: reply.trim(),
        model,
      };
    } catch (error) {
      clearTimeout(timeoutHandle);

      // Check if transient error (503 Service Unavailable / high demand)
      const rawMsg = error.message || '';
      const isTransient =
        error.status === 503 ||
        error.statusCode === 503 ||
        rawMsg.includes('503') ||
        rawMsg.includes('UNAVAILABLE') ||
        rawMsg.includes('high demand');

      if (isTransient && attempt < maxRetries) {
        const backoffMs = (attempt + 1) * 2000;
        console.warn(`[Gemini AI Service]: Model high demand (503), retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})...`);
        await delay(backoffMs);
        continue;
      }

      console.error('[Gemini AI Service Error]:', error);

      // Normalize error into proper HTTP code without assuming every error is invalid key
      throw normalizeGeminiError(error);
    }
  }
}
