const logger = require('../utils/logger');

const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const GROQ_API_URL = process.env.GROQ_API_URL || 'https://api.groq.com/openai/v1/chat/completions';
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_CHAT_PATH = process.env.OLLAMA_CHAT_PATH || '/api/chat';

const THINKING_MODE = {
  low: {
    ollamaModel: process.env.OLLAMA_MODEL_LOW || 'qwen2.5:7b',
    groqModel: process.env.GROQ_MODEL_LOW || 'llama-3.1-8b-instant',
    openRouterModel: process.env.OPENROUTER_MODEL_LOW || 'openai/gpt-oss-20b:free',
    maxOutputTokens: 2000,
    instruction: 'Give concise, practical answers. You are SpeedAI. Only mention that your creator/developer is "cyrhiel moralla" IF explicitly asked. Do NOT include this information in normal responses.'
  },
  medium: {
    ollamaModel: process.env.OLLAMA_MODEL_MEDIUM || 'llama3.2-vision:11b',
    groqModel: process.env.GROQ_MODEL_MEDIUM || 'llama-3.3-70b-versatile',
    openRouterModel: process.env.OPENROUTER_MODEL_MEDIUM || 'qwen/qwen3-coder:free',
    maxOutputTokens: 3000,
    instruction: 'Provide clear reasoning and guidance. You have vision capabilities. You are SpeedAI. Only mention that your creator/developer is "cyrhiel moralla" IF explicitly asked. Do NOT include this information in normal responses.'
  },
  high: {
    ollamaModel: process.env.OLLAMA_MODEL_HIGH || 'llama3.1:8b',
    groqModel: process.env.GROQ_MODEL_HIGH || 'llama-3.3-70b-versatile',
    openRouterModel: process.env.OPENROUTER_MODEL_HIGH || 'google/gemma-4-31b-it:free',
    maxOutputTokens: 4000,
    instruction: 'Provide deep analysis and recommendations. Use full expertise. You are SpeedAI. Only mention that your creator/developer is "cyrhiel moralla" IF explicitly asked. Do NOT include this information in normal responses.'
  }
};

const OLLAMA_RECOMMENDED_MODELS = {
  low: ['qwen2.5:7b', 'llama3.2:3b', 'gemma2:9b'],
  medium: ['llama3.3:70b', 'qwen2.5:32b', 'llama3.2-vision:11b', 'llava:7b'],
  high: ['qwen2.5-coder:32b', 'llama3.3:70b', 'deepseek-coder-v2:236b']
};

const OPENROUTER_RECOMMENDED_MODELS = {
  low: ['openai/gpt-oss-20b:free', 'google/gemma-4-31b-it:free', 'meta-llama/llama-3.2-11b-vision-instruct'],
  medium: ['qwen/qwen3-coder:free', 'google/gemma-4-31b-it:free', 'meta-llama/llama-3.2-11b-vision-instruct'],
  high: ['qwen/qwen3-coder:free', 'google/gemma-4-31b-it:free', 'deepseek/deepseek-chat-v3-0324:free', 'meta-llama/llama-3.2-11b-vision-instruct']
};

const GROQ_RECOMMENDED_MODELS = {
  low: ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'],
  medium: ['llama-3.3-70b-versatile', 'qwen-qwq-32b'],
  high: ['llama-3.3-70b-versatile', 'deepseek-r1-distill-llama-70b', 'qwen-qwq-32b']
};

const CODING_INSTRUCTION = '\n\nWhen writing code for a website or game, ALWAYS provide the filename before each code block using the format "FILE: filename.ext". This allows the user to download the code as local files.';

const VISION_MODEL_HINTS = ['vision', 'vl', 'llava', 'moondream', 'gemma-vision', 'pixtral'];
const CODING_MODEL_HINTS = ['coder', 'code', 'deepseek', 'qwen', 'qwq', 'llama-3.3', 'llama3.1'];
const CODING_PROMPT_PATTERN = /(code|coding|debug|fix|bug|refactor|function|api|backend|frontend|javascript|typescript|python|node|react|sql|deploy|vercel)/i;

const parseBoolean = (value, defaultValue = false) => {
  if (value == null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const parseModelList = (value) => String(value || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const uniqueModels = (models) => models.filter((value, index, array) => array.indexOf(value) === index);

const isOllamaEnabled = () => parseBoolean(process.env.OLLAMA_ENABLED, true);
const isOpenRouterEnabled = () => parseBoolean(process.env.OPENROUTER_FALLBACK_ENABLED, true);
const isGroqEnabled = () => parseBoolean(process.env.GROQ_ENABLED, true);

const detectPromptNeeds = (prompt, image) => ({
  needsVision: Boolean(image?.data),
  needsCoding: CODING_PROMPT_PATTERN.test(String(prompt || ''))
});

const isVisionModel = (model) => {
  const lower = String(model || '').toLowerCase();
  return VISION_MODEL_HINTS.some((hint) => lower.includes(hint));
};

const scoreModelCandidate = (model, needs = {}) => {
  const lowerModel = String(model || '').toLowerCase();
  let score = 0;

  if (needs.needsVision) {
    if (VISION_MODEL_HINTS.some((hint) => lowerModel.includes(hint))) score += 100;
    else score -= 25;
  }

  if (needs.needsCoding && CODING_MODEL_HINTS.some((hint) => lowerModel.includes(hint))) {
    score += 70;
  }

  if (lowerModel.includes(':free')) score += 8;
  if (lowerModel.includes('70b') || lowerModel.includes('32b') || lowerModel.includes('31b')) score += 5;

  return score;
};

const rankCandidates = (candidates, needs = {}) => {
  const unique = uniqueModels(candidates.filter(Boolean));
  return unique
    .map((model, index) => ({ model, index, score: scoreModelCandidate(model, needs) }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((entry) => entry.model);
};

const isModelUnavailableError = (error) => {
  const message = (error?.message || '').toLowerCase();
  return (
    error?.status === 404 ||
    message.includes('model unavailable') ||
    message.includes('could not be found') ||
    message.includes('unknown model') ||
    message.includes('not found') ||
    message.includes('not a valid model id') ||
    message.includes('pull')
  );
};

const buildOllamaModelCandidates = (thinkingLevel, mode, needs) => {
  const level = (thinkingLevel || 'low').toLowerCase();
  const envModel = process.env[`OLLAMA_MODEL_${level.toUpperCase()}`];
  const baseModel = process.env.OLLAMA_MODEL || mode.ollamaModel;
  const cloudModels = parseModelList(process.env.OLLAMA_CLOUD_MODELS);
  const localModels = parseModelList(process.env.OLLAMA_LOCAL_MODELS);
  const manualFallbacks = parseModelList(process.env.OLLAMA_FALLBACK_MODELS);
  const recommended = OLLAMA_RECOMMENDED_MODELS[level] || [];

  return rankCandidates([envModel, mode.ollamaModel, baseModel, ...cloudModels, ...localModels, ...manualFallbacks, ...recommended], needs);
};

const buildOpenRouterModelCandidates = (thinkingLevel, mode, needs) => {
  const level = (thinkingLevel || 'low').toLowerCase();
  const envModel = process.env[`OPENROUTER_MODEL_${level.toUpperCase()}`];
  const baseModel = process.env.OPENROUTER_MODEL || mode.openRouterModel;
  const manualFallbacks = parseModelList(process.env.OPENROUTER_FALLBACK_MODELS);
  const recommended = OPENROUTER_RECOMMENDED_MODELS[level] || [];

  const ranked = rankCandidates([envModel, mode.openRouterModel, baseModel, ...manualFallbacks, ...recommended], needs);
  if (!needs?.needsVision) return ranked;

  const visionOnly = ranked.filter((model) => isVisionModel(model));
  return visionOnly;
};

const buildGroqModelCandidates = (thinkingLevel, mode, needs) => {
  const level = (thinkingLevel || 'low').toLowerCase();
  const envModel = process.env[`GROQ_MODEL_${level.toUpperCase()}`];
  const baseModel = process.env.GROQ_MODEL || mode.groqModel;
  const manualFallbacks = parseModelList(process.env.GROQ_FALLBACK_MODELS);
  const recommended = GROQ_RECOMMENDED_MODELS[level] || [];

  const ranked = rankCandidates([envModel, mode.groqModel, baseModel, ...manualFallbacks, ...recommended], needs);
  if (!needs?.needsVision) return ranked;

  const visionOnly = ranked.filter((model) => isVisionModel(model));
  return visionOnly;
};

const buildProviderOrder = (needs) => {
  // Always prioritize Ollama best cloud models first
  return ['ollama', 'openrouter', 'groq'];
};

const extractTextFromContent = (content) => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && (part.type === 'text' || typeof part.text === 'string'))
      .map((part) => part.text || '')
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
  const messages = history.map((entry) => {
    const role = entry?.role === 'model' ? 'assistant' : 'user';
    return {
      role,
      content: buildMessageContent(entry?.parts || [])
    };
  });

  const userParts = [{ text: prompt }];
  if (image) userParts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
  messages.push({ role: 'user', content: buildMessageContent(userParts) });

  return messages;
};

const mapHistoryToTextMessages = (history, prompt) => {
  const messages = history.map((entry) => {
    const role = entry?.role === 'model' ? 'assistant' : 'user';
    const text = extractTextFromContent(buildMessageContent(entry?.parts || []));
    return { role, content: text || ' ' };
  });

  messages.push({ role: 'user', content: String(prompt || ' ').trim() || ' ' });
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

const sanitizeAssistantResponse = (text) => {
  if (typeof text !== 'string') return '';
  return text.trim().replace(/['"{( ]*[}\]]+\)*\s*$/g, '').trim();
};

const requestOpenRouter = async (payload) => {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw Object.assign(new Error('OPENROUTER_API_KEY is not set.'), { status: 503 });

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const txt = await response.text();
    throw Object.assign(new Error(txt || `OpenRouter error ${response.status}`), { status: response.status });
  }

  return await response.json();
};

const requestGroq = async (payload) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw Object.assign(new Error('GROQ_API_KEY is not set.'), { status: 503 });

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const txt = await response.text();
    throw Object.assign(new Error(txt || `Groq error ${response.status}`), { status: response.status });
  }

  return await response.json();
};

const requestOllama = async (payload) => {
  const headers = { 'Content-Type': 'application/json' };
  if (OLLAMA_BASE_URL.includes('ngrok')) headers['ngrok-skip-browser-warning'] = 'true';
  const apiKey = process.env.OLLAMA_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}${OLLAMA_CHAT_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const txt = await response.text();
      throw Object.assign(new Error(`[Ollama] ${txt || `error ${response.status}`}`), { status: response.status });
    }

    return await response.json();
  } catch (error) {
    if (!error.status) throw Object.assign(new Error(`[Ollama] Unreachable at ${OLLAMA_BASE_URL}`), { status: 503 });
    throw error;
  }
};

const generateWithOllama = async (history, prompt, image, thinkingLevel, planType, needs) => {
  const mode = THINKING_MODE[thinkingLevel] || THINKING_MODE.low;
  const modelCandidates = buildOllamaModelCandidates(thinkingLevel, mode, needs);
  let lastError = null;

  for (let index = 0; index < modelCandidates.length; index += 1) {
    const model = modelCandidates[index];
    const hasNextModel = index < modelCandidates.length - 1;

    try {
      const response = await requestOllama({
        model,
        messages: [
          { role: 'system', content: `You are SpeedAI. ${mode.instruction}${CODING_INSTRUCTION} The current user plan is ${planType}.` },
          ...mapHistoryToOllamaMessages(history, prompt, image)
        ],
        stream: false,
        options: { temperature: 0.6, num_predict: mode.maxOutputTokens }
      });

      const assistantText = sanitizeAssistantResponse((response?.message?.content || '').toString().trim());
      if (!assistantText) throw new Error('Ollama returned an empty response.');

      return (async function* () { yield { text: assistantText }; })();
    } catch (error) {
      lastError = error;
      if (hasNextModel && isModelUnavailableError(error)) {
        logger.warn(`Ollama model ${model} unavailable. Falling back to ${modelCandidates[index + 1]}.`);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Unable to generate response from Ollama.');
};

const generateWithOpenRouter = async (history, prompt, image, thinkingLevel, planType, needs) => {
  const mode = THINKING_MODE[thinkingLevel] || THINKING_MODE.low;
  const modelCandidates = buildOpenRouterModelCandidates(thinkingLevel, mode, needs);
  if (needs?.needsVision && modelCandidates.length === 0) {
    throw Object.assign(
      new Error('No vision-capable OpenRouter model is configured. Set OPENROUTER_MODEL_* or OPENROUTER_FALLBACK_MODELS to a vision model.'),
      { status: 502 }
    );
  }
  let lastError = null;

  for (let index = 0; index < modelCandidates.length; index += 1) {
    const model = modelCandidates[index];
    const hasNextModel = index < modelCandidates.length - 1;

    try {
      const response = await requestOpenRouter({
        model,
        messages: [
          { role: 'system', content: `You are SpeedAI. ${mode.instruction}${CODING_INSTRUCTION} The current user plan is ${planType}.` },
          ...mapHistoryToMessages(history, prompt, image)
        ],
        temperature: 0.7,
        max_tokens: mode.maxOutputTokens,
        stream: false
      });

      const assistantText = sanitizeAssistantResponse(extractTextFromContent(response?.choices?.[0]?.message?.content));
      if (!assistantText) throw new Error('OpenRouter returned an empty response.');

      return (async function* () { yield { text: assistantText }; })();
    } catch (error) {
      lastError = error;
      if (hasNextModel && isModelUnavailableError(error)) {
        logger.warn(`OpenRouter model ${model} unavailable. Falling back to ${modelCandidates[index + 1]}.`);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Unable to generate response from OpenRouter.');
};

const generateWithGroq = async (history, prompt, image, thinkingLevel, planType, needs) => {
  const mode = THINKING_MODE[thinkingLevel] || THINKING_MODE.low;
  const modelCandidates = buildGroqModelCandidates(thinkingLevel, mode, needs);
  if (needs?.needsVision && modelCandidates.length === 0) {
    throw Object.assign(new Error('Groq does not have a configured vision-capable model for image analysis.'), { status: 502 });
  }
  let lastError = null;

  for (let index = 0; index < modelCandidates.length; index += 1) {
    const model = modelCandidates[index];
    const hasNextModel = index < modelCandidates.length - 1;

    try {
      const response = await requestGroq({
        model,
        messages: [
          { role: 'system', content: `You are SpeedAI. ${mode.instruction}${CODING_INSTRUCTION} The current user plan is ${planType}.` },
          ...mapHistoryToTextMessages(history, prompt)
        ],
        temperature: 0.6,
        max_tokens: mode.maxOutputTokens,
        stream: false
      });

      const assistantText = sanitizeAssistantResponse(extractTextFromContent(response?.choices?.[0]?.message?.content));
      if (!assistantText) throw new Error('Groq returned an empty response.');

      return (async function* () { yield { text: assistantText }; })();
    } catch (error) {
      lastError = error;
      if (hasNextModel && isModelUnavailableError(error)) {
        logger.warn(`Groq model ${model} unavailable. Falling back to ${modelCandidates[index + 1]}.`);
        continue;
      }
      throw error;
    }
  }

  throw lastError || new Error('Unable to generate response from Groq.');
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const generateChatStream = async (history, prompt, image = null, thinkingLevel = 'low', planType = 'guest') => {
  const mode = (process.env.AI_PROVIDER || 'auto').trim().toLowerCase();
  const needs = detectPromptNeeds(prompt, image);

  if (needs.needsVision && mode === 'groq-only') {
    throw Object.assign(new Error('Image analysis is not supported in groq-only mode. Use AI_PROVIDER=auto or openrouter-only.'), { status: 400 });
  }

  const providersByMode = {
    'ollama-only': ['ollama'],
    'groq-only': ['groq'],
    'openrouter-only': ['openrouter'],
    auto: buildProviderOrder(needs)
  };

  const providerOrder = providersByMode[mode] || providersByMode.auto;
  const errors = [];

  for (const provider of providerOrder) {
    let attempts = 0;
    const maxAttempts = 2; // Retry once if rate limited

    while (attempts < maxAttempts) {
      try {
        if (provider === 'ollama') {
          if (!isOllamaEnabled()) break;
          return await generateWithOllama(history, prompt, image, thinkingLevel, planType, needs);
        }

        if (provider === 'groq') {
          if (!isGroqEnabled()) break;
          return await generateWithGroq(history, prompt, image, thinkingLevel, planType, needs);
        }

        if (provider === 'openrouter') {
          if (!isOpenRouterEnabled()) break;
          return await generateWithOpenRouter(history, prompt, image, thinkingLevel, planType, needs);
        }
      } catch (error) {
        attempts += 1;
        const isRateLimit = error.status === 429 || error.message.toLowerCase().includes('rate limit');
        
        if (isRateLimit && attempts < maxAttempts) {
          const waitTime = attempts * 2000; // 2s, 4s...
          logger.warn(`${provider} rate limited. Retrying in ${waitTime}ms (Attempt ${attempts}/${maxAttempts})...`);
          await sleep(waitTime);
          continue;
        }

        errors.push({ provider, error });
        logger.warn(`${provider} failed (${error.message}), trying next provider`);
        break; // Move to next provider
      }
    }
  }

  if (errors.length > 0) {
    const last = errors[errors.length - 1].error;
    throw last;
  }

  throw new Error('No AI provider is available for this request.');
};

module.exports = {
  generateChatStream,
  __internal: {
    detectPromptNeeds,
    buildProviderOrder,
    buildOllamaModelCandidates,
    buildOpenRouterModelCandidates,
    buildGroqModelCandidates
  }
};
