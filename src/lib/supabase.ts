import { createClient } from '@supabase/supabase-js';
import { readAppEnv } from './env';

const env = readAppEnv();

export const supabase = createClient(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
});
