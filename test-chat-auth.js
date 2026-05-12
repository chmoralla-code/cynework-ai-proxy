const { init } = require("@heyputer/puter.js/src/init.cjs");
require('dotenv').config();
const puter = init(process.env.PUTER_TOKEN);

async function test() {
  try {
    const res = await puter.ai.chat([{role: 'user', content: 'hello'}], { model: 'claude-4-6-sonnet' });
    console.log(res);
  } catch (err) {
    console.error("Error:", err);
  }
}
test();