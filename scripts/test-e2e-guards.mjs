import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assertTestEnvironment, isTestRequest, testEndpoints } from './lib/test-target.mjs';
import { runNode } from './lib/async-command.mjs';

test('la espera de un subproceso deja avanzar temporizadores y mantenimiento HTTP', async () => {
  let timerRan = false;
  const timer = setTimeout(() => { timerRan = true; }, 5);
  try {
    const result = await runNode(['-e', 'setTimeout(() => {}, 100)'], { capture: true });
    assert.equal(result.status, 0);
    assert.equal(timerRan, true);
  } finally { clearTimeout(timer); }
});

test('TEST funciona sin dotenv ni overrides', () => {
  assert.doesNotThrow(() => assertTestEnvironment({}));
  assert.doesNotThrow(() => assertTestEnvironment(testEndpoints));
});
for (const name of Object.keys(testEndpoints)) test(`${name}: rechaza producción antes de usar credenciales`, () => {
  assert.throws(() => assertTestEnvironment({ [name]: 'https://production.invalid' }), /TEST/);
});
test('rechaza PostgreSQL DEV y hospedado sin exponer contraseña', () => {
  for (const value of ['postgres://user:do-not-print@127.0.0.1:44122/postgres', 'postgres://user:do-not-print@host.invalid:5432/postgres']) {
    assert.throws(() => assertTestEnvironment({ DATABASE_URL: value }), error => /TEST55422/.test(error.message) && !error.message.includes('do-not-print'));
  }
});
test('red solo permite destinos exactos; rechaza subdominio, credenciales, puerto DEV y producción', () => {
  for (const url of ['http://127.0.0.1:55421/auth/v1/otp', 'http://127.0.0.1:5198/', 'http://127.0.0.1:55424/api/v1/messages']) assert.equal(isTestRequest(url), true);
  for (const url of ['https://production.invalid', 'http://127.0.0.1:44121', 'http://127.0.0.1.evil.invalid:55421', 'http://user@127.0.0.1:55421', 'https://fonts.googleapis.com']) assert.equal(isTestRequest(url), false);
});
test('el argumento antiguo --mode test falla explícitamente antes del preflight DEV', () => {
  const result = spawnSync(process.execPath, ['scripts/start-local-safe.mjs', '--mode', 'test'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--test/);
  assert.doesNotMatch(result.stderr, /Supabase DEV no está disponible/);
});
