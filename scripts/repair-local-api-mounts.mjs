// Repair only a stopped local gateway after moving the repository. Never resets a database.
// Container configuration stays in memory; credentials are never printed or written.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';

const mode = process.argv[2];
if (!['--dev', '--test'].includes(mode)) throw Error('Use --dev o --test.');
const test = mode === '--test';
const runtimeSource = process.argv[3];
const name = 'supabase_kong_natillera-manager' + (test ? '-test' : '');
const db = 'supabase_db_natillera-manager' + (test ? '-test' : '');
const run = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
const binding = JSON.parse(run(['inspect', '--format', '{{json .HostConfig.PortBindings}}', db]));
if (!binding['5432/tcp']?.some(item => item.HostPort === (test ? '55422' : '44122'))) throw Error('Destino local incompatible.');
const old = JSON.parse(run(['inspect', name]))[0];
if (!runtimeSource && old.State.Running) { console.log('API ya activa; no se modifica.'); process.exit(0); }
if (!runtimeSource && old.State.Status !== 'exited') throw Error('Se requiere gateway detenido; no se modifica el entorno.');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, test ? '.supabase-test/supabase/templates/magic_link.html' : 'supabase/templates/magic_link.html');
if (!existsSync(source) || !statSync(source).isFile()) throw Error('Falta la plantilla local de acceso.');
const mount = old.Mounts.find(item => item.Type === 'bind' && item.Destination === '/home/kong/templates/email/magic_link.html');
if (!mount || old.Mounts.some(item => item.Type === 'volume')) throw Error('Montajes inesperados; no se modifica el gateway.');
const endpoint = run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']).trim();
if (!endpoint.startsWith('npipe:')) throw Error('Este reparador requiere Docker Desktop local.');
const socketPath = endpoint.replace(/^npipe:\/\//, '').replaceAll('/', '\\');
function request(method, url, body) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body);
    const req = http.request({ socketPath, path: url, method, headers: encoded ? { 'Content-Type': Buffer.isBuffer(body) ? 'application/x-tar' : 'application/json', 'Content-Length': Buffer.byteLength(encoded) } : {} }, response => {
      let data = ''; response.on('data', chunk => data += chunk);
      response.on('end', () => response.statusCode < 300 || response.statusCode === 304 ? resolve(data ? JSON.parse(data) : null) : reject(Error('Docker API devolvió HTTP ' + response.statusCode)));
    });
    req.on('error', () => reject(Error('No se pudo contactar Docker Desktop.')));
    req.setTimeout(30000, () => req.destroy()); req.end(encoded);
  });
}
async function copyRuntime(sourceName, destinationId) {
  // Supabase injects these files into the container layer during initial creation.
  // Copy archives directly in memory: no keys/configuration are written to the host.
  // docker cp cannot mount the old, broken file bind. Export reads its original layer.
  const wanted = new Set(['custom_nginx.template', 'kong.yml', 'localhost.crt', 'localhost.key'].map(file => 'home/kong/' + file));
  const child = spawn('docker', ['export', sourceName], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const completed = new Promise((resolve, reject) => { child.on('close', code => code === 0 ? resolve() : reject(Error('No se pudo leer la configuración anterior.'))); child.on('error', reject); });
  child.stderr.resume();
  let pending = Buffer.alloc(0), remaining = 0, selected = null;
  const recovered = new Map();
  for await (const chunk of child.stdout) {
    pending = Buffer.concat([pending, chunk]);
    while (pending.length) {
      if (!remaining) {
        if (pending.length < 512) break;
        const header = Buffer.from(pending.subarray(0, 512)); pending = pending.subarray(512);
        const name = header.subarray(0, 100).toString().replace(/\0.*$/, '').replace(/^\.\//, '');
        const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim() || '0', 8);
        if (!Number.isFinite(size) || size < 0) throw Error('Archivo interno no reconocido.');
        remaining = Math.ceil(size / 512) * 512;
        selected = wanted.has(name) ? { name, chunks: [header] } : null;
        if (!remaining && selected) { recovered.set(name, Buffer.concat(selected.chunks)); selected = null; }
      } else {
        const consumed = Math.min(remaining, pending.length);
        if (selected) selected.chunks.push(Buffer.from(pending.subarray(0, consumed)));
        remaining -= consumed; pending = pending.subarray(consumed);
        if (!remaining && selected) { recovered.set(selected.name, Buffer.concat(selected.chunks)); selected = null; }
      }
    }
  }
  await completed;
  if (recovered.size !== wanted.size) throw Error('La configuración anterior está incompleta.');
  const archive = Buffer.concat([...recovered.values(), Buffer.alloc(1024)]);
  await request('PUT', '/containers/' + destinationId + '/archive?path=/', archive);
}
if (runtimeSource) {
  if (!runtimeSource.startsWith(name + '_previous_mount_')) throw Error('Origen de recuperación incompatible.');
  const sourceState = JSON.parse(run(['inspect', runtimeSource]))[0];
  if (sourceState.State.Status !== 'exited') throw Error('El origen debe estar detenido.');
  await request('POST', '/containers/' + old.Id + '/stop?t=10');
  await copyRuntime(runtimeSource, old.Id);
  await request('POST', '/containers/' + old.Id + '/start');
  console.log(JSON.stringify({ target: test ? 'TEST55421' : 'DEV44121', gatewayRuntimeRestored: true, databaseModified: false }));
  process.exit(0);
}
const host = { ...old.HostConfig, Binds: old.HostConfig.Binds.map(bind => bind.replace(mount.Source, source)) };
const networks = Object.fromEntries(Object.entries(old.NetworkSettings.Networks).map(([network, config]) => [network, { Aliases: config.Aliases?.filter(alias => alias !== old.Id.slice(0, 12) && alias !== old.Id) }]));
const config = { ...old.Config, HostConfig: host, NetworkingConfig: { EndpointsConfig: networks } };
delete config.Hostname;
const retained = name + '_previous_mount_' + Date.now();
await request('POST', '/containers/' + old.Id + '/rename?name=' + retained);
await request('POST', '/containers/' + old.Id + '/update', { RestartPolicy: { Name: 'no' } });
let created;
try {
  created = await request('POST', '/containers/create?name=' + name, config);
  await copyRuntime(retained, created.Id);
  await request('POST', '/containers/' + created.Id + '/start');
  console.log(JSON.stringify({ target: test ? 'TEST55421' : 'DEV44121', gatewayStarted: true, templateFromCurrentRepository: true, databaseModified: false, previousStoppedGateway: retained }));
} catch {
  if (created) await request('DELETE', '/containers/' + created.Id + '?force=true&v=false').catch(() => {});
  await request('POST', '/containers/' + old.Id + '/rename?name=' + name).catch(() => {});
  throw Error('No se pudo reparar el gateway; se conservó el contenedor anterior.');
}
