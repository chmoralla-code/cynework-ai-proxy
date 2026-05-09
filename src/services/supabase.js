const { createClient } = require('@supabase/supabase-js');

let serviceClient = null;

const getSupabaseServiceClient = () => {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  if (!serviceClient) {
    serviceClient = createClient(url, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
  }

  return serviceClient;
};

const getSupabasePublicConfig = () => ({
  url: process.env.SUPABASE_URL || '',
  publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || ''
});

module.exports = {
  getSupabaseServiceClient,
  getSupabasePublicConfig
};
