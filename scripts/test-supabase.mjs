import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './prepare-test-supabase.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const workdir = '.supabase-test';
const supabaseBin = path.join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'supabase.cmd' : 'supabase');

const commands = {
  start: ['start', '--workdir', workdir],
  reset: ['db', 'reset', '--workdir', workdir],
  rls: ['test', 'db', '--workdir', workdir],
  stop: ['stop', '--workdir', workdir]
};

const mode = process.argv[2];
if (!commands[mode]) {
  console.error(`Uso: node scripts/test-supabase.mjs ${Object.keys(commands).join('|')}`);
  process.exit(1);
}

const result =
  process.platform === 'win32'
    ? spawnSync(`"${supabaseBin}" ${commands[mode].join(' ')}`, {
        cwd: repoRoot,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' }
      })
    : spawnSync(supabaseBin, commands[mode], {
        cwd: repoRoot,
        stdio: 'inherit',
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' }
      });

if (result.error) {
  console.error(result.error.message);
}

process.exit(result.status ?? 1);
