import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { assertTestEnvironment, isTestRequest, testEndpoints } from './lib/test-target.mjs';
import { runNode } from './lib/async-command.mjs';
import { postgresCredentialLocations } from './lib/source-secret-findings.mjs';

test('el control de fuentes detecta userinfo PostgreSQL y solo informa la ubicación', () => {
  const fixture = new URL('postgresql://test-only.invalid:5432/TEST_ONLY_DATABASE');
  fixture.username = 'TEST_ONLY_NEVER_PROVISIONED_USER';
  fixture.password = 'TEST_ONLY_NOT_A_REAL_PASSWORD';
  const findings = postgresCredentialLocations('\nconst example = ' + JSON.stringify(fixture.href));
  assert.deepEqual(findings, [{ line: 2 }]);
  assert.equal(JSON.stringify(findings).includes(fixture.password), false);
  fixture.username = ''; fixture.password = '';
  assert.deepEqual(postgresCredentialLocations(JSON.stringify(fixture.href)), []);
});

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
// Synthetic markers only: never provisioned, never read from runtime credentials.
// URL construction exercises credential redaction without storing a credential URI.
test('rechaza PostgreSQL DEV y hospedado sin exponer contraseña', () => {
  const syntheticPassword = 'TEST_ONLY_NOT_A_REAL_PASSWORD';
  for (const endpoint of [
    'postgres://127.0.0.1:44122/TEST_ONLY_DATABASE',
    'postgresql://production-postgres.invalid:5432/TEST_ONLY_DATABASE',
    'postgresql://production-postgres.invalid:55422/TEST_ONLY_DATABASE'
  ]) {
    const fixture = new URL(endpoint);
    fixture.username = 'TEST_ONLY_NEVER_PROVISIONED_USER';
    fixture.password = syntheticPassword;
    for (const name of ['DATABASE_URL', 'SUPABASE_DB_URL', 'PGDATABASE_URL']) {
      assert.throws(() => assertTestEnvironment({ [name]: fixture.href }), error =>
        /TEST55422/.test(error.message) && !error.message.includes(syntheticPassword)
        && !error.message.includes(fixture.username) && !error.message.includes(fixture.href));
    }
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
