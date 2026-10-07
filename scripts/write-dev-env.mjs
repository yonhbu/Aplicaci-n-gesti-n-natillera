import { existsSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

if (existsSync('.env.local') && !process.argv.includes('--force')) {
  console.error('.env.local ya existe. No se sobrescribe. Usa --force solo si quieres reemplazarlo.');
  process.exit(1);
}

const result =
  process.platform === 'win32'
    ? spawnSync('npx supabase status -o env', { encoding: 'utf8', shell: true, env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' } })
    : spawnSync('npx', ['supabase', 'status', '-o', 'env'], { encoding: 'utf8', env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' } });

if (result.status !== 0) {
  console.error(result.stderr || 'No se pudo leer supabase status. Arranca DEV con npm run dev:infra:start.');
  process.exit(result.status ?? 1);
}

const values = Object.fromEntries(
  result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line.includes('='))
    .map((line) => {
      const [key, ...rest] = line.split('=');
      return [key, rest.join('=').replace(/^"|"$/g, '')];
    }),
);

const apiUrl = values.API_URL;
const anonKey = values.ANON_KEY;
const elevatedKeyName = ['SERVICE', 'ROLE', 'KEY'].join('_');
const elevatedKey = values[elevatedKeyName];

if (apiUrl !== 'http://127.0.0.1:44121') {
  console.error(`DEV esperado en http://127.0.0.1:44121, pero supabase status reporto ${apiUrl || 'sin API_URL'}.`);
  process.exit(1);
}

if (!anonKey || !elevatedKey) {
  console.error('No se pudieron leer llaves local DEV desde supabase status.');
  process.exit(1);
}

const content = [
  '# Generado localmente por scripts/write-dev-env.mjs. No versionar.',
  `VITE_SUPABASE_URL=${apiUrl}`,
  `VITE_SUPABASE_PUBLISHABLE_KEY=${anonKey}`,
  `SUPABASE_URL=${apiUrl}`,
  `SUPABASE_SECRET_KEY=${elevatedKey}`,
  'NATILLERA_WORKSPACE_NAME=Natillera local',
  'NATILLERA_CYCLE_NAME=Natillera 2026',
  'NATILLERA_CYCLE_YEAR=2026',
  'NATILLERA_CYCLE_START=2026-01-01',
  'NATILLERA_CYCLE_CLOSE=2026-12-15',
  'NATILLERA_ADMIN_EMAILS=admin@example.test',
  'E2E_MAILPIT_URL=http://127.0.0.1:44124',
  ''
].join('\n');

writeFileSync('.env.local', content);
console.log('.env.local escrito para DEV local sin imprimir llaves.');
