const BaseChatProvider = require('./base');
const logger = require('../../utils/logger');

class OllamaProvider extends BaseChatProvider {
  get name() { return 'ollama'; }
  get displayName() { return 'Ollama'; }
  
  isAvailable() {
    return !!(process.env.OLLAMA_API_KEY || process.env.OLLAMA_BASE_URL || process.env.OLLAMA_LOCAL_MODELS || process.env.OLLAMA_CLOUD_MODELS);
  }
  
  getDefaultModel() {
    return process.env.OLLAMA_MODEL || 'llama3';
  }
  
  getModels() {
    const models = [];
    const localModels = (process.env.OLLAMA_LOCAL_MODELS || 'llama3').split(',').map(s => s.trim()).filter(Boolean);
    const cloudModels = (process.env.OLLAMA_CLOUD_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
    
    for (const m of localModels) {
      models.push({ id: m, name: m.split('/').pop(), provider: 'ollama', thinkingLevels: ['low', 'medium'], description: 'Local Ollama: ' + m });
    }
    for (const m of cloudModels) {
      models.push({ id: m, name: m.split('/').pop(), provider: 'ollama', thinkingLevels: ['high', 'ultra', 'god'], description: 'Cloud Ollama: ' + m });
    }
    
    return models;
  }
  
  async generateChatStream({ history, prompt, image, thinkingLevel, planType, model: explicitModel }) {
    const model = explicitModel || this.getDefaultModel();
    throw new Error('Ollama is configured but the provider is not fully implemented. Use local Ollama directly or configure another provider.');
  }
}

module.exports = OllamaProvider;
