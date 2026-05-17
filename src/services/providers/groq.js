const BaseChatProvider = require('./base');
const logger = require('../../utils/logger');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

const THINKING_MODE = {
  low: { model: process.env.GROQ_MODEL_LOW || 'llama-3.3-70b-versatile', maxOutputTokens: 900, instruction: 'Give concise, practical answers with minimal reasoning steps.' },
  medium: { model: process.env.GROQ_MODEL_MEDIUM || 'llama-3.3-70b-versatile', maxOutputTokens: 1400, instruction: 'Provide clear reasoning, examples, and short step-by-step guidance.' },
  high: { model: process.env.GROQ_MODEL_HIGH || 'llama-3.3-70b-versatile', maxOutputTokens: 2200, instruction: 'Provide deep analysis, alternatives, trade-offs, and an actionable recommendation.' },
  ultra: { model: process.env.GROQ_MODEL_ULTRA || 'llama-3.3-70b-versatile', maxOutputTokens: 4000, instruction: 'Provide deep research and analysis.' },
  god: { model: process.env.GROQ_MODEL_GOD || 'llama-3.3-70b-versatile', maxOutputTokens: 8192, instruction: 'Provide the most comprehensive answer possible.' }
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const extractTextFromContent = (content) => {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.filter(p => p && (p.type === 'text' || typeof p.text === 'string')).map(p => p.text || '').join('').trim();
  }
  return '';
};

const buildMessageContent = (parts = []) => {
  const content = [];
  for (const part of parts) {
    if (part && part.text) content.push({ type: 'text', text: part.text });
    if (part && part.inlineData && part.inlineData.data && part.inlineData.mimeType) {
      content.push({ type: 'image_url', image_url: { url: 'data:' + part.inlineData.mimeType + ';base64,' + part.inlineData.data } });
    }
  }
  if (content.length === 0) return '';
  if (content.length === 1 && content[0].type === 'text') return content[0].text;
  return content;
};

const mapHistoryToMessages = (history, prompt, image) => {
  const messages = history.map(entry => ({
    role: entry && entry.role === 'model' ? 'assistant' : 'user',
    content: buildMessageContent(entry && entry.parts || [])
  }));
  const userParts = [{ text: prompt }];
  if (image) userParts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
  messages.push({ role: 'user', content: buildMessageContent(userParts) });
  return messages;
};

const requestGroq = async (payload) => {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const error = new Error('GROQ_API_KEY is not configured.');
    error.status = 503;
    throw error;
  }
  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const txt = await response.text().catch(() => '');
    const err = new Error(txt || 'Groq failed with status ' + response.status);
    err.status = response.status;
    throw err;
  }
  return await response.json();
};

const withRetries = async (fn, retries = 3, baseDelayMs = 1000, shouldRetry) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try { return await fn(); }
    catch (error) {
      if (attempt >= retries - 1) throw error;
      if (shouldRetry && !shouldRetry(error)) throw error;
      await delay(baseDelayMs * Math.pow(2, attempt));
    }
  }
};

class GroqProvider extends BaseChatProvider {
  get name() { return 'groq'; }
  get displayName() { return 'Groq'; }
  isAvailable() { return !!process.env.GROQ_API_KEY; }
  getDefaultModel() { return THINKING_MODE.low.model; }
  getModels() {
    const models = [];
    for (const [level, cfg] of Object.entries(THINKING_MODE)) {
      models.push({ id: cfg.model, name: cfg.model.split('/').pop(), provider: 'groq', thinkingLevels: [level], description: 'Groq ' + cfg.model + ' - ' + level + ' mode' });
    }
    return models;
  }
  async generateChatStream({ history, prompt, image, thinkingLevel, planType, model: explicitModel }) {
    const mode = THINKING_MODE[thinkingLevel] || THINKING_MODE.low;
    const model = explicitModel || mode.model;
    const messages = [
      { role: 'system', content: 'You are Cynework AI. ' + mode.instruction + ' Plan: ' + (planType || 'guest') },
      ...mapHistoryToMessages(history, prompt, image)
    ];
    const response = await withRetries(
      () => requestGroq({ model, messages, max_tokens: parseInt(process.env.MAX_TOKENS, 10) || mode.maxOutputTokens, temperature: parseFloat(process.env.TEMPERATURE) || 0.7 }),
      3, 1000,
      (error) => !(error && (error.status === 401 || (error.status >= 400 && error.status < 500)))
    );
    const text = extractTextFromContent(response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content);
    if (!text) throw new Error('Groq returned an empty response.');
    return (async function*() { yield { text }; })();
  }
}

module.exports = GroqProvider;
