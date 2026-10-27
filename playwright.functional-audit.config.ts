import { defineConfig, devices } from '@playwright/test';

// Intentionally independent from playwright.config.ts: never opens workspace dotenv files.
export default defineConfig({
  testDir: './e2e', testMatch: /functional-(audit|modules|money|publications|zz-close)\.spec\.ts/, workers: 1,
  globalSetup: ['./scripts/seed-functional-audit.mjs', './scripts/seed-functional-close.mjs'],
  timeout: 90_000, expect: { timeout: 12_000 },
  outputDir: 'incoming/functional-audit/browser',
  reporter: [['list'], ['json', { outputFile: 'incoming/functional-audit/results.json' }]],
  use: { baseURL: 'http://127.0.0.1:5198', channel: 'chrome', serviceWorkers: 'block', trace: 'off', screenshot: 'only-on-failure', actionTimeout: 15_000 },
  projects: [{ name: 'functional', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'node scripts/start-local-safe.mjs --test', url: 'http://127.0.0.1:5198', reuseExistingServer: false }
});
