import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';

// Pin the initial audited revision so this proof remains reproducible after review commits.
const baseline = 'src/ui/App.audit-baseline.tsx';
mkdirSync('incoming/functional-audit', { recursive: true });
try {
  writeFileSync(baseline, execFileSync('git', ['show', 'f5f6671:src/ui/App.tsx'], { encoding: 'utf8' }));
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.audit.config.ts', 'src/ui/LoanPaymentAudit.test.tsx', '-t', 'P011 muestra', '--maxWorkers=1'],
    { env: { ...process.env, AUDIT_BASELINE: '1' }, encoding: 'utf8', windowsHide: true });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  writeFileSync('incoming/functional-audit/p011-baseline.txt', output);
  if (result.status === 0 || !output.includes('525.000') || !output.includes('325.000')) throw Error('La línea base no reprodujo la diferencia esperada.');
  console.log('REPRODUCIDO contra App.tsx de f5f6671: se esperaban 325.000, se mostraban 525.000. Evidencia local p011-baseline.txt.');
} finally { unlinkSync(baseline); }
