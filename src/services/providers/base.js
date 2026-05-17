/**
 * Base provider interface (inspired by Puter's IChatProvider pattern).
 * Each AI provider should extend this class and implement the required methods.
 */
class BaseChatProvider {
  /**
   * @returns {string} The provider name identifier (e.g., 'groq', 'openrouter')
   */
  get name() {
    throw new Error('Provider must implement get name()');
  }

  /**
   * @returns {string} Display name for the provider (e.g., 'Groq', 'OpenRouter')
   */
  get displayName() {
    return this.name;
  }

  /**
   * @returns {string} Default model ID for this provider
   */
  getDefaultModel() {
    throw new Error('Provider must implement getDefaultModel()');
  }

  /**
   * @returns {Array<{id: string, name: string, provider: string, thinkingLevels: string[], description: string}>}
   */
  getModels() {
    throw new Error('Provider must implement getModels()');
  }

  /**
   * Generate a chat response.
   * @param {Object} params
   * @param {Array} params.history - Chat history
   * @param {string} params.prompt - User prompt
   * @param {Object|null} params.image - Image data {data, mimeType}
   * @param {string} params.thinkingLevel - Thinking level
   * @param {string} params.planType - User plan type
   * @param {string} params.model - Specific model to use
   * @returns {AsyncGenerator} Async generator yielding {text} chunks
   */
  async generateChatStream(params) {
    throw new Error('Provider must implement generateChatStream()');
  }

  /**
   * Check if this provider is available (has API key configured, etc.)
   * @returns {boolean}
   */
  isAvailable() {
    return true;
  }
}

module.exports = BaseChatProvider;
