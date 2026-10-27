import { runNode } from './lib/async-command.mjs';
import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { auditRuntime } from './lib/audit-test-runtime.mjs';
import { assertTestEnvironment, testEndpoints } from './lib/test-target.mjs';

assertTestEnvironment();
Object.assign(process.env, testEndpoints);
const runtime = auditRuntime();
process.env.SUPABASE_SECRET_KEY = runtime.SECRET_KEY;

mkdirSync('incoming/ci-database', { recursive: true });

// Verify HTTP availability as well as Docker topology; never print response bodies/keys.
for (const url of [testEndpoints.SUPABASE_URL + '/auth/v1/health', testEndpoints.SUPABASE_URL + '/rest/v1/', testEndpoints.E2E_MAILPIT_URL + '/api/v1/messages']) {
  const response = await fetch(url, { headers: { apikey: runtime.PUBLISHABLE_KEY ?? runtime.ANON_KEY }, redirect: 'error', signal: AbortSignal.timeout(10_000) });
  await response.body?.cancel();
  if (!response.ok) throw Error(`TEST no disponible: ${new URL(url).pathname} (${response.status}).`);
}
console.log('Preflight PASS: Auth/API TEST55421, correo TEST55424 y PostgreSQL TEST55422; sin dotenv.');

async function prepareFixtures() {
await (await import('./bootstrap-test.mjs')).default();
await (await import('./seed-functional-audit.mjs')).default();
await (await import('./seed-functional-close.mjs')).default();
for (const file of ['seed-ux13-test.mjs', 'seed-ux16-test.mjs', 'seed-ui-boundaries-test.mjs', 'seed-audit-extended.mjs']) {
  auditRuntime();
  const result = await runNode(['scripts/' + file], { capture: true });
  if (result.status !== 0) throw Error(`Falló preparación sintética ${file}; salida omitida para proteger credenciales.`);
  console.log(`PASS: ${file} exclusivamente en TEST.`);
}
// UX13 reuses the fin-recon seed internally; prepare independent financial fixtures last.

await (await import('./seed-regression-test.mjs')).default();
await (await import('./seed-e2e-invariants.mjs')).default();
process.env.E2E_SQL_BASELINE = 'incoming/ci-database/ux-invariants.json';
}

const args = process.argv.slice(2);
const singleInvocation = args.some(arg => arg === '--list' || arg.startsWith('--project') || arg.startsWith('--config'));
const projects = singleInvocation ? [null] : ['chromium', 'mobile'];
let failed = false; const reports = [], preparationErrors = [];
if (!singleInvocation && existsSync('incoming/ci-database/results.json')) unlinkSync('incoming/ci-database/results.json');
for (const project of projects) {
  if (project) process.env.E2E_PROJECT = project;
  const report = project ? 'incoming/ci-database/' + project + '-results.json' : 'incoming/ci-database/results.json';
  if (existsSync(report)) unlinkSync(report);
  try { await prepareFixtures(); }
  catch (error) {
    failed = true;
    const message = String(error.message ?? 'Falló preparación TEST.').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:secret|publishable)_[\w-]+/g, '[redacted]');
    preparationErrors.push({ message: `${project ?? 'selección'}: ${message}` });
    console.error(message);
    continue;
  }
  const result = await runNode(['node_modules/@playwright/test/cli.js', 'test', ...args, ...(project ? ['--project',project] : [])]);
  if (result.status !== 0) failed = true;
  if (existsSync(report) && !args.includes('--list')) reports.push(JSON.parse(readFileSync(report,'utf8')));
}
if (!singleInvocation) {
  const combined = { suites: reports.flatMap(report=>report.suites), errors: [...preparationErrors, ...reports.flatMap(report=>report.errors ?? [])], stats: { expected:0, unexpected:0, skipped:0, flaky:0, duration:0 } };
  for (const report of reports) for (const key of Object.keys(combined.stats)) combined.stats[key] += report.stats[key] ?? 0;
  if (reports.length !== projects.length) combined.errors.push({ message:'Faltó un informe de proyecto; no se considera ejecución completa.' });
  writeFileSync('incoming/ci-database/results.json',JSON.stringify(combined,null,2));
  if (reports.length !== projects.length || combined.stats.skipped || combined.stats.unexpected) failed = true;
}
process.exitCode = failed ? 1 : 0;
