import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: 'ux13.spec.ts', workers: 1, timeout: 120000,
  expect: { timeout: 12000 },
  outputDir: 'incoming/ux13-2026-10-20/browser-' + (process.env.UX13_PHASE || 'after'),
  use: { baseURL: 'http://127.0.0.1:5198', channel: 'chrome', trace: 'off', screenshot: 'only-on-failure', actionTimeout: 20000 }
});
