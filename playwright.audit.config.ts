import { defineConfig, devices } from '@playwright/test';

// Deliberately does not load dotenv or reuse the normal config's environment files.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'audit-regressions.spec.ts',
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  outputDir: 'incoming/qa-audit-2026-10-15/regression-results',
  use: { baseURL: 'http://127.0.0.1:5188', channel: 'chrome', screenshot: 'only-on-failure' },
  projects: [
    { name: 'audit-desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'audit-mobile', use: { ...devices['Pixel 7'] } }
  ]
});
