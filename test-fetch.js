require('dotenv').config();

async function test(model) {
  try {
    const response = await fetch("https://api.puter.com/drivers/call", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.PUTER_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        interface: "puter-image-generation",
        driver: "ai-image",
        method: "generate",
        args: {
            prompt: "a cat",
            model: model,
            responseType: "json"
        }
      })
    });
    console.log(model, await response.json());
  } catch (err) {
    console.error("Error:", err);
  }
}
async function run() {
    await test('gpt-image-1.5');
    await test('gpt-image-1-mini');
    await test('gpt-image-1');
    await test('gemini-2.5-flash-image');
    await test('gemini-3.1-flash-image-preview');
}
run();