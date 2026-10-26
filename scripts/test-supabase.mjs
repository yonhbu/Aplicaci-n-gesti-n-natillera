import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import './prepare-test-supabase.mjs';

// The CLI TCP test runner can terminate connections on a migrated Windows host.
// Keep pgTAP and its complete plan validation inside the guarded TEST container.
if (process.argv[2] === 'rls') {
  await import('./run-sql-tests-local.mjs');
  process.exit(process.exitCode ?? 0);
}

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
        encoding: 'utf8',
        shell: true,
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' }
      })
    : spawnSync(supabaseBin, commands[mode], {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' }
      });

if (result.error) {
  console.error(result.error.message);
}

if (result.stdout) {
  process.stdout.write(redactSupabaseOutput(result.stdout));
}

if (result.stderr) {
  process.stderr.write(redactSupabaseOutput(result.stderr));
}

process.exit(result.status ?? 1);

function redactSupabaseOutput(output) {
  const elevatedRoleKey = ['SERVICE', 'ROLE'].join('_');
  const keyNamePattern = new RegExp(
    `"((?:PUBLISHABLE|SECRET|JWT_SECRET|ANON|${elevatedRoleKey}|S3_PROTOCOL_ACCESS_KEY_ID|S3_PROTOCOL_ACCESS_KEY_SECRET)_?KEY|SECRET_KEY|JWT_SECRET)"\\s*:\\s*"[^"]+"`,
    'g',
  );
  return output
    .replace(keyNamePattern, '"$1":"[redacted]"')
    .replace(/"(S3_PROTOCOL_ACCESS_KEY_ID|S3_PROTOCOL_ACCESS_KEY_SECRET)"\s*:\s*"[^"]+"/g, '"$1":"[redacted]"')
    .replace(/(sb_(?:publishable|secret)_[A-Za-z0-9_-]+)/g, '[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-jwt]');
}
