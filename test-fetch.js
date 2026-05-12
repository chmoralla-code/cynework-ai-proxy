require('dotenv').config();

async function test() {
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
            model: "gpt-image-2",
            responseType: "json"
        }
      })
    });
    console.log(await response.json());
  } catch (err) {
    console.error("Error:", err);
  }
}
test();