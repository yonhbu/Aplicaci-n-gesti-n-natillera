import {defineConfig,devices} from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',testMatch:'ui-boundaries.spec.ts',workers:1,timeout:60_000,globalTimeout:1_200_000,
  expect:{timeout:6_000},outputDir:'incoming/ux-boundaries-2026-10-16/browser-results',
  reporter:[['list'],['json',{outputFile:'incoming/ux-boundaries-2026-10-16/playwright-results.json'}]],
  use:{baseURL:'http://127.0.0.1:5196',locale:'es-CO',serviceWorkers:'block',actionTimeout:10_000,navigationTimeout:30_000,trace:'off',screenshot:'off'},
  projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1440,height:1000}}},{name:'mobile',use:{...devices['Pixel 7'],viewport:{width:375,height:812}}}],
});
