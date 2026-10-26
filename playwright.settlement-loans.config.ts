import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:'settlement-loans.spec.ts',workers:1,timeout:120000,expect:{timeout:12000},outputDir:'incoming/settlement-loans-2026-10-21/browser',use:{baseURL:'http://127.0.0.1:5198',channel:'chrome',trace:'off',screenshot:'only-on-failure',actionTimeout:20000}});
