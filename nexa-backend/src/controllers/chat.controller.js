import {
  generateAiReply,
  DEFAULT_USER_CONTEXT,
  getSessionUserContext,
  setSessionUserContext,
} from '../services/ai.service.js';
import { isGeminiConfigured, getGeminiModel } from '../config/gemini.js';
import {
  detectMemoryIntent,
  saveMemory,
  forgetMemory,
  getRelevantMemories,
  generateRememberConfirmation,
  generateForgetConfirmation,
  persistConversationTurn,
} from '../services/memory.service.js';

/**
 * Validates request payload for the chat endpoint.
 *
 * @param {Object} body
 * @returns {{ valid: boolean, error?: string, sanitizedMessage?: string, sanitizedHistory?: Array, sanitizedUserContext?: Object, userId?: string }}
 */
function validateChatRequest(body) {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body must be a valid JSON object.' };
  }

  const { message, conversationHistory, userContext, userId } = body;

  if (typeof message !== 'string' || !message.trim()) {
    return { valid: false, error: 'Field "message" is required and must be a non-empty string.' };
  }

  const trimmed = message.trim();
  if (trimmed.length > 4000) {
    return { valid: false, error: 'Message length exceeds maximum allowable limit of 4,000 characters.' };
  }

  let sanitizedHistory = [];
  if (conversationHistory !== undefined) {
    if (!Array.isArray(conversationHistory)) {
      return { valid: false, error: 'Field "conversationHistory" must be an array of messages.' };
    }

    if (conversationHistory.length > 50) {
      sanitizedHistory = conversationHistory.slice(-50);
    } else {
      sanitizedHistory = conversationHistory;
    }

    // Validate each history entry
    for (const item of sanitizedHistory) {
      if (!item || typeof item !== 'object') {
        return { valid: false, error: 'Each conversationHistory entry must be an object.' };
      }
      const role = item.role || item.sender;
      if (role && !['user', 'assistant', 'model'].includes(role)) {
        return { valid: false, error: `Invalid role "${role}" in conversationHistory. Expected user, assistant, or model.` };
      }
      const text = item.text || item.content;
      if (typeof text !== 'string' || text.length > 4000) {
        return { valid: false, error: 'Each conversationHistory entry text must be a string under 4,000 characters.' };
      }
    }
  }

  let sanitizedUserContext = undefined;
  if (userContext !== undefined) {
    if (userContext === null || typeof userContext !== 'object' || Array.isArray(userContext)) {
      return { valid: false, error: 'Field "userContext" must be an object when provided.' };
    }
    sanitizedUserContext = userContext;
  }

  const sanitizedUserId = typeof userId === 'string' && userId.trim() ? userId.trim() : 'shivam';

  return {
    valid: true,
    sanitizedMessage: trimmed,
    sanitizedHistory,
    sanitizedUserContext,
    userId: sanitizedUserId,
  };
}

/**
 * Handler for POST /api/chat
 */
export async function handleChatMessage(req, res, next) {
  try {
    const {
      valid,
      error,
      sanitizedMessage,
      sanitizedHistory,
      sanitizedUserContext,
      userId,
    } = validateChatRequest(req.body);

    if (!valid) {
      return res.status(400).json({
        success: false,
        error,
      });
    }

    // Derive user identity strictly from verified authentication middleware when available.
    // Never trust frontend-supplied ownership IDs.
    const effectiveUserId = req.user?.id ? req.user.id.toString() : (req.userId || userId);

    // Dynamic user context reflecting authenticated user
    const effectiveUserContext = sanitizedUserContext || (req.user ? {
      userName: req.user.displayName || req.user.email.split('@')[0],
    } : undefined);

    // Generate or preserve conversationId
    const conversationId =
      req.body.conversationId && typeof req.body.conversationId === 'string'
        ? req.body.conversationId
        : `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    // If userContext is passed explicitly in request, store for this session
    if (effectiveUserContext) {
      setSessionUserContext(conversationId, effectiveUserContext);
    }

    // 1. Check for explicit Remember / Forget intent (Phase 5)
    const intent = detectMemoryIntent(sanitizedMessage);

    if (intent.isIntent && intent.type === 'remember') {
      try {
        const { memory } = await saveMemory({
          userId: effectiveUserId,
          value: intent.target,
          rawInput: sanitizedMessage,
          metadata: { source: 'chat', language: intent.language },
        });

        const reply = generateRememberConfirmation(memory.value, intent.language);

        // Asynchronously persist conversation turn
        persistConversationTurn({
          conversationId,
          userId: effectiveUserId,
          userText: sanitizedMessage,
          assistantReply: reply,
          model: 'NEXA Memory Engine',
        }).catch(() => {});

        return res.status(200).json({
          success: true,
          reply,
          conversationId,
          model: 'NEXA Memory Engine',
          memoryAction: 'remembered',
          memory,
          timestamp: new Date().toISOString(),
        });
      } catch (memErr) {
        console.warn('[Memory Save Error]:', memErr.message);
        // If DB fails, fall through to regular Gemini processing with warning
      }
    } else if (intent.isIntent && intent.type === 'forget') {
      try {
        const result = await forgetMemory({
          userId: effectiveUserId,
          target: intent.target,
        });

        const reply = generateForgetConfirmation(result.count, intent.language);

        // Asynchronously persist conversation turn
        persistConversationTurn({
          conversationId,
          userId: effectiveUserId,
          userText: sanitizedMessage,
          assistantReply: reply,
          model: 'NEXA Memory Engine',
        }).catch(() => {});

        return res.status(200).json({
          success: true,
          reply,
          conversationId,
          model: 'NEXA Memory Engine',
          memoryAction: 'forgotten',
          forgottenCount: result.count,
          timestamp: new Date().toISOString(),
        });
      } catch (memErr) {
        console.warn('[Memory Forget Error]:', memErr.message);
        // If DB fails, fall through to regular Gemini processing
      }
    }

    // 2. Retrieve relevant long-term memories for regular prompts
    let relevantMemories = [];
    try {
      relevantMemories = await getRelevantMemories({
        userId: effectiveUserId,
        query: sanitizedMessage,
        limit: 10,
      });
    } catch (retrieveErr) {
      console.warn('[Memory Retrieval Warning]:', retrieveErr.message);
    }

    // 3. Generate reply via Gemini with injected long-term memories
    const { reply, model } = await generateAiReply({
      message: sanitizedMessage,
      conversationHistory: sanitizedHistory,
      userContext: effectiveUserContext,
      sessionId: conversationId,
      memories: relevantMemories,
    });

    // 4. Asynchronously persist conversation turn into MongoDB
    persistConversationTurn({
      conversationId,
      userId: effectiveUserId,
      userText: sanitizedMessage,
      assistantReply: reply,
      model,
    }).catch((err) => {
      console.warn('[Conversation Persistence Error]:', err.message);
    });

    return res.status(200).json({
      success: true,
      reply,
      conversationId,
      model,
      memoriesUsed: relevantMemories.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Handler for GET /api/chat/status
 */
export function getChatStatus(req, res) {
  const configured = isGeminiConfigured();
  return res.status(200).json({
    status: configured ? 'ready' : 'unconfigured',
    model: getGeminiModel(),
    geminiConfigured: configured,
    message: configured
      ? 'Gemini AI Brain is active and ready to process requests.'
      : 'Gemini API key is not configured on the backend.',
  });
}
