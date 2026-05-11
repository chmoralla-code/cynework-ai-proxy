# Ollama + OpenRouter Chatbox Proxy

A secure, highly-available Node.js + Express backend proxy with a minimal frontend that mimics the ChatGPT interface while communicating with Ollama (local/cloud) and OpenRouter fallback.

## Features
- **Provider Fallback:** Ollama first (local/cloud model list), then OpenRouter fallback.
- **Secure Key Management:** `OPENROUTER_API_KEY`/`OLLAMA_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` remain server-side.
- **Email-Verified Accounts:** Supabase Auth email/password with verification-required registration.
- **Tiered Usage + Thinking Modes:** Guest (5 generations), registered free (unlimited low), paid plans unlock medium/high.
- **Admin Dashboard:** Admin login, view clients, delete accounts, and approve subscription requests.
- **Server-Sent Events (SSE) Streaming:** Progressive text generation just like ChatGPT.
- **Quota Resilience:** Retries follow provider retry hints, and optional model fallback can reduce 429 failures.

## Prerequisites
- Node.js (v18+ recommended)
- Ollama running locally or via a reachable endpoint (`OLLAMA_BASE_URL`)
- Optional OpenRouter API Key (`OPENROUTER_API_KEY`) for backup
- Optional: Supabase Project (for multi-instance scaling history fallback)

## Setup

1. Clone and install dependencies:
   ```bash
   npm install
   ```

2. Create a `.env` file in the root based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

3. Update `.env`:
   ```env
OPENROUTER_API_KEY=your_actual_openrouter_key_here
AI_PROVIDER=auto
OLLAMA_ENABLED=true
OLLAMA_BASE_URL=https://ollama.com/api
OLLAMA_MODEL=qwen2.5:7b
OLLAMA_MODEL_LOW=qwen2.5:7b
OLLAMA_MODEL_MEDIUM=llama3.2-vision:11b
OLLAMA_MODEL_HIGH=llama3.1:8b
OLLAMA_LOCAL_MODELS=qwen2.5:7b,llama3.2:3b,llama3.1:8b
OLLAMA_CLOUD_MODELS=qwen2.5:7b,llama3.1:8b,llama3.2-vision:11b,llava:7b
GROQ_ENABLED=true
GROQ_API_KEY=your_groq_api_key_here
GROQ_MODEL_LOW=llama-3.1-8b-instant
GROQ_MODEL_MEDIUM=llama-3.3-70b-versatile
GROQ_MODEL_HIGH=llama-3.3-70b-versatile
GROQ_FALLBACK_MODELS=llama-3.3-70b-versatile,qwen-qwq-32b,deepseek-r1-distill-llama-70b
OPENROUTER_FALLBACK_ENABLED=true
OPENROUTER_MODEL=openai/gpt-oss-20b:free
OPENROUTER_MODEL_LOW=openai/gpt-oss-20b:free
OPENROUTER_MODEL_MEDIUM=qwen/qwen3-coder:free
OPENROUTER_MODEL_HIGH=google/gemma-4-31b-it:free
OPENROUTER_FALLBACK_MODELS=openai/gpt-oss-20b:free,qwen/qwen3-coder:free,google/gemma-4-31b-it:free,nvidia/nemotron-3-nano-30b-a3b:free
OPENROUTER_AUTO_FREE_FALLBACK=true
OPENROUTER_MAX_FALLBACK_MODELS=40
OPENROUTER_FREE_MODELS_CACHE_SECONDS=600
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin1234
ADMIN_SESSION_SECRET=change_this_secret
GCASH_NUMBER=09505339963
GCASH_ACCOUNT_NAME=henry s.
   ```

4. Start the server:
   ```bash
   npm start
   ```
   Navigate to `http://localhost:3000` to interact with the chat interface.

When `OPENROUTER_AUTO_FREE_FALLBACK=true`, the server auto-loads currently available `:free` models from OpenRouter and appends them as fallback candidates (cached by `OPENROUTER_FREE_MODELS_CACHE_SECONDS`).

Default routing automatically prioritizes providers by request type:
- Image prompts: Ollama vision -> OpenRouter vision -> Groq
- Coding prompts: Groq coding -> OpenRouter coding -> Ollama
- General prompts: Ollama -> Groq -> OpenRouter  

Use `AI_PROVIDER=ollama-only` to keep provider routing permanently on Ollama and disable OpenRouter fallback.  
For cloud deployment (Vercel) using Ollama from your computer, expose your local Ollama endpoint with a secure tunnel and set that public URL as `OLLAMA_BASE_URL`.

## Testing
Run the Jest integration and unit test suite:
```bash
npm test
```

## Deployment
### Using Docker
1. Build the image:
   ```bash
   docker build -t gemini-proxy .
   ```
2. Run the image:
   ```bash
   docker run -p 3000:3000 -e OPENROUTER_API_KEY='your_key' gemini-proxy
   ```

### Vercel / Heroku
- **Vercel:** Because this uses SSE (Server-Sent Events) which is a long-lived connection, Vercel Serverless Functions might time out (hobby tier is 10s). You may need to use Edge functions or a persistent host if queries take a long time.
- **Heroku/Render/Railway:** Deployment is straightforward. Simply connect your GitHub repository. Ensure you set the `OPENROUTER_API_KEY` environment variable in the dashboard settings. No Redis add-on is strictly required due to the in-memory fallback, but it is highly recommended if you scale to multiple web dynos.

## Security Considerations
- **No Client-Side Service Secrets:** Never expose service-role or admin secrets in frontend code.
- **Rotate defaults before production:** Change `ADMIN_PASSWORD` and `ADMIN_SESSION_SECRET`.
- **Email confirmation:** Enable "Confirm email" in Supabase Auth settings.
