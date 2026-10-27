// Explicit compatibility command only. CI and E2E never read this generated file.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditRuntime } from './lib/audit-test-runtime.mjs';
const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const runtime = auditRuntime();
const apiUrl = runtime.API_URL;
const anonKey = runtime.PUBLISHABLE_KEY ?? runtime.ANON_KEY;
const elevatedKey = runtime.SECRET_KEY;
const mailpitUrl = 'http://127.0.0.1:55424';
const contents = [
  '# Generado por scripts/write-test-env.mjs. No versionar.',
  'SUPABASE_ENV=test',
  `VITE_SUPABASE_URL=${apiUrl}`,
  `VITE_SUPABASE_PUBLISHABLE_KEY=${anonKey}`,
  `SUPABASE_URL=${apiUrl}`,
  `SUPABASE_SECRET_KEY=${elevatedKey}`,
  `E2E_MAILPIT_URL=${mailpitUrl}`,
  'NATILLERA_WORKSPACE_NAME=Natillera E2E sintetica',
  'NATILLERA_CYCLE_NAME=Natillera 2026',
  'NATILLERA_CYCLE_YEAR=2026',
  'NATILLERA_CYCLE_START=2026-01-01',
  'NATILLERA_CYCLE_CLOSE=2026-12-05',
  'NATILLERA_ADMIN_EMAILS=e2e-admin@example.test',
  ''
].join('\n');

writeFileSync(path.join(repoRoot, '.env.test.local'), contents, { mode: 0o600 });
console.log('Entorno TEST escrito en .env.test.local');
