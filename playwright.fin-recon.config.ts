import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e',testMatch:'fin-recon.spec.ts',workers:1,timeout:90000,
  expect:{timeout:10000},
  outputDir:'incoming/fin-recon-2026-10-20/browser',
  use:{baseURL:'http://127.0.0.1:5198',channel:'chrome',trace:'off',screenshot:'only-on-failure'}
});
