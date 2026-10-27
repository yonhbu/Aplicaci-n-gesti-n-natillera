import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, relative } from 'node:path';
import { postgresCredentialLocations } from './lib/source-secret-findings.mjs';

const root = process.cwd();
const forbiddenClientKeyPattern = /VITE_SUPABASE_(SECRET|SERVICE|ADMIN|PRIVATE|JWT)_?KEY/i;
const elevatedMaterialPattern = /(sb_secret_[A-Za-z0-9_-]+|service_role)/i;
const envFilePattern = /^\.env(\..+)?$/;
const ignoredDirs = new Set([
  '.git',
  'node_modules',
  '.supabase',
  '.supabase-test',
  'coverage',
  'dist',
  'incoming',
  'playwright-report',
  'test-results'
]);
const sourceExtensions = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.html', '.css', '.toml', '.sql', '.md', '.webmanifest', '.yml', '.yaml']);
const failures = [];

function trackedFiles() {
  try {
    return new Set(
      execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        .split(/\r?\n/)
        .filter(Boolean)
        .map((file) => file.replaceAll('\\', '/')),
    );
  } catch {
    return null;
  }
}

const tracked = trackedFiles();

function extensionOf(path) {
  const match = path.match(/\.[^.\\/]+$/);
  return match?.[0] ?? '';
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!ignoredDirs.has(entry)) {
        walk(path);
      }
      continue;
    }

    const rel = relative(root, path).replaceAll('\\', '/');
    if (envFilePattern.test(entry) && entry !== '.env.example') {
      if (!tracked || tracked.has(rel)) {
        failures.push(`${rel}: no se deben versionar archivos de entorno reales`);
      }
      continue;
    }

    if (!sourceExtensions.has(extensionOf(entry))) {
      continue;
    }

    const text = readFileSync(path, 'utf8');
    for (const finding of postgresCredentialLocations(text)) {
      failures.push(`${rel}:${finding.line}: URI PostgreSQL con contraseña incrustada; no se muestra el valor`);
    }
    if (forbiddenClientKeyPattern.test(text)) {
      failures.push(`${rel}: nombre VITE_* prohibido para claves elevadas de Supabase`);
    }
    if (elevatedMaterialPattern.test(text) && rel !== 'scripts/check-secrets.mjs') {
      failures.push(`${rel}: posible material o nombre de clave elevada`);
    }
    if (rel !== 'scripts/check-secrets.mjs' && /natillera-2026-respaldo|natillera-2026\.csv|Aplicaci[oó]n de gesti[oó]n para natillera/i.test(text)) {
      failures.push(`${rel}: referencia directa a fuentes legacy privadas`);
    }
  }
}

walk(root);

if (failures.length > 0) {
  console.error('La revision de secretos/datos privados fallo:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Revision de secretos/datos privados aprobada.');
