import { execFileSync } from 'node:child_process';
import { auditRuntime } from './lib/audit-test-runtime.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { auditSql } from './lib/audit-test-runtime.mjs';

// Existing fixtures each create a new synthetic workspace and restore local transaction settings.
export default function seedAuditExtended() {
  for (const name of ['seed-reconciliation-test', 'seed-fin-recon-test', 'seed-money-control-test', 'seed-settlement-loans-test']) {
    auditRuntime();
    try {
      execFileSync(process.execPath, [`scripts/${name}.mjs`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    } catch {
      throw Error(`No se pudo preparar ${name}; salida del subproceso omitida para proteger credenciales.`);
    }
    console.log(`PASS fixture sintético TEST: ${name}`);
  }
  const today = auditSql('select public.fin_civil_today();');
  for (const folder of ['reconciliation-synthetic-2026-10-17', 'fin-recon-2026-10-20', 'money-control-2026-10-20', 'settlement-loans-2026-10-21']) {
    const file = `incoming/${folder}/fixture.json`;
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')), today }, null, 2));
  }
}

if (process.argv[1]?.endsWith('seed-audit-extended.mjs')) seedAuditExtended();
