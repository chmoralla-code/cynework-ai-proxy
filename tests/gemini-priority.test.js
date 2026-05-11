describe('Gemini service priority logic', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  test('prioritizes vision providers when an image is attached', () => {
    const { __internal } = require('../src/services/gemini');
    const needs = __internal.detectPromptNeeds('Describe this image', { data: 'abc' });
    expect(__internal.buildProviderOrder(needs)).toEqual(['ollama', 'openrouter']);
  });

  test('prioritizes coding providers for coding prompts', () => {
    const { __internal } = require('../src/services/gemini');
    const needs = __internal.detectPromptNeeds('Fix this TypeScript API bug and refactor', null);
    expect(__internal.buildProviderOrder(needs)).toEqual(['groq', 'openrouter', 'ollama']);
  });

  test('openrouter candidate ranking boosts coding models for coding prompts', () => {
    process.env.OPENROUTER_FALLBACK_MODELS = 'google/gemma-4-31b-it:free,qwen/qwen3-coder:free';
    const { __internal } = require('../src/services/gemini');
    const candidates = __internal.buildOpenRouterModelCandidates(
      'high',
      { openRouterModel: 'google/gemma-4-31b-it:free' },
      { needsCoding: true, needsVision: false }
    );
    expect(candidates[0]).toBe('qwen/qwen3-coder:free');
  });

  test('ollama candidate ranking boosts vision models when image is present', () => {
    process.env.OLLAMA_CLOUD_MODELS = 'qwen2.5:7b,llama3.2-vision:11b';
    const { __internal } = require('../src/services/gemini');
    const candidates = __internal.buildOllamaModelCandidates(
      'medium',
      { ollamaModel: 'qwen2.5:7b' },
      { needsCoding: false, needsVision: true }
    );
    expect(candidates[0]).toBe('llama3.2-vision:11b');
  });

  test('openrouter image mode keeps only vision-capable models', () => {
    process.env.OPENROUTER_FALLBACK_MODELS = 'qwen/qwen3-coder:free,meta-llama/llama-3.2-11b-vision-instruct';
    const { __internal } = require('../src/services/gemini');
    const candidates = __internal.buildOpenRouterModelCandidates(
      'medium',
      { openRouterModel: 'qwen/qwen3-coder:free' },
      { needsCoding: false, needsVision: true }
    );
    expect(candidates).toEqual(expect.arrayContaining(['meta-llama/llama-3.2-11b-vision-instruct']));
    expect(candidates).not.toEqual(expect.arrayContaining(['qwen/qwen3-coder:free']));
  });
});
