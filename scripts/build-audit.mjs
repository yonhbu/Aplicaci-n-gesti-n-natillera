import { build } from 'vite';
import { auditRuntime } from './lib/audit-test-runtime.mjs';

const runtime = auditRuntime();
process.env.VITE_SUPABASE_URL = runtime.API_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = runtime.PUBLISHABLE_KEY ?? runtime.ANON_KEY;
await build({ envDir: false, mode: 'audit' });
