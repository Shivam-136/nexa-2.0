import {
  getOllamaBaseUrl,
  getOllamaTimeoutMs,
  getOllamaModel,
  DEFAULT_OLLAMA_BASE_URL,
  isLocalEndpoint,
  validateOllamaBaseUrl,
} from '../config/ollama.js';
import {
  buildSystemInstruction,
  DEFAULT_USER_CONTEXT,
  getSessionUserContext,
} from './ai.service.js';

/**
 * Safely resolves the Ollama base URL without throwing.
 *
 * @returns {string}
 */
function getOllamaBaseUrlSafe() {
  try {
    return getOllamaBaseUrl();
  } catch {
    return DEFAULT_OLLAMA_BASE_URL;
  }
}

/**
 * Validates an HTTP response for unexpected or non-loopback redirect attempts.
 * Prevents SSRF attacks through HTTP redirect chains.
 *
 * @param {Response} response
 * @param {string} endpoint - The original target URL
 * @throws {Error} If response is a redirect to a non-loopback destination or unexpected redirect
 */
function validateResponseRedirect(response, endpoint) {
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (location) {
      let targetUrl;
      try {
        targetUrl = new URL(location, endpoint);
      } catch {
        const err = new Error(`Invalid redirect location header: "${location}".`);
        err.code = 'OLLAMA_INVALID_REDIRECT';
        err.status = 400;
        err.statusCode = 400;
        throw err;
      }

      if (!isLocalEndpoint(targetUrl.hostname)) {
        const err = new Error(
          `Unsafe redirect blocked: Ollama requests cannot follow redirects to non-loopback destination "${location}".`
        );
        err.code = 'OLLAMA_UNSAFE_REDIRECT';
        err.status = 400;
        err.statusCode = 400;
        throw err;
      }
    }

    const redirectErr = new Error(
      `Unexpected redirect (HTTP ${response.status}) received from Ollama service at ${endpoint}.`
    );
    redirectErr.code = 'OLLAMA_UNEXPECTED_REDIRECT';
    redirectErr.status = response.status;
    redirectErr.statusCode = response.status;
    throw redirectErr;
  }
}

/**
 * Normalizes Ollama API errors into clear, consistent HTTP errors.
 * Never leaks prompt content, memories, or raw sensitive internal buffers.
 *
 * @param {Error|Object} error
 * @param {Object} [context={}]
 * @param {string} [context.model]
 * @param {number} [context.timeoutMs]
 * @param {string} [context.baseUrl]
 * @returns {Error} Normalized error with statusCode and code property
 */
export function normalizeOllamaError(error, context = {}) {
  if (!error) {
    const err = new Error('An unknown error occurred while communicating with Ollama.');
    err.statusCode = 500;
    return err;
  }

  // Preserve already validated 400 bad request errors
  if (error.statusCode === 400 && !error.code) {
    return error;
  }

  const rawMessage = error.message || String(error);
  const status = error.status || error.statusCode;
  const model = context.model || 'the requested model';
  const baseUrl = context.baseUrl || getOllamaBaseUrlSafe();

  // 1. Unsafe base URL / Configuration Error (400)
  if (
    error.code === 'OLLAMA_INVALID_CONFIG' ||
    /unsafe ollama base url/i.test(rawMessage) ||
    /invalid ollama/i.test(rawMessage)
  ) {
    const err = new Error(rawMessage);
    err.statusCode = 400;
    err.code = 'OLLAMA_INVALID_CONFIG';
    return err;
  }

  // 2. Unsafe Redirect / SSRF Attempt (400)
  if (
    error.code === 'OLLAMA_UNSAFE_REDIRECT' ||
    error.code === 'OLLAMA_INVALID_REDIRECT' ||
    error.code === 'OLLAMA_UNEXPECTED_REDIRECT' ||
    /unsafe redirect/i.test(rawMessage) ||
    /unexpected redirect/i.test(rawMessage)
  ) {
    const err = new Error(rawMessage);
    err.statusCode = error.statusCode || 400;
    err.code = error.code || 'OLLAMA_UNSAFE_REDIRECT';
    return err;
  }

  // 3. Request Timeout (504)
  const isTimeout =
    error.name === 'AbortError' ||
    error.name === 'TimeoutError' ||
    error.code === 'OLLAMA_TIMEOUT' ||
    /timed out/i.test(rawMessage) ||
    /timeout/i.test(rawMessage);

  if (isTimeout) {
    const timeoutSec = context.timeoutMs ? Math.round(context.timeoutMs / 1000) : 60;
    const err = new Error(
      `Ollama request timed out after ${timeoutSec} seconds. Local inference took too long.`
    );
    err.statusCode = 504;
    err.code = 'OLLAMA_TIMEOUT';
    return err;
  }

  // 4. Connection Refused / Service Unavailable (503)
  const isConnRefused =
    error.code === 'ECONNREFUSED' ||
    error.cause?.code === 'ECONNREFUSED' ||
    error.code === 'EHOSTUNREACH' ||
    error.cause?.code === 'EHOSTUNREACH' ||
    error.code === 'OLLAMA_UNAVAILABLE' ||
    /econnrefused/i.test(rawMessage) ||
    /connection refused/i.test(rawMessage) ||
    (error.name === 'TypeError' && /fetch failed/i.test(rawMessage));

  if (isConnRefused) {
    const err = new Error(
      `Unable to connect to Ollama service at ${baseUrl}. Please ensure Ollama is installed and running locally (\`ollama serve\`).`
    );
    err.statusCode = 503;
    err.code = 'OLLAMA_UNAVAILABLE';
    return err;
  }

  // 5. Missing Model / Model Not Found (404)
  const isMissingModel =
    status === 404 ||
    error.code === 'OLLAMA_MODEL_NOT_FOUND' ||
    (/not found/i.test(rawMessage) && (/model/i.test(rawMessage) || /pull/i.test(rawMessage))) ||
    /try pulling/i.test(rawMessage);

  if (isMissingModel) {
    const err = new Error(
      `Ollama model "${model}" is not installed or not found. Please download it using \`ollama pull ${model}\`.`
    );
    err.statusCode = 404;
    err.code = 'OLLAMA_MODEL_NOT_FOUND';
    return err;
  }

  // 6. Malformed Response (502)
  const isMalformed =
    error instanceof SyntaxError ||
    error.code === 'MALFORMED_RESPONSE' ||
    error.code === 'OLLAMA_MALFORMED_RESPONSE' ||
    /malformed/i.test(rawMessage) ||
    /unexpected token/i.test(rawMessage) ||
    /missing required "message.content"/i.test(rawMessage) ||
    /missing "models" array/i.test(rawMessage);

  if (isMalformed) {
    const err = new Error('Received malformed or invalid response from Ollama service.');
    err.statusCode = 502;
    err.code = 'OLLAMA_MALFORMED_RESPONSE';
    return err;
  }

  // 7. Generic HTTP Status Code
  const finalStatus = status && status >= 400 && status < 600 ? status : 500;
  const err = new Error(
    rawMessage || 'An unexpected error occurred while communicating with Ollama.'
  );
  err.statusCode = finalStatus;
  err.code = error.code || 'OLLAMA_ERROR';
  return err;
}

/**
 * Formats multi-turn chat messages for the Ollama native /api/chat endpoint.
 *
 * @param {Object} options
 * @param {string} options.message - The latest user message
 * @param {Array} [options.conversationHistory=[]] - Prior dialogue turns
 * @param {string} [options.systemInstruction] - Optional system instruction
 * @param {number} [options.maxTurns=20] - Max turns to retain
 * @returns {Array<{ role: string, content: string }>}
 */
export function formatOllamaMessages({
  message,
  conversationHistory = [],
  systemInstruction,
  maxTurns = 20,
}) {
  const messages = [];

  // 1. System instruction (if present)
  if (systemInstruction && typeof systemInstruction === 'string' && systemInstruction.trim()) {
    messages.push({
      role: 'system',
      content: systemInstruction.trim(),
    });
  }

  // 2. Prior conversation turns
  if (Array.isArray(conversationHistory)) {
    const validTurns = conversationHistory.filter((item) => {
      if (!item || typeof item !== 'object') return false;
      const text = (item.content || item.text || '').trim();
      return Boolean(text);
    });

    const trimmed = validTurns.slice(-maxTurns);

    for (const item of trimmed) {
      const rawRole = item.role || item.sender;
      const text = (item.content || item.text || '').trim();

      // Normalize role: system, user, assistant
      let role = 'user';
      if (rawRole === 'system') {
        role = 'system';
      } else if (rawRole === 'assistant' || rawRole === 'model') {
        role = 'assistant';
      }

      // Merge consecutive identical roles if appropriate
      if (messages.length > 0 && messages[messages.length - 1].role === role) {
        messages[messages.length - 1].content += `\n${text}`;
      } else {
        messages.push({ role, content: text });
      }
    }
  }

  // 3. Append current user message
  const cleanMessage = (message || '').trim();
  if (messages.length > 0 && messages[messages.length - 1].role === 'user') {
    if (messages[messages.length - 1].content !== cleanMessage) {
      messages[messages.length - 1].content += `\n${cleanMessage}`;
    }
  } else {
    messages.push({
      role: 'user',
      content: cleanMessage,
    });
  }

  return messages;
}

/**
 * Generates an AI chat reply using the local Ollama native REST API (POST /api/chat).
 *
 * @param {Object} params
 * @param {string} params.message - The current user message (required)
 * @param {Array} [params.conversationHistory=[]] - Prior conversation turns
 * @param {string} [params.systemInstruction] - Explicit system instruction string
 * @param {Object} [params.userContext] - User context for dynamic system instruction
 * @param {string} [params.sessionId] - Session ID to resolve user context
 * @param {Array<Object>|string} [params.memories=[]] - Long-term persistent memories
 * @param {string} [params.model] - Model override (defaults to OLLAMA_MODEL or llama3.2)
 * @param {number} [params.timeoutMs] - Request timeout in milliseconds
 * @returns {Promise<{ reply: string, model: string }>}
 */
export async function generateOllamaReply({
  message,
  conversationHistory = [],
  systemInstruction,
  userContext,
  sessionId,
  memories = [],
  model: modelOverride,
  timeoutMs,
} = {}) {
  // 1. Input validation
  if (!message || typeof message !== 'string' || !message.trim()) {
    const err = new Error('Message cannot be empty.');
    err.statusCode = 400;
    throw err;
  }

  if (conversationHistory && !Array.isArray(conversationHistory)) {
    const err = new Error('conversationHistory must be an array.');
    err.statusCode = 400;
    throw err;
  }

  // 2. Resolve configuration & endpoint
  let baseUrl;
  try {
    baseUrl = getOllamaBaseUrl();
  } catch (configErr) {
    throw normalizeOllamaError(configErr);
  }

  const selectedModel = modelOverride || getOllamaModel();
  const effectiveTimeout = timeoutMs || getOllamaTimeoutMs();

  // 3. Resolve system instruction
  let activeSystemInstruction = systemInstruction;
  if (activeSystemInstruction === undefined) {
    const activeUserContext =
      userContext ||
      (sessionId ? getSessionUserContext(sessionId) : null) ||
      DEFAULT_USER_CONTEXT;
    activeSystemInstruction = buildSystemInstruction(activeUserContext, memories);
  }

  // 4. Format messages payload
  const messages = formatOllamaMessages({
    message,
    conversationHistory,
    systemInstruction: activeSystemInstruction,
  });

  const payload = {
    model: selectedModel,
    messages,
    stream: false,
  };

  // 5. Execute HTTP request with AbortController timeout & non-following manual redirects
  const endpoint = `${baseUrl}/api/chat`;
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => {
    controller.abort(
      new Error(`Ollama request timed out after ${effectiveTimeout / 1000} seconds.`)
    );
  }, effectiveTimeout);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: 'manual',
    });

    // Enforce strict redirect boundary: never follow redirects to non-loopback destinations
    validateResponseRedirect(response, endpoint);

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorJson = await response.json();
        errorDetail = errorJson?.error || '';
      } catch {
        try {
          errorDetail = await response.text();
        } catch {
          errorDetail = response.statusText;
        }
      }

      const httpError = new Error(
        errorDetail || `Ollama API request failed with status ${response.status}`
      );
      httpError.status = response.status;
      httpError.statusCode = response.status;
      throw httpError;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      const malformed = new Error('Failed to parse Ollama JSON response: malformed payload.');
      malformed.code = 'MALFORMED_RESPONSE';
      throw malformed;
    }

    if (!data || !data.message || typeof data.message.content !== 'string') {
      const malformed = new Error(
        'Ollama API response is missing required "message.content" field.'
      );
      malformed.code = 'MALFORMED_RESPONSE';
      throw malformed;
    }

    return {
      reply: data.message.content.trim(),
      model: data.model || selectedModel,
    };
  } catch (error) {
    // Security: Never log prompts, private memories, or sensitive response content
    console.error(
      `[Ollama Service Error]: ${error.code || error.name || 'Request Failed'} (status: ${error.status || error.statusCode || 'N/A'})`
    );

    throw normalizeOllamaError(error, {
      model: selectedModel,
      timeoutMs: effectiveTimeout,
      baseUrl,
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * Checks whether the local Ollama service is running and accessible.
 * Safe status check: does not throw, returns structured telemetry.
 *
 * @param {Object} [options={}]
 * @param {number} [options.timeoutMs=5000]
 * @param {string} [options.baseUrl]
 * @returns {Promise<{ isConnected: boolean, status: string, baseUrl?: string, models?: string[], error?: string }>}
 */
export async function checkOllamaStatus({ timeoutMs = 5000, baseUrl: customBaseUrl } = {}) {
  let baseUrl;
  try {
    baseUrl = customBaseUrl ? validateOllamaBaseUrl(customBaseUrl) : getOllamaBaseUrl();
  } catch (configErr) {
    return {
      isConnected: false,
      status: 'error',
      error: configErr.message,
    };
  }

  const endpoint = `${baseUrl}/api/tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'manual',
    });

    // Enforce strict redirect boundary
    validateResponseRedirect(response, endpoint);

    if (!response.ok) {
      return {
        isConnected: false,
        status: 'disconnected',
        statusCode: response.status,
        baseUrl,
        error: `Ollama returned HTTP status ${response.status}`,
      };
    }

    const data = await response.json();
    const models = Array.isArray(data.models) ? data.models.map((m) => m.name) : [];

    return {
      isConnected: true,
      status: 'connected',
      baseUrl,
      models,
    };
  } catch (err) {
    const normalized = normalizeOllamaError(err, { baseUrl, timeoutMs });
    return {
      isConnected: false,
      status: 'disconnected',
      baseUrl,
      error: normalized.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches the list of locally available models from Ollama (GET /api/tags).
 *
 * @param {Object} [options={}]
 * @param {number} [options.timeoutMs=10000]
 * @param {string} [options.baseUrl]
 * @returns {Promise<Array<Object>>} Array of model descriptors
 */
export async function fetchAvailableModels({ timeoutMs = 10000, baseUrl: customBaseUrl } = {}) {
  let baseUrl;
  try {
    baseUrl = customBaseUrl ? validateOllamaBaseUrl(customBaseUrl) : getOllamaBaseUrl();
  } catch (configErr) {
    throw normalizeOllamaError(configErr);
  }

  const endpoint = `${baseUrl}/api/tags`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      redirect: 'manual',
    });

    // Enforce strict redirect boundary
    validateResponseRedirect(response, endpoint);

    if (!response.ok) {
      let errorDetail = '';
      try {
        const errorJson = await response.json();
        errorDetail = errorJson?.error || '';
      } catch {
        errorDetail = response.statusText;
      }
      const err = new Error(
        errorDetail || `Failed to fetch models: HTTP status ${response.status}`
      );
      err.status = response.status;
      err.statusCode = response.status;
      throw err;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      const malformed = new Error('Received malformed JSON from Ollama /api/tags.');
      malformed.code = 'MALFORMED_RESPONSE';
      throw malformed;
    }

    if (!data || !Array.isArray(data.models)) {
      const malformed = new Error('Ollama /api/tags response is missing "models" array.');
      malformed.code = 'MALFORMED_RESPONSE';
      throw malformed;
    }

    return data.models;
  } catch (err) {
    console.error(
      `[Ollama Service Error - Models]: ${err.code || err.name || 'Request Failed'} (status: ${err.status || err.statusCode || 'N/A'})`
    );
    throw normalizeOllamaError(err, { baseUrl, timeoutMs });
  } finally {
    clearTimeout(timer);
  }
}

export default {
  generateOllamaReply,
  checkOllamaStatus,
  fetchAvailableModels,
  normalizeOllamaError,
  formatOllamaMessages,
};
