const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

const modelsToTest = [
  'google/gemma-2-27b-it',
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-3.2-11b-vision-instruct',
  'meta-llama/llama-3.3-70b-instruct',
  'perplexity/sonar'
];

async function testModel(modelId) {
  console.log(`Testing model: ${modelId}...`);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'Say "Ready"' }],
        max_tokens: 10
      })
    });

    const data = await response.json();
    if (response.ok) {
      console.log(`✅ ${modelId}: SUCCESS. Response: ${data.choices[0].message.content.trim()}`);
      return true;
    } else {
      console.error(`❌ ${modelId}: FAILED. Status: ${response.status}. Error: ${JSON.stringify(data.error)}`);
      return false;
    }
  } catch (err) {
    console.error(`❌ ${modelId}: ERROR. ${err.message}`);
    return false;
  }
}

async function runAllTests() {
  if (!OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY is required to run this script.');
    process.exit(1);
  }

  console.log('--- Starting OpenRouter Model Availability Tests ---');
  for (const model of modelsToTest) {
    await testModel(model);
    // Add small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 1000));
  }
  console.log('--- Tests Completed ---');
}

runAllTests();
