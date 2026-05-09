const { GoogleGenAI } = require('@google/genai');
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
(async () => {
  try {
    const models = await ai.models.list();
    console.log('Available Models:', models.map(m => m.name));
  } catch (e) {
    console.error('List Models Error:', e);
  }
})();
