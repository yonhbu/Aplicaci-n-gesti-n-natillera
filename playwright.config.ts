import { defineConfig, devices } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.test.local', override: true, quiet: true });

const devCommand =
  process.platform === 'win32'
    ? `set SUPABASE_ENV=test&& npm run dev -- --mode test --host 127.0.0.1 --port ${process.env.PLAYWRIGHT_PORT ?? '5176'}`
    : `SUPABASE_ENV=test npm run dev -- --mode test --host 127.0.0.1 --port ${process.env.PLAYWRIGHT_PORT ?? '5176'}`;

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${process.env.PLAYWRIGHT_PORT ?? '5176'}`;

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  workers: 1,
  expect: { timeout: 5_000 },
  use: {
    baseURL,
    channel: 'chrome',
    trace: 'on-first-retry'
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }
  ],
  webServer: {
    command: devCommand,
    url: baseURL,
    reuseExistingServer: false
  }
});
