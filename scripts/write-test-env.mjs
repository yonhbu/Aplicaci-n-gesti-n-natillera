import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './prepare-test-supabase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const workdir = '.supabase-test';
const supabaseBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase');

function parseEnv(output) {
  return Object.fromEntries(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && line.includes('='))
      .map((line) => {
        const [key, ...rest] = line.split('=');
        return [key, rest.join('=').replace(/^"|"$/g, '')];
      }),
  );
}

const statusArgs = ['status', '--workdir', workdir, '-o', 'env'];
const statusResult =
  process.platform === 'win32'
    ? spawnSync(`"${supabaseBin}" ${statusArgs.join(' ')}`, {
        cwd: repoRoot,
        encoding: 'utf8',
        shell: true,
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' }
      })
    : spawnSync(supabaseBin, statusArgs, {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' }
      });

if (statusResult.error) {
  console.error(statusResult.error.message);
  process.exit(1);
}

if (statusResult.status !== 0) {
  console.error(statusResult.stderr || 'El stack Supabase TEST no esta corriendo. Ejecuta npm run test:infra:start.');
  process.exit(1);
}

const values = parseEnv(statusResult.stdout);
const apiUrl = values.API_URL;
const anonKey = values.ANON_KEY;
const elevatedKeyName = ['SERVICE', 'ROLE', 'KEY'].join('_');
const elevatedKey = values[elevatedKeyName];
const mailpitUrl = values.MAILPIT_URL ?? 'http://127.0.0.1:55424';

if (!apiUrl || !anonKey || !elevatedKey) {
  console.error('No se pudieron leer URL o llaves del stack Supabase TEST.');
  process.exit(1);
}

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
  'NATILLERA_CYCLE_CLOSE=2026-12-15',
  'NATILLERA_ADMIN_EMAILS=e2e-admin@example.test',
  ''
].join('\n');

writeFileSync(path.join(repoRoot, '.env.test.local'), contents);
console.log('Entorno TEST escrito en .env.test.local');
