export const testEndpoints = Object.freeze({
  SUPABASE_URL: 'http://127.0.0.1:55421',
  VITE_SUPABASE_URL: 'http://127.0.0.1:55421',
  PLAYWRIGHT_BASE_URL: 'http://127.0.0.1:5198',
  PLAYWRIGHT_PORT: '5198',
  E2E_MAILPIT_URL: 'http://127.0.0.1:55424',
  SUPABASE_ENV: 'test'
});

// Pure check: reject overrides before credentials, subprocesses or network access.
export function assertTestEnvironment(env = process.env) {
  for (const [name, expected] of Object.entries(testEndpoints)) {
    if (env[name] !== undefined && env[name] !== expected) {
      throw Error(`E2E detenido: ${name} no corresponde al destino TEST permitido.`);
    }
  }
  for (const name of ['DATABASE_URL', 'SUPABASE_DB_URL', 'PGDATABASE_URL']) {
    if (env[name] === undefined) continue;
    let url;
    try { url = new URL(env[name]); } catch { throw Error(`Destino TEST inválido: ${name}.`); }
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname !== '127.0.0.1' || url.port !== '55422') {
      throw Error(`E2E detenido: ${name} no corresponde a PostgreSQL TEST55422.`);
    }
  }
  if ((env.PGHOST !== undefined && env.PGHOST !== '127.0.0.1') || (env.PGPORT !== undefined && env.PGPORT !== '55422')) {
    throw Error('E2E detenido: PGHOST/PGPORT no corresponden a TEST55422.');
  }
}

export function isTestRequest(url, { browser = false } = {}) {
  try {
    const parsed = new URL(url);
    return !parsed.username && !parsed.password && (
      [testEndpoints.SUPABASE_URL, testEndpoints.PLAYWRIGHT_BASE_URL, testEndpoints.E2E_MAILPIT_URL].includes(parsed.origin)
      || (browser && ['https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(parsed.origin))
    );
  } catch { return false; }
}
