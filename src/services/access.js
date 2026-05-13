const { getSupabaseServiceClient } = require('./supabase');
const logger = require('../utils/logger');

const PLAN_LIMITS = {
  guest: { maxMessagesPerDay: Number.POSITIVE_INFINITY, allowedThinking: ['low', 'image-generate'] },
  free: { maxMessagesPerDay: Number.POSITIVE_INFINITY, allowedThinking: ['low', 'humanlike', 'image-generate'] },
  daily: { maxMessagesPerDay: Number.POSITIVE_INFINITY, allowedThinking: ['low', 'medium', 'high', 'ultra', 'god', 'humanlike', 'image-generate'] },
  monthly: { maxMessagesPerDay: Number.POSITIVE_INFINITY, allowedThinking: ['low', 'medium', 'high', 'ultra', 'god', 'humanlike', 'image-generate'] },
  yearly: { maxMessagesPerDay: Number.POSITIVE_INFINITY, allowedThinking: ['low', 'medium', 'high', 'ultra', 'god', 'humanlike', 'image-generate'] }
};

const inMemoryUsage = new Map();

const createError = (message, status) => {
  const err = new Error(message);
  err.status = status;
  return err;
};

const getBearerToken = (req) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.slice('Bearer '.length).trim();
};

const resolvePlanType = (profile) => {
  if (!profile) return 'free';
  if (profile.plan === 'free') return 'free';
  if (profile.plan_status !== 'active') return 'free';
  if (profile.plan_expires_at && new Date(profile.plan_expires_at).getTime() < Date.now()) return 'free';
  return profile.plan;
};

const ensureProfile = async (supabase, user) => {
  const { data: existing, error: readError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (readError) throw readError;
  if (existing) return existing;

  const payload = {
    id: user.id,
    email: user.email || '',
    full_name: user.user_metadata?.full_name || ''
  };

  const { data: inserted, error: insertError } = await supabase
    .from('profiles')
    .insert(payload)
    .select('*')
    .single();

  if (insertError) throw insertError;
  return inserted;
};

const getAuthContext = async (req, sessionId) => {
  const token = getBearerToken(req);
  const supabase = getSupabaseServiceClient();

  if (!token) {
    if (!sessionId) throw createError('Invalid session ID', 400);
    return {
      isAuthenticated: false,
      user: null,
      profile: null,
      planType: 'guest',
      quota: PLAN_LIMITS.guest,
      subjectType: 'guest',
      subjectId: sessionId
    };
  }

  if (!supabase) {
    throw createError('Authentication service is not configured on the server.', 500);
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw createError('Invalid or expired session. Please log in again.', 401);
  }

  const profile = await ensureProfile(supabase, data.user);
  const planType = resolvePlanType(profile);

  return {
    isAuthenticated: true,
    user: data.user,
    profile,
    planType,
    quota: PLAN_LIMITS[planType] || PLAN_LIMITS.free,
    subjectType: 'user',
    subjectId: data.user.id
  };
};

const assertThinkingAllowed = (authContext, thinkingLevel) => {
  const allowed = authContext.quota.allowedThinking;
  if (!allowed.includes(thinkingLevel)) {
    if (!authContext.isAuthenticated) {
      throw createError('Please register to unlock this thinking mode.', 403);
    }
    throw createError('This thinking mode requires an active subscription.', 402);
  }
};

const getTodayKey = () => new Date().toISOString().slice(0, 10);

const getUsageCount = async (authContext) => {
  const max = authContext.quota.maxMessagesPerDay;
  if (!Number.isFinite(max)) return 0;

  const supabase = getSupabaseServiceClient();
  const today = getTodayKey();
  const memoryKey = `${authContext.subjectType}:${authContext.subjectId}:${today}`;

  if (!supabase) {
    return inMemoryUsage.get(memoryKey) || 0;
  }

  const { data, error } = await supabase
    .from('usage_counters')
    .select('generation_count')
    .eq('subject_type', authContext.subjectType)
    .eq('subject_id', authContext.subjectId)
    .eq('usage_day', today)
    .maybeSingle();

  if (error) {
    logger.warn('Failed to read usage_counters from Supabase. Falling back to in-memory usage.', { error: error.message });
    return inMemoryUsage.get(memoryKey) || 0;
  }
  return data?.generation_count || 0;
};

const incrementUsage = async (authContext) => {
  const max = authContext.quota.maxMessagesPerDay;
  if (!Number.isFinite(max)) return;

  const supabase = getSupabaseServiceClient();
  const today = getTodayKey();
  const memoryKey = `${authContext.subjectType}:${authContext.subjectId}:${today}`;

  if (!supabase) {
    const current = inMemoryUsage.get(memoryKey) || 0;
    inMemoryUsage.set(memoryKey, current + 1);
    return;
  }

  const current = await getUsageCount(authContext);
  const payload = {
    subject_type: authContext.subjectType,
    subject_id: authContext.subjectId,
    usage_day: today,
    generation_count: current + 1
  };

  const { error } = await supabase
    .from('usage_counters')
    .upsert(payload, { onConflict: 'subject_type,subject_id,usage_day' });

  if (error) {
    logger.warn('Failed to upsert usage_counters in Supabase. Falling back to in-memory usage.', { error: error.message });
    const fallbackCurrent = inMemoryUsage.get(memoryKey) || 0;
    inMemoryUsage.set(memoryKey, fallbackCurrent + 1);
  }
};

const assertWithinQuota = async (authContext) => {
  const max = authContext.quota.maxMessagesPerDay;
  if (!Number.isFinite(max)) return;

  const current = await getUsageCount(authContext);
  if (current >= max) {
    if (!authContext.isAuthenticated) {
      throw createError('Guest limit reached (5 generations). Register to continue.', 429);
    }
    throw createError('Daily message limit reached for your plan.', 429);
  }
};

module.exports = {
  PLAN_LIMITS,
  getAuthContext,
  assertThinkingAllowed,
  assertWithinQuota,
  incrementUsage
};
