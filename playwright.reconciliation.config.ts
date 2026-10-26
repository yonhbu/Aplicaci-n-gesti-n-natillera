import { defineConfig } from '@playwright/test';
// Does not load dotenv. Only a dedicated TEST application is accepted by the spec.
export default defineConfig({
  testDir: './e2e', testMatch: 'reconciliation.spec.ts', workers: 1, timeout: 45_000,
  expect: { timeout: 10_000 },
  outputDir: 'incoming/reconciliation-synthetic-2026-10-17/browser',
  use: { baseURL: 'http://127.0.0.1:5198', channel: 'chrome', trace: 'off', screenshot: 'only-on-failure' }
});
