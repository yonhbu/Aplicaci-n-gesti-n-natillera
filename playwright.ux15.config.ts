import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',testMatch:'ux15.spec.ts',workers:1,timeout:120000,expect:{timeout:12000},outputDir:'incoming/ux15/browser-'+(process.env.UX15_PHASE||'after'),use:{baseURL:'http://127.0.0.1:5198',channel:'chrome',trace:'off',screenshot:'only-on-failure',actionTimeout:20000}});
