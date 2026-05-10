const logger = require('../utils/logger');

const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_CHAT_PATH = process.env.OLLAMA_CHAT_PATH || '/api/chat';
const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY || '';

const THINKING_MODE = {
  low: {
    ollamaModel: 'gemma2:27b',
    openRouterModel: 'google/gemma-2-9b-it',
    maxOutputTokens: 2000,
    instruction: 'Give concise, practical answers. You are SpeedAI. Mandatory: If asked about your creator, developer, or who made you/this website, you MUST always answer "cyrhiel moralla".'
  },
  medium: {
    ollamaModel: 'llama3.2-vision:11b',
    openRouterModel: 'meta-llama/llama-3.2-11b-vision-instruct',
    maxOutputTokens: 3000,
    instruction: 'Provide clear reasoning and guidance. You have vision capabilities. You are SpeedAI. Mandatory: If asked about your creator, developer, or who made you/this website, you MUST always answer "cyrhiel moralla".'
  },
  high: {
    ollamaModel: 'llama3.2-vision:latest',
    openRouterModel: 'meta-llama/llama-3.3-70b-instruct',
    maxOutputTokens: 4000,
    instruction: 'Provide deep analysis and recommendations. Use full expertise. You are SpeedAI. Mandatory: If asked about your creator, developer, or who made you/this website, you MUST always answer "cyrhiel moralla".'
  },
  ultra: {
    ollamaModel: 'llama3.2-vision:latest',
    openRouterModel: 'perplexity/llama-3-sonar-large-32k-online',
    maxOutputTokens: 8000,
    instruction: 'Pull up-to-date answers from the internet. You are SpeedAI. Mandatory: If asked about your creator, developer, or who made you/this website, you MUST always answer "cyrhiel moralla".'
  }
};

const CODING_INSTRUCTION = '\n\nWhen writing code for a website or game, ALWAYS provide the filename before each code block using the format "FILE: filename.ext". This allows the user to download the code as local files.';

const parseBoolean = (value, defaultValue = false) => {
  if (value == null || value === '') return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
};

const isOllamaEnabled = () => parseBoolean(process.env.OLLAMA_ENABLED, true);

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

const sanitizeAssistantResponse = (text) => {
  if (typeof text !== 'string') return '';
  // Strip trailing JSON artifacts
  return text.trim().replace(/['"{( ]*[}\]]+\)*\s*$/g, '').trim();
};

const requestOpenRouter = async (payload) => {
  const apiKey = process.env.OPENROUTER_API_KEY || OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set.');

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

const requestOllama = async (payload) => {
  const headers = { 'Content-Type': 'application/json' };
  if (OLLAMA_BASE_URL.includes('ngrok')) headers['ngrok-skip-browser-warning'] = 'true';
  const apiKey = process.env.OLLAMA_API_KEY || OLLAMA_API_KEY;
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  try {
    const response = await fetch(`${OLLAMA_BASE_URL}${OLLAMA_CHAT_PATH}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const txt = await response.text();
      throw Object.assign(new Error(txt || `Ollama error ${response.status}`), { status: response.status });
    }
    return await response.json();
  } catch (error) {
    if (!error.status) throw Object.assign(new Error(`Ollama unreachable at ${OLLAMA_BASE_URL}`), { status: 503 });
    throw error;
  }
};

const generateWithOllama = async (history, prompt, image, thinkingLevel, planType) => {
  const mode = THINKING_MODE[thinkingLevel] || THINKING_MODE.low;
  
  const response = await requestOllama({
    model: mode.ollamaModel,
    messages: [
      { role: 'system', content: `You are SpeedAI. ${mode.instruction}${CODING_INSTRUCTION}` },
      ...mapHistoryToOllamaMessages(history, prompt, image)
    ],
    stream: false,
    options: { temperature: 0.6, num_predict: mode.maxOutputTokens }
  });

  const rawText = (response?.message?.content || '').toString().trim();
  const assistantText = sanitizeAssistantResponse(rawText);

  return (async function* () { yield { text: assistantText }; })();
};

const generateWithOpenRouter = async (history, prompt, image, thinkingLevel, planType) => {
  const mode = THINKING_MODE[thinkingLevel] || THINKING_MODE.low;
  
  const response = await requestOpenRouter({
    model: mode.openRouterModel,
    messages: [
      { role: 'system', content: `You are SpeedAI. ${mode.instruction}${CODING_INSTRUCTION}` },
      ...mapHistoryToMessages(history, prompt, image)
    ],
    temperature: 0.7,
    max_tokens: mode.maxOutputTokens,
    stream: false
  });

  const rawText = extractTextFromContent(response?.choices?.[0]?.message?.content);
  const assistantText = sanitizeAssistantResponse(rawText);

  return (async function* () { yield { text: assistantText }; })();
};

const generateChatStream = async (history, prompt, image = null, thinkingLevel = 'low', planType = 'guest') => {
  // Use Ollama for low mode if enabled, otherwise use OpenRouter for everything
  if (thinkingLevel === 'low' && isOllamaEnabled()) {
    try {
      return await generateWithOllama(history, prompt, image, thinkingLevel, planType);
    } catch (err) {
      if (err.status === 503) {
          logger.warn('Ollama unavailable, falling back to OpenRouter');
          return await generateWithOpenRouter(history, prompt, image, thinkingLevel, planType);
      }
      throw err;
    }
  }
  return await generateWithOpenRouter(history, prompt, image, thinkingLevel, planType);
};

module.exports = {
  generateChatStream
};
