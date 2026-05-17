const logger = require('../../utils/logger');

function getAvailableProviders() {
  const providers = [];
  try { const G = require('./groq'); providers.push(new G()); } catch (e) { logger.warn('Groq load failed: ' + e.message); }
  try { const O = require('./openrouter'); providers.push(new O()); } catch (e) { logger.warn('OpenRouter load failed: ' + e.message); }
  try { const Gm = require('./gemini'); providers.push(new Gm()); } catch (e) { logger.warn('Gemini load failed: ' + e.message); }
  try { const Ol = require('./ollama'); providers.push(new Ol()); } catch (e) { logger.warn('Ollama load failed: ' + e.message); }
  return providers.filter(p => p.isAvailable && p.isAvailable());
}

class ChatDriver {
  constructor() {
    this.providers = [];
    this.initialized = false;
  }
  initialize() {
    if (this.initialized) return;
    this.providers = getAvailableProviders();
    this.initialized = true;
    logger.info('ChatDriver initialized: ' + this.providers.map(p => p.name).join(', '));
  }
  getProvider(name) {
    return this.providers.find(p => p.name === (name || '').toLowerCase());
  }
  getAllModels() {
    return this.providers.flatMap(p => { try { return p.getModels(); } catch { return []; } });
  }
  async routeChat(params) {
    this.initialize();
    const preferred = params.provider;
    const mode = (process.env.AI_PROVIDER || 'auto').trim().toLowerCase();

    // If user specified a provider, try it first
    if (preferred) {
      const p = this.getProvider(preferred);
      if (p) {
        try { return await p.generateChatStream(params); }
        catch (e) { logger.warn(preferred + ' failed: ' + e.message); }
      }
    }

    // Auto-routing based on thinking level
    const isSpecialized = params.thinkingLevel === 'ultra' || params.thinkingLevel === 'god';

    if (mode.startsWith('ollama')) {
      const p = this.getProvider('ollama');
      if (p) return await p.generateChatStream(params);
    }

    if (isSpecialized) {
      const p = this.getProvider('openrouter');
      if (p) {
        try { return await p.generateChatStream(params); }
        catch (e) { logger.warn('OpenRouter failed: ' + e.message); }
      }
    }

    if (!isSpecialized) {
      const p = this.getProvider('groq');
      if (p) {
        try { return await p.generateChatStream(params); }
        catch (e) { logger.warn('Groq failed: ' + e.message); }
      }
    }

    // Ultimate fallback
    for (const p of this.providers) {
      try { return await p.generateChatStream(params); }
      catch (e) { logger.warn('Fallback ' + p.name + ' failed: ' + e.message); }
    }

    throw new Error('All AI providers failed to generate a response.');
  }
}

const chatDriver = new ChatDriver();
module.exports = { ChatDriver, chatDriver, getAvailableProviders };
