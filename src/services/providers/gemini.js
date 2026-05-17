const BaseChatProvider = require('./base');
const logger = require('../../utils/logger');

const THINKING_MODE = {
  low: { model: process.env.GEMINI_MODEL_LOW || 'gemini-2.0-flash', maxOutputTokens: 2048, instruction: 'Give concise, practical answers with minimal reasoning steps.' },
  medium: { model: process.env.GEMINI_MODEL_MEDIUM || 'gemini-2.0-flash', maxOutputTokens: 4096, instruction: 'Provide clear reasoning, examples, and short step-by-step guidance.' },
  high: { model: process.env.GEMINI_MODEL_HIGH || 'gemini-2.0-flash', maxOutputTokens: 8192, instruction: 'Provide deep analysis, alternatives, trade-offs, and an actionable recommendation. Analyze images if provided.' },
  ultra: { model: process.env.GEMINI_MODEL_ULTRA || 'gemini-2.0-flash', maxOutputTokens: 16384, instruction: 'Provide deep research, analysis, and comprehensive facts.' },
  god: { model: process.env.GEMINI_MODEL_GOD || 'gemini-2.5-pro-exp-03-25', maxOutputTokens: 32768, instruction: 'Provide the most comprehensive, accurate, and brilliantly structured answer possible.' }
};

class GeminiProvider extends BaseChatProvider {
  get name() { return 'gemini'; }
  get displayName() { return 'Google Gemini'; }
  isAvailable() { return !!process.env.GEMINI_API_KEY; }
  getDefaultModel() { return THINKING_MODE.god.model; }
  getModels() {
    const models = [];
    for (const [level, cfg] of Object.entries(THINKING_MODE)) {
      models.push({ id: cfg.model, name: cfg.model, provider: 'gemini', thinkingLevels: [level], description: 'Google Gemini ' + cfg.model + ' - ' + level + ' mode' });
    }
    return models;
  }
  async generateChatStream({ history, prompt, image, thinkingLevel, planType, model: explicitModel }) {
    const { GoogleGenAI } = require('@google/genai');
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set on the server.');
    const mode = THINKING_MODE[thinkingLevel] || THINKING_MODE.god;
    const ai = new GoogleGenAI({ apiKey });
    const model = explicitModel || mode.model;

    const contents = history.map(entry => ({
      role: entry && entry.role === 'model' ? 'model' : 'user',
      parts: (entry && entry.parts || []).map(p => {
        if (p && p.text) return { text: p.text };
        if (p && p.inlineData) return { inlineData: { data: p.inlineData.data, mimeType: p.inlineData.mimeType } };
        return { text: '' };
      })
    }));

    const promptParts = [{ text: prompt }];
    if (image) promptParts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
    contents.push({ role: 'user', parts: promptParts });

    const responseStream = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: 'You are cyAIrhiel. ' + mode.instruction + ' Plan: ' + (planType || 'guest'),
        tools: [{ googleSearch: {} }],
        temperature: parseFloat(process.env.TEMPERATURE) || 0.7,
      }
    });

    return (async function* () {
      for await (const chunk of responseStream) {
        if (chunk && chunk.text) yield { text: chunk.text };
      }
    })();
  }
}

module.exports = GeminiProvider;
