import {defineConfig,devices} from '@playwright/test';
// No dotenv, no normal webServer script: this build is explicitly connected to TEST 55421.
export default defineConfig({
  testDir:'./e2e',testMatch:'fin-qa-fixes.spec.ts',workers:1,timeout:35_000,globalTimeout:240_000,
  outputDir:'incoming/fin-qa-2026-10-16/automated-browser',
  reporter:[['list'],['json',{outputFile:'incoming/fin-qa-2026-10-16/playwright-results.json'}]],
  use:{baseURL:'http://127.0.0.1:5190',actionTimeout:8_000,navigationTimeout:12_000,screenshot:'off',trace:'off'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome']}},{name:'mobile',use:{...devices['Pixel 7']}}],
});
