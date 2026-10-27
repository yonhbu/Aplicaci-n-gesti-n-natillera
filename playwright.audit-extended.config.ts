import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e', testMatch: /[\\/](reconciliation|fin-recon|money-control|settlement-loans)\.spec\.ts$/,
  globalSetup: './scripts/seed-audit-extended.mjs', workers: 1,
  timeout: 90_000, expect: { timeout: 12_000 },
  outputDir: 'incoming/functional-audit/extended-browser',
  reporter: [['list'], ['json', { outputFile: 'incoming/functional-audit/extended-results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5198', channel: 'chrome', serviceWorkers: 'block', trace: 'off', screenshot: 'only-on-failure', actionTimeout: 15_000 },
  webServer: { command: 'node scripts/start-local-safe.mjs --test', url: 'http://127.0.0.1:5198', reuseExistingServer: false }
});
