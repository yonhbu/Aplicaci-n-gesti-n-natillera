import { config } from 'dotenv';

export function loadLocalEnv() {
  const mode = process.env.SUPABASE_ENV === 'test' ? 'test' : 'dev';
  if (mode === 'test') {
    config({ path: '.env.test.local', override: true, quiet: true });
    return;
  }
  config({ path: '.env.local', override: false, quiet: true });
}
