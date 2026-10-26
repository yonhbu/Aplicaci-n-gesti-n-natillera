// Use the TEST container's Unix socket; never route financial tests through DEV.
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
try {
  const runtime = JSON.parse(execFileSync(process.execPath, [path.join(root, 'node_modules/supabase/dist/supabase.js'), 'status', '--workdir', path.join(root, '.supabase-test'), '-o', 'json'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
  if (runtime.API_URL !== 'http://127.0.0.1:55421') throw Error('Las pruebas SQL requieren exclusivamente TEST55421.');
  const container = 'supabase_db_natillera-manager-test';
  const binding = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}', container], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
  if (!binding['5432/tcp']?.some(port => port.HostPort === '55422')) throw Error('La base TEST no corresponde al puerto 55422.');
  const folder = path.join(root, 'supabase/tests/database');
  const files = readdirSync(folder).filter(file => file.endsWith('.sql')).sort();
  if (!files.length) throw Error('No se encontraron pruebas SQL.');
  let failed = 0, total = 0;
  for (const file of files) {
    const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'], { input: readFileSync(path.join(folder, file), 'utf8'), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const lines = String(result.stdout ?? '').split(/\r?\n/);
    const assertions = lines.filter(line => /^(?:not )?ok \d+/.test(line));
    const failures = assertions.filter(line => /^not ok/.test(line));
    const plans = lines.filter(line => /^1\.\.\d+$/.test(line));
    const pass = !result.error && result.status === 0 && failures.length === 0 && plans.length === 1 && Number(plans[0].slice(3)) === assertions.length;
    total += assertions.length;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${file}: ${assertions.length} aserciones`);
    if (!pass) {
      failed++;
      const detail = [...failures, ...lines.filter(line => /^#/.test(line)), String(result.stderr ?? '')].join('\n')
        .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:secret|publishable)_[\w-]+/g, '[redacted]');
      console.error(detail || 'Error de ejecución o plan TAP incompleto.');
    }
  }
  console.log(`TEST: ${files.length - failed}/${files.length} archivos; ${total} aserciones.`);
  process.exitCode = failed ? 1 : 0;
} catch (error) {
  console.error(error?.status !== undefined ? 'No se pudo comprobar la infraestructura TEST; salida del subproceso omitida.' : error.message);
  process.exitCode = 1;
}
