const express = require('express');
const router = express.Router();
const historyManager = require('../services/history');
const { generateChatStream } = require('../services/gemini');
const { getSupabaseServiceClient, getSupabasePublicConfig } = require('../services/supabase');
const { getAuthContext, assertThinkingAllowed, assertWithinQuota, incrementUsage, PLAN_LIMITS } = require('../services/access');
const { checkAdminCredentials, createSessionToken, buildCookie, buildExpiredCookie, requireAdmin } = require('../services/adminAuth');
const { validateMessage, validateSessionId, validateImage, validateThinkingLevel, validatePlan } = require('../utils/validation');
const logger = require('../utils/logger');

const PLAN_PRICES = {
  daily: 50,
  monthly: 500,
  yearly: 6000
};

const getGcashInfo = () => ({
  number: process.env.GCASH_NUMBER || '09505339963',
  accountName: process.env.GCASH_ACCOUNT_NAME || 'henry s.',
  redirectUrl: process.env.GCASH_REDIRECT_URL || 'https://www.gcash.com/'
});

const parseJsonSafely = (value) => {
  if (typeof value !== 'string') return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const extractErrorMessage = (error) => {
  if (!error) return '';
  if (typeof error === 'string') return error;
  if (typeof error?.message === 'string') {
    const parsed = parseJsonSafely(error.message);
    if (parsed?.error?.message) return parsed.error.message;
    return error.message;
  }
  if (error?.error?.message) return String(error.error.message);
  return '';
};

const getChatErrorResponse = (error) => {
  const message = extractErrorMessage(error);
  const providerMode = (process.env.AI_PROVIDER || 'auto').toLowerCase();
  const prefersOllama = providerMode.includes('ollama');
  if (message.includes('Validation') || message.includes('Message must') || message.includes('Invalid session') || message.includes('cannot be empty') || message.includes('exceeds maximum')) {
    return { status: 400, body: { error: message } };
  }
  if (message.includes('Invalid mimeType. Must be an image.')) {
    return { status: 400, body: { error: 'Unsupported image format. Please upload PNG, JPG, WEBP, GIF, or BMP.' } };
  }
  if (message.includes('OPENROUTER_API_KEY is not set')) {
    return { status: 500, body: { error: 'Server is missing OPENROUTER_API_KEY configuration.' } };
  }
  if (message.includes('OLLAMA_API_KEY is not set')) {
    return { status: 500, body: { error: 'Server is missing OLLAMA_API_KEY configuration.' } };
  }
  if (message.includes('No Ollama models configured')) {
    return { status: 500, body: { error: 'Ollama is enabled but no models are configured. Set OLLAMA_MODEL or OLLAMA_LOCAL_MODELS/OLLAMA_CLOUD_MODELS.' } };
  }
  if (message.includes('Ollama endpoint unreachable')) {
    return { status: 503, body: { error: 'Ollama endpoint is unreachable. Check OLLAMA_BASE_URL and ensure your computer endpoint is publicly reachable.' } };
  }
  const quotaErrorMessage = message.toLowerCase();
  const isModelUnavailable =
    error?.status === 404 ||
    quotaErrorMessage.includes('model unavailable') ||
    quotaErrorMessage.includes('could not be found') ||
    quotaErrorMessage.includes('unknown model') ||
    quotaErrorMessage.includes('not a valid model');

  const isQuotaError =
    error?.status === 429 ||
    quotaErrorMessage.includes('resource_exhausted') ||
    quotaErrorMessage.includes('quota exceeded') ||
    quotaErrorMessage.includes('too many requests');

  if (isQuotaError) {
    return {
      status: 429,
      body: {
        error: prefersOllama
          ? 'Ollama rate limit exceeded. Please retry shortly or switch to another Ollama cloud model.'
          : 'AI provider rate limit exceeded. Please retry shortly.'
      }
    };
  }
  if (isModelUnavailable) {
    if (quotaErrorMessage.includes('ollama')) {
      return {
        status: 502,
        body: {
          error: 'Model Unavailable: The configured Ollama model could not be found. Update OLLAMA_MODEL_* or OLLAMA_CLOUD_MODELS and ensure the model is pulled/active.'
        }
      };
    }

    return {
      status: 502,
      body: {
        error: 'Model Unavailable: The configured OpenRouter model could not be found. Switch OPENROUTER_MODEL_* or enable Ollama cloud fallback using OLLAMA_ENABLED=true with OLLAMA_CLOUD_MODELS.'
      }
    };
  }
  if (quotaErrorMessage.includes('content must be a string')) {
    return {
      status: 502,
      body: {
        error: 'The selected fallback model does not support image input. The service will now prioritize vision-capable models automatically.'
      }
    };
  }
  if (error?.status === 401) {
    return {
      status: 502,
      body: {
        error: prefersOllama
          ? `Ollama auth failed (${message})`
          : `Provider auth failed (${message})`
      }
    };
  }
  if (error?.status) return { status: error.status, body: { error: `[${error.status}] ${message}` } };
  return { status: 500, body: { error: `An error occurred while communicating with the AI model: ${message}` } };
};

router.get('/public-config', (req, res) => {
  const supabase = getSupabasePublicConfig();
  res.json({
    supabase,
    plans: {
      daily: { amountPhp: 50, dailyLimit: 100 },
      monthly: { amountPhp: 500, dailyLimit: 500 },
      yearly: { amountPhp: 6000, dailyLimit: null }
    },
    gcash: getGcashInfo()
  });
});

router.post('/auth/register', async (req, res) => {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) {
      throw Object.assign(new Error('Supabase is not configured on the server.'), { status: 500 });
    }

    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';
    const fullName = (req.body.fullName || '').trim();

    if (!email || !password) {
      throw Object.assign(new Error('Email and password are required.'), { status: 400 });
    }

    if (password.length < 6) {
      throw Object.assign(new Error('Password must be at least 6 characters.'), { status: 400 });
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { full_name: fullName },
      email_confirm: true
    });

    if (error) throw error;

    res.status(201).json({
      message: 'Registration successful! You can now log in.',
      user: { id: data.user.id, email: data.user.email }
    });
  } catch (error) {
    logger.error('Registration error', error);
    const message = error.message || 'Registration failed.';
    const status = error.status || 500;
    res.status(status).json({ error: message });
  }
});

router.post('/auth/login', async (req, res) => {
  try {
    const { url, publishableKey } = getSupabasePublicConfig();
    if (!url || !publishableKey) {
      throw Object.assign(new Error('Supabase is not configured on the server.'), { status: 500 });
    }

    const email = (req.body.email || '').trim().toLowerCase();
    const password = req.body.password || '';

    if (!email || !password) {
      throw Object.assign(new Error('Email and password are required.'), { status: 400 });
    }

    const response = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const providerMessage = data?.error_description || data?.msg || data?.error || '';
      const isInvalidCredentials =
        response.status === 400 ||
        response.status === 401 ||
        response.status === 403 ||
        /invalid.*(credential|login|password|email)|email or password|login failed/i.test(providerMessage);

      const message = isInvalidCredentials
        ? 'Incorrect password or email.'
        : providerMessage || 'Login failed.';

      logger.warn('Login attempt failed', {
        email,
        status: response.status,
        message
      });

      const error = Object.assign(new Error(message), { status: response.status || 401 });
      throw error;
    }

    res.json({
      message: 'Login successful!',
      session: {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: data.expires_in,
        token_type: data.token_type
      },
      user: data.user || null
    });
  } catch (error) {
    logger.error('Login error', error);
    const message = error.message || 'Login failed.';
    const status = error.status || 500;
    res.status(status).json({ error: message });
  }
});

router.get('/auth/me', async (req, res) => {
  try {
    if (!req.headers.authorization?.startsWith('Bearer ')) {
      return res.json({
        authenticated: false,
        planType: 'guest',
        limits: PLAN_LIMITS.guest
      });
    }

    const authContext = await getAuthContext(req, 'auth-me');
    return res.json({
      authenticated: true,
      user: {
        id: authContext.user.id,
        email: authContext.user.email
      },
      profile: authContext.profile,
      planType: authContext.planType,
      limits: authContext.quota
    });
  } catch (error) {
    const normalized = getChatErrorResponse(error);
    return res.status(normalized.status).json(normalized.body);
  }
});

router.post('/subscription/request', async (req, res) => {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) {
      throw Object.assign(new Error('Supabase is not configured on the server.'), { status: 500 });
    }

    const authContext = await getAuthContext(req, req.body.sessionId || 'subscription');
    if (!authContext.isAuthenticated) {
      throw Object.assign(new Error('Please log in to request a subscription.'), { status: 401 });
    }

    const plan = validatePlan(req.body.plan);
    const referenceNote = (req.body.referenceNote || '').toString().trim().slice(0, 250);
    const gcash = getGcashInfo();

    const payload = {
      user_id: authContext.user.id,
      plan,
      amount_php: PLAN_PRICES[plan],
      gcash_number: gcash.number,
      gcash_name: gcash.accountName,
      reference_note: referenceNote || null
    };

    const { data, error } = await supabase
      .from('subscription_requests')
      .insert(payload)
      .select('*')
      .single();

    if (error) throw error;

    res.status(201).json({
      message: 'Subscription request submitted. Complete GCash payment and wait for admin approval.',
      request: data,
      gcash
    });
  } catch (error) {
    logger.error('Subscription request error', error);
    const normalized = getChatErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
});

router.post('/stream', async (req, res) => {
  try {
    const rawSessionId = req.body.sessionId;
    const rawMessage = req.body.message;
    const rawImage = req.body.image;
    const rawThinkingLevel = req.body.thinkingLevel;

    const sessionId = validateSessionId(rawSessionId);
    const message = validateMessage(rawMessage);
    const image = validateImage(rawImage);
    const thinkingLevel = validateThinkingLevel(rawThinkingLevel);

    const authContext = await getAuthContext(req, sessionId);
    await assertWithinQuota(authContext);
    assertThinkingAllowed(authContext, thinkingLevel);

    const history = await historyManager.getHistory(sessionId);
    const stream = await generateChatStream(history, message, image, thinkingLevel, authContext.planType);
    await incrementUsage(authContext);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    await historyManager.addMessage(sessionId, 'user', message, image, authContext.user?.id || null, thinkingLevel);

    let fullAssistantResponse = '';
    for await (const chunk of stream) {
      if (chunk.text) {
        fullAssistantResponse += chunk.text;
        res.write(`data: ${JSON.stringify({ text: chunk.text })}\n\n`);
      }
    }

    await historyManager.addMessage(sessionId, 'model', fullAssistantResponse, null, authContext.user?.id || null, thinkingLevel);
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (error) {
    logger.error('Stream chat error', error);
    if (!res.headersSent) {
      const normalized = getChatErrorResponse(error);
      return res.status(normalized.status).json(normalized.body);
    }
    res.write(`data: ${JSON.stringify({ error: 'Stream interrupted due to an error.' })}\n\n`);
    res.end();
  }
});

router.post('/', async (req, res) => {
  try {
    const sessionId = validateSessionId(req.body.sessionId);
    const message = validateMessage(req.body.message);
    const thinkingLevel = validateThinkingLevel(req.body.thinkingLevel);

    const authContext = await getAuthContext(req, sessionId);
    await assertWithinQuota(authContext);
    assertThinkingAllowed(authContext, thinkingLevel);

    const history = await historyManager.getHistory(sessionId);
    const stream = await generateChatStream(history, message, null, thinkingLevel, authContext.planType);
    await incrementUsage(authContext);

    await historyManager.addMessage(sessionId, 'user', message, null, authContext.user?.id || null, thinkingLevel);

    let fullAssistantResponse = '';
    for await (const chunk of stream) {
      if (chunk.text) fullAssistantResponse += chunk.text;
    }

    await historyManager.addMessage(sessionId, 'model', fullAssistantResponse, null, authContext.user?.id || null, thinkingLevel);
    res.json({ text: fullAssistantResponse });
  } catch (error) {
    logger.error('Chat error', error);
    const normalized = getChatErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
});

router.post('/admin/login', async (req, res) => {
  const username = (req.body.username || '').toString().trim();
  const password = (req.body.password || '').toString();
  if (!checkAdminCredentials(username, password)) {
    return res.status(401).json({ error: 'Invalid admin credentials.' });
  }
  const token = createSessionToken();
  res.setHeader('Set-Cookie', buildCookie(token));
  return res.json({ message: 'Admin login successful.' });
});

router.post('/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', buildExpiredCookie());
  res.json({ message: 'Logged out.' });
});

router.get('/admin/me', requireAdmin, (req, res) => {
  res.json({ authenticated: true });
});

router.get('/admin/clients', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) throw Object.assign(new Error('Supabase is not configured on the server.'), { status: 500 });

    const { data: authUsersData, error: authUsersError } = await supabase.auth.admin.listUsers({
      page: 1,
      perPage: 1000
    });
    if (authUsersError) throw authUsersError;

    const users = authUsersData?.users || [];
    if (users.length > 0) {
      const upsertPayload = users.map((user) => ({
        id: user.id,
        email: user.email || '',
        full_name: user.user_metadata?.full_name || ''
      }));
      const { error: upsertError } = await supabase
        .from('profiles')
        .upsert(upsertPayload, { onConflict: 'id' });
      if (upsertError) throw upsertError;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, full_name, is_admin, plan, plan_status, plan_expires_at, created_at, updated_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ clients: data || [] });
  } catch (error) {
    const normalized = getChatErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
});

router.delete('/admin/clients/:userId', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) throw Object.assign(new Error('Supabase is not configured on the server.'), { status: 500 });

    const userId = req.params.userId;
    const { error } = await supabase.auth.admin.deleteUser(userId);
    if (error) throw error;
    res.json({ message: 'Account deleted successfully.' });
  } catch (error) {
    const normalized = getChatErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
});

router.patch('/admin/clients/:userId/plan', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) throw Object.assign(new Error('Supabase is not configured on the server.'), { status: 500 });

    const plan = ['free', 'daily', 'monthly', 'yearly'].includes(req.body.plan) ? req.body.plan : 'free';
    const planStatus = req.body.planStatus === 'active' ? 'active' : 'inactive';
    const planExpiresAt = req.body.planExpiresAt || null;

    const { data, error } = await supabase
      .from('profiles')
      .update({
        plan,
        plan_status: planStatus,
        plan_expires_at: planExpiresAt
      })
      .eq('id', req.params.userId)
      .select('*')
      .single();

    if (error) throw error;
    res.json({ profile: data });
  } catch (error) {
    const normalized = getChatErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
});

router.get('/admin/subscription-requests', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) throw Object.assign(new Error('Supabase is not configured on the server.'), { status: 500 });

    const { data, error } = await supabase
      .from('subscription_requests')
      .select('id, user_id, plan, amount_php, gcash_number, gcash_name, reference_note, status, created_at, reviewed_at')
      .order('created_at', { ascending: false });

    if (error) throw error;
    res.json({ requests: data || [] });
  } catch (error) {
    const normalized = getChatErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
});

router.patch('/admin/subscription-requests/:id', requireAdmin, async (req, res) => {
  try {
    const supabase = getSupabaseServiceClient();
    if (!supabase) throw Object.assign(new Error('Supabase is not configured on the server.'), { status: 500 });

    const status = req.body.status === 'approved' ? 'approved' : 'rejected';
    const requestId = req.params.id;

    const { data: requestRow, error: requestError } = await supabase
      .from('subscription_requests')
      .select('*')
      .eq('id', requestId)
      .single();
    if (requestError) throw requestError;

    const reviewedAt = new Date().toISOString();
    const { error: updateRequestError } = await supabase
      .from('subscription_requests')
      .update({ status, reviewed_at: reviewedAt })
      .eq('id', requestId);
    if (updateRequestError) throw updateRequestError;

    if (status === 'approved') {
      let planExpiresAt = null;
      if (requestRow.plan === 'daily') {
        planExpiresAt = new Date(Date.now() + (24 * 60 * 60 * 1000)).toISOString();
      } else if (requestRow.plan === 'monthly') {
        planExpiresAt = new Date(Date.now() + (30 * 24 * 60 * 60 * 1000)).toISOString();
      } else if (requestRow.plan === 'yearly') {
        planExpiresAt = new Date(Date.now() + (365 * 24 * 60 * 60 * 1000)).toISOString();
      }

      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          plan: requestRow.plan,
          plan_status: 'active',
          plan_expires_at: planExpiresAt
        })
        .eq('id', requestRow.user_id);
      if (profileError) throw profileError;
    }

    res.json({ message: `Subscription request ${status}.` });
  } catch (error) {
    const normalized = getChatErrorResponse(error);
    res.status(normalized.status).json(normalized.body);
  }
});

module.exports = router;
