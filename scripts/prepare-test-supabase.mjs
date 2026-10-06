import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const sourceSupabase = path.join(repoRoot, 'supabase');
const testRoot = path.join(repoRoot, '.supabase-test');
const targetSupabase = path.join(testRoot, 'supabase');

const replacements = [
  [/project_id = "natillera-manager"/, 'project_id = "natillera-manager-test"'],
  [/port = 44121/, 'port = 55421'],
  [/port = 44122/, 'port = 55422'],
  [/shadow_port = 44120/, 'shadow_port = 55420'],
  [/port = 44123/, 'port = 55423'],
  [/port = 44124/, 'port = 55424'],
  [/smtp_port = 44125/, 'smtp_port = 55425'],
  [/pop3_port = 44126/, 'pop3_port = 55426']
];

function copyDirectory(name) {
  const source = path.join(sourceSupabase, name);
  const target = path.join(targetSupabase, name);
  rmSync(target, { recursive: true, force: true });
  if (existsSync(source)) {
    cpSync(source, target, { recursive: true });
  }
}

mkdirSync(targetSupabase, { recursive: true });

let config = readFileSync(path.join(sourceSupabase, 'config.toml'), 'utf8');
for (const [pattern, value] of replacements) {
  config = config.replace(pattern, value);
}

writeFileSync(path.join(targetSupabase, 'config.toml'), config);
copyDirectory('migrations');
copyDirectory('tests');
copyDirectory('templates');

const gitkeep = path.join(testRoot, '.gitkeep');
if (!existsSync(gitkeep)) {
  writeFileSync(gitkeep, '');
}

console.log('Entorno Supabase TEST preparado en .supabase-test');
