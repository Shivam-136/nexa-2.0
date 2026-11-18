import { generateAiReply } from './ai.service.js';
import { isGeminiConfigured, getGeminiModel } from '../config/gemini.js';
import { generateOllamaReply } from './ollama.service.js';
import { getOllamaModel } from '../config/ollama.js';

/**
 * List of supported AI providers for NEXA 2.0.
 */
export const SUPPORTED_PROVIDERS = Object.freeze(['ollama', 'gemini']);

/**
 * Default AI provider for NEXA 2.0.
 * Ollama remains the default local-first provider.
 */
export const DEFAULT_PROVIDER = 'ollama';

/**
 * Validates and normalizes the AI provider from authenticated user preferences.
 * Ollama remains the default provider.
 * Rejects invalid providers safely.
 *
 * @param {Object} [user] - Authenticated req.user object
 * @returns {string} Normalized provider ('ollama' | 'gemini')
 * @throws {Error} If provider is unsupported
 */
export function resolveProvider(user) {
  const rawProvider = user?.aiProvider;

  // If undefined, null, or empty string, default strictly to 'ollama'
  if (rawProvider === undefined || rawProvider === null || rawProvider === '') {
    return DEFAULT_PROVIDER;
  }

  if (typeof rawProvider !== 'string') {
    const err = new Error(`Invalid AI provider type "${typeof rawProvider}". Expected string.`);
    err.statusCode = 400;
    err.code = 'INVALID_AI_PROVIDER';
    throw err;
  }

  const normalized = rawProvider.trim().toLowerCase();

  if (!SUPPORTED_PROVIDERS.includes(normalized)) {
    const err = new Error(
      `Invalid AI provider: "${rawProvider}". Supported providers are ${SUPPORTED_PROVIDERS.map((p) => `"${p}"`).join(' and ')}.`
    );
    err.statusCode = 400;
    err.code = 'INVALID_AI_PROVIDER';
    throw err;
  }

  return normalized;
}

/**
 * Centralized AI Provider Orchestration Service (Phase 6 Milestone 2.3).
 *
 * Directs chat and reasoning requests to the authenticated user's selected provider:
 * - 'ollama' (default, local-first inference)
 * - 'gemini' (cloud reasoning, explicit user selection only)
 *
 * Explicit Fallback Guardrails:
 * - When Ollama fails, check user's geminiFallback preference.
 * - If false: re-throw normalized Ollama error (never silently use Gemini).
 * - If true and Gemini is configured: execute fallback with fallbackUsed: true.
 * - If true but Gemini is unconfigured: re-throw Ollama error.
 * - Security violations (SSRF, unsafe redirect) NEVER trigger fallback.
 *
 * @param {Object} params
 * @param {Object} [params.user] - Verified req.user object
 * @param {string} params.message - Latest user prompt
 * @param {Array} [params.conversationHistory=[]] - Prior conversation turns
 * @param {Object} [params.userContext] - User/persona context
 * @param {string} [params.sessionId] - Conversation or session ID
 * @param {Array<Object>|string} [params.memories=[]] - Long-term persistent memories
 * @param {number} [params.timeoutMs] - Optional request timeout override
 * @returns {Promise<{ reply: string, provider: string, model: string, fallbackUsed: boolean }>}
 */
export async function routeChatRequest({
  user,
  message,
  conversationHistory = [],
  userContext,
  sessionId,
  memories = [],
  timeoutMs,
  _deps = {},
} = {}) {
  const generateAi = _deps.generateAiReply || generateAiReply;
  const generateOllama = _deps.generateOllamaReply || generateOllamaReply;
  const checkGeminiConfig = _deps.isGeminiConfigured || isGeminiConfigured;
  const getModelOllama = _deps.getOllamaModel || getOllamaModel;

  const provider = resolveProvider(user);

  // 1. Explicit Gemini routing
  if (provider === 'gemini') {
    const result = await generateAi({
      message,
      conversationHistory,
      userContext,
      sessionId,
      memories,
      timeoutMs,
    });

    return {
      reply: result.reply,
      provider: 'gemini',
      model: result.model,
      fallbackUsed: false,
    };
  }

  // 2. Ollama routing (Default provider)
  const ollamaModel = (typeof user?.ollamaModel === 'string' && user.ollamaModel.trim()) || getModelOllama();
  const allowFallback = Boolean(user?.geminiFallback);

  try {
    const result = await generateOllama({
      message,
      conversationHistory,
      userContext,
      sessionId,
      memories,
      model: ollamaModel,
      timeoutMs,
    });

    return {
      reply: result.reply,
      provider: 'ollama',
      model: result.model,
      fallbackUsed: false,
    };
  } catch (ollamaErr) {
    // Security violations (SSRF, unsafe redirects, invalid configs) MUST NEVER fall back to Gemini
    if (
      ollamaErr.code === 'OLLAMA_UNSAFE_REDIRECT' ||
      ollamaErr.code === 'OLLAMA_INVALID_REDIRECT' ||
      ollamaErr.code === 'OLLAMA_UNEXPECTED_REDIRECT' ||
      ollamaErr.code === 'OLLAMA_INVALID_CONFIG'
    ) {
      throw ollamaErr;
    }

    // If explicit Gemini fallback is NOT enabled by user preference:
    // Strictly return the clear Ollama error. Never silently switch to Gemini.
    if (!allowFallback) {
      throw ollamaErr;
    }

    // Check if Gemini is configured on the backend
    if (!checkGeminiConfig()) {
      console.warn(
        '[AI Provider Orchestration]: Ollama failed and geminiFallback is true, but Gemini API key is not configured. Returning Ollama error.'
      );
      throw ollamaErr;
    }

    // Explicit fallback to Gemini
    console.info(
      `[AI Provider Orchestration]: Ollama (${ollamaModel}) unavailable; executing explicit fallback to Gemini per user preference.`
    );

    try {
      const geminiResult = await generateAi({
        message,
        conversationHistory,
        userContext,
        sessionId,
        memories,
        timeoutMs,
      });

      return {
        reply: geminiResult.reply,
        provider: 'gemini',
        model: geminiResult.model,
        fallbackUsed: true,
      };
    } catch (geminiErr) {
      console.error(
        '[AI Provider Orchestration]: Gemini fallback failed after Ollama failure.',
        geminiErr
      );
      throw geminiErr;
    }
  }
}

export default {
  SUPPORTED_PROVIDERS,
  DEFAULT_PROVIDER,
  resolveProvider,
  routeChatRequest,
};
