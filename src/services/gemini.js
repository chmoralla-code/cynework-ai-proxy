const logger = require('../utils/logger');

const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = process.env.OPENROUTER_MODELS_URL || 'https://openrouter.ai/api/v1/models';
const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || 'openrouter/auto';
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_CHAT_PATH = process.env.OLLAMA_CHAT_PATH || '/api/chat';
const OLLAMA_PROVIDER_PRIORITY = (process.env.AI_PROVIDER || 'auto').trim().toLowerCase();

const freeModelsCache = {
  expiresAt: 0,
  models: []
};

const THINKING_MODE = {
  low: {
    model: process.env.OPENROUTER_MODEL_LOW || DEFAULT_MODEL,
    maxOutputTokens: 900,
    instruction: 'Give concise, practical answers with minimal reasoning steps.'
  },
  medium: {
    model: process.env.OPENROUTER_MODEL_MEDIUM || DEFAULT_MODEL,
    maxOutputTokens: 1400,
    instruction: 'Provide clear reasoning, examples, and short step-by-step guidance.'
  },
  high: {
    model: process.env.OPENROUTER_MODEL_HIGH || DEFAULT_MODEL,
    maxOutputTokens: 2200,
    instruction: 'Provide deep analysis, alternatives, trade-offs, and an actionable recommendation.'
  }
};

/**
 * Delays execution for a given number of milliseconds.
 */
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const parseFallbackModels = () => {
  const raw = process.env.OPENROUTER_FALLBACK_MODELS || '';
  return raw
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);
};

const parseModelList = (raw) => (raw || '')
  .split(',')
  .map(model => model.trim())
  .filter(Boolean);

const parseBoolean = (value, defaultValue = false) => {
  if (value == null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const parsePositiveInt = (value, defaultValue) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;
  return parsed;
};

const shouldUseAutoFreeFallback = () => parseBoolean(process.env.OPENROUTER_AUTO_FREE_FALLBACK, true);
const getAutoFreeFallbackLimit = () => parsePositiveInt(process.env.OPENROUTER_MAX_FALLBACK_MODELS, 40);
const getFreeModelsCacheTtlMs = () => parsePositiveInt(process.env.OPENROUTER_FREE_MODELS_CACHE_SECONDS, 600) * 1000;
const isOllamaEnabled = () => parseBoolean(process.env.OLLAMA_ENABLED, true);
const isOpenRouterFallbackEnabled = () => parseBoolean(process.env.OPENROUTER_FALLBACK_ENABLED, true);

const isQuotaError = (error) => {
  const message = (error?.message || '').toLowerCase();
  return (
    error?.status === 429 ||
    message.includes('resource_exhausted') ||
    message.includes('quota exceeded') ||
    message.includes('too many requests')
  );
};

const isModelUnavailableError = (error) => {
  const message = (error?.message || '').toLowerCase();
  return (
    error?.status === 404 ||
    message.includes('model is unavailable') ||
    message.includes('no endpoints found') ||
    message.includes('unknown model') ||
    message.includes('not a valid model id')
  );
};

const extractRetryDelayMs = (error) => {
  if (typeof error?.retryDelayMs === 'number' && Number.isFinite(error.retryDelayMs)) {
    return Math.max(0, error.retryDelayMs);
  }

  const retryAfter = error?.retryAfterMs;
  if (typeof retryAfter === 'number' && Number.isFinite(retryAfter)) {
    return Math.max(0, retryAfter);
  }

  return 0;
};

const parseRetryAfterMs = (retryAfterValue) => {
  if (!retryAfterValue) return 0;
  const retryAsNumber = Number.parseFloat(retryAfterValue);
  if (Number.isFinite(retryAsNumber) && retryAsNumber > 0) {
    return Math.round(retryAsNumber * 1000);
  }
  return 0;
};

const getOpenRouterHeaders = (apiKey) => ({
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  ...(process.env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': process.env.OPENROUTER_SITE_URL } : {}),
  ...(process.env.OPENROUTER_APP_NAME ? { 'X-Title': process.env.OPENROUTER_APP_NAME } : {})
});

const getCachedFreeModels = () => {
  const now = Date.now();
  if (freeModelsCache.expiresAt > now && freeModelsCache.models.length > 0) {
    return [...freeModelsCache.models];
  }
  return null;
};

const fetchOpenRouterFreeModels = async (apiKey) => {
  const cached = getCachedFreeModels();
  if (cached) return cached;

  const response = await fetch(OPENROUTER_MODELS_URL, {
    method: 'GET',
    headers: getOpenRouterHeaders(apiKey)
  });

  if (!response.ok) {
    throw await createOpenRouterError(response);
  }

  const data = await response.json();
  const freeModels = Array.isArray(data?.data)
    ? data.data
      .map((entry) => entry?.id)
      .filter((id) => typeof id === 'string' && id.endsWith(':free'))
    : [];

  freeModelsCache.models = freeModels;
  freeModelsCache.expiresAt = Date.now() + getFreeModelsCacheTtlMs();

  return [...freeModels];
};

const buildModelCandidates = async (apiKey, primaryModel) => {
  const manualFallbacks = parseFallbackModels();
  const candidates = [primaryModel, ...manualFallbacks];

  if (shouldUseAutoFreeFallback()) {
    try {
      const freeModels = await fetchOpenRouterFreeModels(apiKey);
      const excluded = new Set(candidates);
      const maxAutoFallbackModels = getAutoFreeFallbackLimit();
      let autoAdded = 0;
      for (const model of freeModels) {
        if (excluded.has(model)) continue;
        candidates.push(model);
        excluded.add(model);
        autoAdded += 1;
        if (maxAutoFallbackModels > 0 && autoAdded >= maxAutoFallbackModels) {
          break;
        }
      }
    } catch (error) {
      logger.warn(`Failed to load OpenRouter free model list. Using configured fallback only. ${error.message}`);
    }
  }

  return candidates.filter((value, index, array) => array.indexOf(value) === index);
};

const extractTextFromContent = (content) => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter(part => part && (part.type === 'text' || typeof part.text === 'string'))
      .map(part => part.text || '')
      .join('')
      .trim();
  }
  return '';
};

const buildMessageContent = (parts = []) => {
  const content = [];
  for (const part of parts) {
    if (part?.text) {
      content.push({ type: 'text', text: part.text });
    }
    if (part?.inlineData?.data && part?.inlineData?.mimeType) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` }
      });
    }
  }
  if (content.length === 0) return '';
  if (content.length === 1 && content[0].type === 'text') return content[0].text;
  return content;
};

const mapHistoryToMessages = (history, prompt, image) => {
  const messages = history.map(entry => {
    const role = entry?.role === 'model' ? 'assistant' : 'user';
    return {
      role,
      content: buildMessageContent(entry?.parts || [])
    };
  });

  const userParts = [{ text: prompt }];
  if (image) {
    userParts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
  }

  messages.push({
    role: 'user',
    content: buildMessageContent(userParts)
  });

  return messages;
};

const mapHistoryToOllamaMessages = (history, prompt, image) => {
  const messages = history.map((entry) => {
    const role = entry?.role === 'model' ? 'assistant' : 'user';
    const text = extractTextFromContent(buildMessageContent(entry?.parts || []));
    const images = (entry?.parts || [])
      .filter((part) => part?.inlineData?.data)
      .map((part) => part.inlineData.data);

    const message = {
      role,
      content: text || ' '
    };
    if (images.length > 0) message.images = images;
    return message;
  });

  const userParts = [{ text: prompt }];
  if (image) userParts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });

  const userText = extractTextFromContent(buildMessageContent(userParts));
  const userMessage = {
    role: 'user',
    content: userText || ' '
  };
  if (image?.data) userMessage.images = [image.data];
  messages.push(userMessage);

  return messages;
};

const createOpenRouterError = async (response) => {
  const responseText = await response.text().catch(() => '');
  const error = new Error(responseText || `OpenRouter request failed with status ${response.status}.`);
  error.status = response.status;
  error.retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
  return error;
};

const createOllamaError = async (response) => {
  const responseText = await response.text().catch(() => '');
  const error = new Error(responseText || `Ollama request failed with status ${response.status}.`);
  error.status = response.status;
  return error;
};

const requestOpenRouter = async (payload) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set on the server.');
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: getOpenRouterHeaders(apiKey),
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    throw await createOpenRouterError(response);
  }

  return await response.json();
};

const requestOllama = async (payload) => {
  const headers = { 'Content-Type': 'application/json' };
  
  // Add skip-warning header for ngrok tunnels to prevent interstitial page
  if (OLLAMA_BASE_URL.toLowerCase().includes('ngrok-free.dev') || OLLAMA_BASE_URL.toLowerCase().includes('ngrok.io')) {
    headers['ngrok-skip-browser-warning'] = 'true';
  }

  const usingCloudOllama = OLLAMA_BASE_URL.toLowerCase().includes('ollama.com');
  if (usingCloudOllama && !process.env.OLLAMA_API_KEY) {
    throw new Error('OLLAMA_API_KEY is not set on the server.');
  }
  if (process.env.OLLAMA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.OLLAMA_API_KEY}`;
  }

  let response;
  try {
    response = await fetch(`${OLLAMA_BASE_URL}${OLLAMA_CHAT_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const normalized = new Error(`Ollama endpoint unreachable at ${OLLAMA_BASE_URL}.`);
    normalized.status = 503;
    normalized.cause = error;
    throw normalized;
  }

  if (!response.ok) {
    throw await createOllamaError(response);
  }

  return await response.json();
};

const buildOllamaModelCandidates = (thinkingLevel) => {
  const mode = thinkingLevel.toUpperCase();
  const modeModel = process.env[`OLLAMA_MODEL_${mode}`];
  const baseModel = process.env.OLLAMA_MODEL || modeModel || '';
  const usingCloudOllama = OLLAMA_BASE_URL.toLowerCase().includes('ollama.com');
  const localModels = usingCloudOllama ? [] : parseModelList(process.env.OLLAMA_LOCAL_MODELS);
  const cloudModels = usingCloudOllama ? parseModelList(process.env.OLLAMA_CLOUD_MODELS) : [];

  return [baseModel, modeModel, ...localModels, ...cloudModels]
    .map(model => (typeof model === 'string' ? model.trim() : ''))
    .filter(Boolean)
    .filter((value, index, array) => array.indexOf(value) === index);
};

const generateWithOllama = async (history, prompt, image, thinkingLevel, planType) => {
  if (!isOllamaEnabled()) {
    throw Object.assign(new Error('Ollama provider is disabled.'), { status: 503 });
  }

  const mode = THINKING_MODE[thinkingLevel] || THINKING_MODE.low;
  const modelCandidates = buildOllamaModelCandidates(thinkingLevel);
  if (modelCandidates.length === 0) {
    throw Object.assign(new Error('No Ollama models configured. Set OLLAMA_MODEL or OLLAMA_LOCAL_MODELS/OLLAMA_CLOUD_MODELS.'), { status: 500 });
  }

  const maxTokens = parseInt(process.env.MAX_TOKENS, 10) || mode.maxOutputTokens;
  const temperature = parseFloat(process.env.TEMPERATURE) || 0.7;
  const messages = [
    {
      role: 'system',
      content: `You are Cynework AI. ${mode.instruction} The current user plan is ${planType}.`
    },
    ...mapHistoryToOllamaMessages(history, prompt, image)
  ];

  let lastError = null;
  for (let index = 0; index < modelCandidates.length; index += 1) {
    const model = modelCandidates[index];
    const hasNextModel = index < modelCandidates.length - 1;

    try {
      const retriesForModel = hasNextModel ? 1 : 2;
      const response = await withRetries(
        async () => requestOllama({
          model,
          messages,
          stream: false,
          options: {
            temperature,
            num_predict: maxTokens
          }
        }),
        retriesForModel,
        800,
        (error) => {
          if (hasNextModel && (isQuotaError(error) || isModelUnavailableError(error) || error?.status === 503)) return false;
          if (error?.status === 401) return false;
          if (error?.status && error.status >= 400 && error.status < 500) return false;
          return true;
        }
      );

      const assistantText = (response?.message?.content || '').toString().trim();
      if (!assistantText) throw new Error('Ollama returned an empty response.');

      return (async function* streamSingleResponse() {
        yield { text: assistantText };
      })();
    } catch (error) {
      lastError = error;
      if (hasNextModel) {
        logger.warn(`Ollama model ${model} failed. Falling back to ${modelCandidates[index + 1]}.`);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Unable to generate response from Ollama.');
};

/**
 * Executes a function with exponential backoff retries.
 * @param {Function} fn - The async function to execute.
 * @param {number} retries - Maximum number of retries.
 * @param {number} baseDelayMs - Base delay in milliseconds.
 */
const withRetries = async (fn, retries = 3, baseDelayMs = 1000, shouldRetry = () => true) => {
  let attempt = 0;
  while (attempt < retries) {
    try {
      return await fn();
    } catch (error) {
      attempt++;
      logger.warn(`OpenRouter API call failed (Attempt ${attempt}/${retries}): ${error.message}`);
      
      if (!shouldRetry(error)) {
        logger.error('OpenRouter error is non-retriable for this attempt', error);
        throw error;
      }

      if (attempt >= retries) {
        logger.error('Max retries reached for OpenRouter API');
        throw error;
      }
      
      const backoffDelay = baseDelayMs * Math.pow(2, attempt - 1);
      const providerDelay = extractRetryDelayMs(error);
      const retryDelay = Math.max(backoffDelay, providerDelay);
      logger.info(`Waiting ${retryDelay}ms before retry...`);
      await delay(retryDelay);
    }
  }
};

/**
 * Calls OpenRouter with history.
 * @param {Array} history - The chat history [{role, parts: [{text}]}]
 * @param {string} prompt - The new user prompt
 * @returns {AsyncGenerator} An async generator yielding chunks of the response
 */
const generateWithOpenRouter = async (history, prompt, image = null, thinkingLevel = 'low', planType = 'guest') => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set on the server.');
  }

  const mode = THINKING_MODE[thinkingLevel] || THINKING_MODE.low;
  const modelCandidates = await buildModelCandidates(apiKey, mode.model);
  const maxTokens = parseInt(process.env.MAX_TOKENS, 10) || mode.maxOutputTokens;
  const temperature = parseFloat(process.env.TEMPERATURE) || 0.7;
  const messages = [
    {
      role: 'system',
      content: `You are Cynework AI. ${mode.instruction} The current user plan is ${planType}.`
    },
    ...mapHistoryToMessages(history, prompt, image)
  ];

  let lastError = null;
  for (let index = 0; index < modelCandidates.length; index += 1) {
    const model = modelCandidates[index];
    const hasNextModel = index < modelCandidates.length - 1;

    try {
      const retriesForModel = hasNextModel ? 1 : 3;
      const response = await withRetries(
        async () => {
          return await requestOpenRouter({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            stream: false
          });
        },
        retriesForModel,
        1000,
        (error) => {
          // If there is another model to try, fail fast on quota/model errors and switch immediately.
          if (hasNextModel && (isQuotaError(error) || isModelUnavailableError(error))) {
            return false;
          }
          // Never retry auth failures.
          if (error?.status === 401) return false;
          // Retry transient errors and rate limits when this is the last model.
          if (error?.status === 429) return true;
          if (error?.status && error.status >= 400 && error.status < 500) return false;
          return true;
        }
      );

      const assistantText = extractTextFromContent(response?.choices?.[0]?.message?.content);
      if (!assistantText) {
        throw new Error('OpenRouter returned an empty response.');
      }

      return (async function* streamSingleResponse() {
        yield { text: assistantText };
      })();
    } catch (error) {
      lastError = error;
      if (hasNextModel && (isQuotaError(error) || isModelUnavailableError(error))) {
        logger.warn(`Model ${model} failed. Falling back to ${modelCandidates[index + 1]}.`);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Unable to generate response from OpenRouter.');
};

const generateChatStream = async (history, prompt, image = null, thinkingLevel = 'low', planType = 'guest') => {
  const providers = (() => {
    switch (OLLAMA_PROVIDER_PRIORITY) {
      case 'ollama-only':
        return ['ollama'];
      case 'openrouter-only':
        return ['openrouter'];
      case 'ollama':
        return isOpenRouterFallbackEnabled() ? ['ollama', 'openrouter'] : ['ollama'];
      case 'openrouter':
        return ['openrouter', 'ollama'];
      case 'auto':
      default:
        return ['ollama', 'openrouter'];
    }
  })();

  let lastError = null;
  for (const provider of providers) {
    try {
      if (provider === 'ollama') {
        return await generateWithOllama(history, prompt, image, thinkingLevel, planType);
      }
      if (provider === 'openrouter') {
        return await generateWithOpenRouter(history, prompt, image, thinkingLevel, planType);
      }
    } catch (error) {
      lastError = error;
      logger.warn(`Provider ${provider} failed. Trying next provider if available. ${error.message}`);
    }
  }

  throw lastError || new Error('No available AI provider succeeded.');
};

module.exports = {
  generateChatStream
};
