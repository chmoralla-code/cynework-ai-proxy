const BaseChatProvider = require('./base');
const logger = require('../../utils/logger');

const OR_URL = process.env.OPENROUTER_API_URL || 'https://openrouter.ai/api/v1/chat/completions';
const OR_MODELS_URL = process.env.OPENROUTER_MODELS_URL || 'https://openrouter.ai/api/v1/models';

const MODES = {
  ultra: { model: process.env.GROQ_MODEL_ULTRA || 'deepseek/deepseek-chat:free', maxTokens: 4000, instruction: 'Provide deep research and analysis. Specialized for coding.' },
  god: { model: process.env.GROQ_MODEL_GOD || 'openai/gpt-3.5-turbo:free', maxTokens: 8192, instruction: 'God Mode. Provide the most comprehensive answer possible.' }
};

const cache = { expiresAt: 0, models: [] };
const delay = ms => new Promise(r => setTimeout(r, ms));

const extractText = c => {
  if (!c) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter(p => p && (p.type === 'text' || typeof p.text === 'string')).map(p => p.text || '').join('').trim();
  return '';
};

const buildContent = (parts = []) => {
  const c = [];
  for (const p of parts) {
    if (p && p.text) c.push({ type: 'text', text: p.text });
    if (p && p.inlineData && p.inlineData.data) c.push({ type: 'image_url', image_url: { url: 'data:' + p.inlineData.mimeType + ';base64,' + p.inlineData.data } });
  }
  if (c.length === 0) return '';
  if (c.length === 1 && c[0].type === 'text') return c[0].text;
  return c;
};

const mapMessages = (history, prompt, image) => {
  const msgs = history.map(e => ({ role: e && e.role === 'model' ? 'assistant' : 'user', content: buildContent(e && e.parts || []) }));
  const parts = [{ text: prompt }];
  if (image) parts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
  msgs.push({ role: 'user', content: buildContent(parts) });
  return msgs;
};

const parseBool = (v, d = false) => {
  if (v == null || v === '') return d;
  const n = String(v).trim().toLowerCase();
  return ['1','true','yes','on'].includes(n);
};

const getHeaders = apiKey => ({
  Authorization: 'Bearer ' + apiKey,
  'Content-Type': 'application/json',
  ...(process.env.OPENROUTER_SITE_URL ? { 'HTTP-Referer': process.env.OPENROUTER_SITE_URL } : {}),
  ...(process.env.OPENROUTER_APP_NAME ? { 'X-Title': process.env.OPENROUTER_APP_NAME } : {})
});

const withRetries = async (fn, retries, delayMs, shouldRetry) => {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= retries - 1 || (shouldRetry && !shouldRetry(e))) throw e;
      await delay(delayMs * Math.pow(2, i));
    }
  }
};

const fetchFreeModels = async apiKey => {
  const now = Date.now();
  if (cache.expiresAt > now && cache.models.length > 0) return [...cache.models];
  const res = await fetch(OR_MODELS_URL, { method: 'GET', headers: getHeaders(apiKey) });
  if (!res.ok) throw new Error('Failed to fetch models');
  const data = await res.json();
  const models = Array.isArray(data && data.data) ? data.data.map(e => e && e.id).filter(id => id && typeof id === 'string' && id.endsWith(':free')) : [];
  cache.models = models;
  cache.expiresAt = now + (parseInt(process.env.OPENROUTER_FREE_MODELS_CACHE_SECONDS, 10) || 600) * 1000;
  return [...models];
};

const buildCandidates = async (apiKey, primary) => {
  const cands = [primary, ...(process.env.OPENROUTER_FALLBACK_MODELS || '').split(',').map(m => m.trim()).filter(Boolean)];
  if (parseBool(process.env.OPENROUTER_AUTO_FREE_FALLBACK, true)) {
    try {
      const free = await fetchFreeModels(apiKey);
      const excluded = new Set(cands);
      const limit = Math.max(0, parseInt(process.env.OPENROUTER_MAX_FALLBACK_MODELS, 10) || 40);
      let added = 0;
      for (const m of free) { if (!excluded.has(m)) { cands.push(m); excluded.add(m); added++; if (limit > 0 && added >= limit) break; } }
    } catch (e) { logger.warn('Failed to load free models'); }
  }
  return cands.filter((v, i, a) => a.indexOf(v) === i);
};

const requestOR = async payload => {
  const res = await fetch(OR_URL, { method: 'POST', headers: getHeaders(process.env.OPENROUTER_API_KEY || ''), body: JSON.stringify(payload) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    const err = new Error(txt || 'OpenRouter failed: ' + res.status);
    err.status = res.status;
    const ra = res.headers.get('retry-after');
    if (ra) { const n = parseFloat(ra); if (n > 0) err.retryAfterMs = Math.round(n * 1000); }
    throw err;
  }
  return await res.json();
};

class OpenRouterProvider extends BaseChatProvider {
  get name() { return 'openrouter'; }
  get displayName() { return 'OpenRouter'; }
  isAvailable() { return !!process.env.OPENROUTER_API_KEY; }
  getDefaultModel() { return MODES.ultra.model; }
  getModels() {
    return Object.entries(MODES).map(([level, cfg]) => ({ id: cfg.model, name: (cfg.model.split('/').pop() || cfg.model), provider: 'openrouter', thinkingLevels: [level], description: 'OpenRouter ' + cfg.model + ' - ' + level }));
  }
  async generateChatStream({ history, prompt, image, thinkingLevel, planType, model: explicitModel }) {
    const mode = MODES[thinkingLevel] || MODES.ultra;
    const apiKey = process.env.OPENROUTER_API_KEY || '';
    const candidates = await buildCandidates(apiKey, explicitModel || mode.model);
    const messages = [{ role: 'system', content: 'You are Cynework AI. ' + mode.instruction + ' Plan: ' + (planType || 'guest') }, ...mapMessages(history, prompt, image)];
    const maxTokens = parseInt(process.env.MAX_TOKENS, 10) || mode.maxTokens;
    const temp = parseFloat(process.env.TEMPERATURE) || 0.7;
    let lastErr = null;
    for (let i = 0; i < candidates.length; i++) {
      try {
        const res = await withRetries(
          () => requestOR({ model: candidates[i], messages, max_tokens: maxTokens, temperature: temp, stream: false }),
          i < candidates.length - 1 ? 1 : 3, 1000,
          e => !(i < candidates.length - 1 && (e && (e.status === 429 || e.status === 404)))
        );
        const text = extractText(res && res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content);
        if (!text) throw new Error('Empty response');
        return (async function*() { yield { text }; })();
      } catch (e) {
        lastErr = e;
        if (i < candidates.length - 1 && e && (e.status === 429 || e.status === 404)) continue;
        throw e;
      }
    }
    throw lastErr || new Error('All models failed');
  }
}

module.exports = OpenRouterProvider;
