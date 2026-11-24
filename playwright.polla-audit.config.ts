import base from './playwright.config';
import {defineConfig,devices} from '@playwright/test';
const phase=process.env.POLLA_AUDIT_PHASE??'final';
export default defineConfig({...base,testMatch:/polla-audit\.spec\.ts/,globalSetup:['./scripts/seed-polla-audit.mjs'],workers:1,timeout:120_000,
 outputDir:'incoming/polla-audit/'+phase+'/browser',reporter:[['list'],['json',{outputFile:'incoming/polla-audit/'+phase+'/results.json'}]],
 projects:[{name:'polla-desktop',use:{...devices['Desktop Chrome']}},{name:'polla-mobile',use:{...devices['Pixel 7']}}],
});
