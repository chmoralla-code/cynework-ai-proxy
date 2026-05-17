const logger = require('../utils/logger');
const { chatDriver } = require('./providers');

/**
 * Main entry point for AI chat generation.
 * Delegates to the ChatDriver (inspired by Puter's ChatCompletionDriver pattern).
 * The ChatDriver automatically routes to the best available provider based on:
 * - User's preferred provider (if specified)
 * - Thinking level (auto-routing: ultra/god -> OpenRouter, low/med/high -> Groq)
 * - Fallback chain if primary provider fails
 */
const generateChatStream = async (history, prompt, image = null, thinkingLevel = 'low', planType = 'guest', provider = null, model = null) => {
  return await chatDriver.routeChat({
    history,
    prompt,
    image,
    thinkingLevel,
    planType,
    provider,
    model
  });
};

/**
 * Get all available models across all providers
 */
const getAvailableModels = () => {
  return chatDriver.getAllModels();
};

/**
 * Get available providers
 */
const getActiveProviders = () => {
  chatDriver.initialize();
  return chatDriver.providers.map(p => ({
    name: p.name,
    displayName: p.displayName,
    available: p.isAvailable(),
    defaultModel: p.getDefaultModel()
  }));
};

// Initialize the ChatDriver
chatDriver.initialize();

module.exports = {
  generateChatStream,
  getAvailableModels,
  getActiveProviders
};
