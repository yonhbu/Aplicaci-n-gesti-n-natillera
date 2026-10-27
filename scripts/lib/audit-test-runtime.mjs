import { execFileSync } from 'node:child_process';
import { assertTestEnvironment } from './test-target.mjs';

export const auditApi = 'http://127.0.0.1:55421';
export const auditApp = 'http://127.0.0.1:5198';
export const auditContainer = 'supabase_db_natillera-manager-test';

// No dotenv. Credentials stay in memory and are never returned in diagnostics.
export function auditRuntime() {
  assertTestEnvironment();
  let runtime;
  try {
    runtime = JSON.parse(execFileSync(process.execPath, ['node_modules/supabase/dist/supabase.js',
      'status', '--workdir', '.supabase-test', '-o', 'json'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
    const ports = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .HostConfig.PortBindings}}', auditContainer],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
    if (runtime.API_URL !== auditApi || !ports['5432/tcp']?.some(p => p.HostPort === '55422')) throw Error();
    if (!runtime.SECRET_KEY || !(runtime.PUBLISHABLE_KEY ?? runtime.ANON_KEY)) throw Error();
    // A localhost API alone is insufficient: both PostgREST and Auth must use TEST's database.
    for (const [container, key] of [
      ['supabase_rest_natillera-manager-test', 'PGRST_DB_URI'],
      ['supabase_auth_natillera-manager-test', 'GOTRUE_DB_DATABASE_URL']
    ]) {
      const env = JSON.parse(execFileSync('docker', ['inspect', '--format', '{{json .Config.Env}}', container],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
      const setting = env.find(value => value.startsWith(`${key}=`));
      if (!setting || new URL(setting.slice(key.length + 1)).hostname !== auditContainer) throw Error();
    }
  } catch {
    throw Error('Auditoría detenida: no se pudo verificar API/Auth/REST TEST55421 y PostgreSQL TEST55422.');
  }
  return runtime;
}

export function auditSql(input) {
  auditRuntime();
  try {
    return execFileSync('docker', ['exec', '-i', auditContainer, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1'],
      { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, maxBuffer: 5e6 }).trim();
  } catch (error) {
    // SQL fixtures contain synthetic data only; omit subprocess stdout and runtime keys.
    throw Error(`Falló SQL de auditoría: ${String(error.stderr ?? '').slice(0, 3000)}`);
  }
}
