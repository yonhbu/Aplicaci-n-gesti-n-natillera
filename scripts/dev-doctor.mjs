import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const checks = [];

function run(label, command, args = []) {
  const result =
    process.platform === 'win32'
      ? spawnSync([command, ...args].join(' '), { encoding: 'utf8', shell: true })
      : spawnSync(command, args, { encoding: 'utf8' });

  checks.push({
    label,
    ok: result.status === 0,
    status: result.status,
    output: (result.stdout || result.stderr || '').split(/\r?\n/)[0] ?? ''
  });
}

run('Node.js', 'node', ['--version']);
run('npm', 'npm', ['--version']);
run('Supabase CLI', 'npx', ['supabase', '--version']);
run('Docker daemon', 'docker', ['version', '--format', '"{{.Server.Version}}"']);

checks.push({ label: 'package.json', ok: existsSync('package.json'), status: existsSync('package.json') ? 0 : 1, output: '' });
checks.push({ label: 'supabase/config.toml', ok: existsSync('supabase/config.toml'), status: existsSync('supabase/config.toml') ? 0 : 1, output: '' });
checks.push({ label: '.env.local', ok: existsSync('.env.local'), status: existsSync('.env.local') ? 0 : 1, output: existsSync('.env.local') ? 'existe' : 'faltante' });

for (const check of checks) {
  console.log(`${check.ok ? 'OK' : 'FALLO'} ${check.label}${check.output ? `: ${check.output}` : ''}`);
}

if (checks.some((check) => !check.ok && check.label !== '.env.local')) {
  process.exit(1);
}
