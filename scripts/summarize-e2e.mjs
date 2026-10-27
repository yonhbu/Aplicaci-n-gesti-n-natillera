import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
const file = 'incoming/ci-database/results.json';
mkdirSync('incoming/ci-database', { recursive: true });
let summary = '# E2E database — TEST local\n\n';
if (!existsSync(file)) summary += 'No se produjo informe Playwright. Revisar el paso de preparación/arranque fallido; no equivale a una ejecución aprobada.\n';
else {
  const result = JSON.parse(readFileSync(file, 'utf8'));
  summary += `Correctas: ${result.stats.expected}; fallidas: ${result.stats.unexpected}; omitidas: ${result.stats.skipped}; flaky: ${result.stats.flaky}.\n\n`;
  if (result.errors?.length) summary += `Errores de preparación/colección: ${result.errors.length}. Revisar el log del paso E2E.\n\n`;
  function visit(suites) {
    for (const suite of suites ?? []) {
      for (const spec of suite.specs ?? []) for (const test of spec.tests ?? []) {
        if (test.status !== 'expected') {
          const message = test.results?.find(item => item.error)?.error?.message ?? test.status;
          summary += `- ${test.projectName}: ${spec.title} — ${String(message).replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:secret|publishable)_[\w-]+/g, '[redacted]').replace(/\u001b\[[\d;]*m/g, '').replace(/[\r\n]+/g, ' ').slice(0, 350)}\n`;
        }
      }
      visit(suite.suites);
    }
  }
  visit(result.suites);
}
writeFileSync('incoming/ci-database/summary.md', summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
console.log(summary);
