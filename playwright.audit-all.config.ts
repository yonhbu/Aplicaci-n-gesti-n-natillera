import { defineConfig } from '@playwright/test';
import base from './playwright.functional-audit.config';

// One guarded, reproducible regression over new scenarios and existing financial suites.
export default defineConfig({
  ...base,
  testMatch: /[\\/](functional-(audit|modules|money|publications|zz-close)|reconciliation|fin-recon|money-control|settlement-loans)\.spec\.ts$/,
  globalSetup: ['./scripts/seed-functional-audit.mjs', './scripts/seed-functional-close.mjs', './scripts/seed-audit-extended.mjs'],
  outputDir: 'incoming/functional-audit/all-browser',
  reporter: [['list'], ['json', { outputFile: 'incoming/functional-audit/all-results.json' }]]
});
