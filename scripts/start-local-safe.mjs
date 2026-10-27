// Resolve the running local stack without opening dotenv files or persisting keys.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServer } from 'vite';
import { assertTestEnvironment } from './lib/test-target.mjs';
import { auditRuntime } from './lib/audit-test-runtime.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const test = process.argv.includes('--test');
if (process.argv.slice(2).some(argument => argument !== '--test') || (!test && process.env.SUPABASE_ENV === 'test')) {
  console.error('Argumentos incompatibles: usa --test para seleccionar TEST; --mode no selecciona infraestructura.');
  process.exit(1);
}
if (test) assertTestEnvironment();
const api = `http://127.0.0.1:${test ? 55421 : 44121}`;
let server;
try {
  const status = test ? auditRuntime() : JSON.parse(execFileSync(process.execPath, [
    path.join(root, 'node_modules/supabase/dist/supabase.js'),
    'status', '--workdir', test ? path.join(root, '.supabase-test') : root, '-o', 'json'
  ], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }));
  const publicKey = status.PUBLISHABLE_KEY ?? status.ANON_KEY;
  if (status.API_URL !== api || !publicKey) throw Error('El destino local no corresponde al entorno solicitado.');
  process.env.VITE_SUPABASE_URL = api;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = publicKey;
  if (test) for (const name of Object.keys(process.env)) {
    if (name.startsWith('VITE_') && !['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].includes(name)) delete process.env[name];
  }
  server = await createServer({
    root, envDir: false, mode: test ? 'test' : 'development',
    server: { host: '127.0.0.1', port: test ? 5198 : 5176, strictPort: true }
  });
  await server.listen();
  console.log(`Natillera ${test ? 'TEST' : 'DEV'} · Supabase ${api}`);
  server.printUrls();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
} catch (error) {
  await server?.close();
  // CLI subprocess errors may embed credentials; report only deliberate messages.
  console.error(error?.status !== undefined || error?.code === 'ENOENT'
    ? `Supabase ${test ? 'TEST' : 'DEV'} no está disponible. Inicia primero su infraestructura local.`
    : error.message);
  process.exitCode = 1;
}
