import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e', testMatch: process.env.UX14_LEGACY === '1' ? 'ux13.spec.ts' : 'ux14.spec.ts', workers: 1, timeout: 120000,
  expect: { timeout: 12000 },
  outputDir: process.env.UX14_BROWSER_OUTPUT || 'incoming/ux14-2026-10-20/browser-' + (process.env.UX14_PHASE || 'after'),
  use: { baseURL: 'http://127.0.0.1:5198', channel: 'chrome', trace: 'off', screenshot: 'only-on-failure', actionTimeout: 20000 }
});
