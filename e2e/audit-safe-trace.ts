import { expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';

const tracked = new WeakMap<Page, { errors: string[]; console: string[]; locations: string[]; expectedHttp: {path:string;status:number}[]; responses:{path:string;status:number}[] }>();
export function expectAuditHttpFailure(page:Page,path:string,status:number) {
  if(!path.startsWith('/rest/v1/rpc/') || ![400,401,403,409,422,503].includes(status)) throw Error('Expectativa HTTP de auditoría no válida.');
  const messages=tracked.get(page);if(!messages)throw Error('La expectativa HTTP requiere una traza activa.');
  messages.expectedHttp.push({path,status});
}
export async function startAuditTrace(page: Page) {
  // Start after OTP verification so no code-entry screen is captured.
  const messages = { errors: [] as string[], console: [] as string[], locations: [] as string[], expectedHttp: [] as {path:string;status:number}[], responses: [] as {path:string;status:number}[] };
  tracked.set(page, messages);
  page.on('pageerror', error => messages.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') {messages.console.push(message.text());messages.locations.push(message.location().url);} });
  page.on('response', response => {if(response.status()>=400)messages.responses.push({path:new URL(response.url()).pathname,status:response.status()});});
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: false });
}
export async function finishAuditTrace(page: Page, info: TestInfo) {
  const messages = tracked.get(page);
  if (!messages) return;
  tracked.delete(page);
  const raw = info.outputPath('trace-unsanitized.zip');
  const safe = info.outputPath('trace-sanitized.zip');
  await page.context().tracing.stop({ path: raw });
  try {
    execFileSync(process.execPath, ['scripts/redact-playwright-trace.mjs', raw, safe], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    await info.attach('trace-sanitized', { path: safe, contentType: 'application/zip' });
  } finally { unlinkSync(raw); }
  await info.attach('browser-errors', { body: JSON.stringify(messages, null, 2), contentType: 'application/json' });
  expect(messages.errors, 'JavaScript errors after authentication').toEqual([]);
  for(const expected of messages.expectedHttp)expect(messages.responses,'Declared HTTP failure must actually occur').toContainEqual(expected);
  const unexpected = messages.console.filter((message,index) => {
    if(info.title.includes('respuesta perdida') && /ERR_FAILED|Failed to fetch/i.test(message)) return false;
    let path='';try{path=new URL(messages.locations[index]).pathname;}catch{/* Not a resource URL; retain the error. */}
    return !messages.expectedHttp.some(expected=>expected.path===path && /^Failed to load resource:/.test(message) && new RegExp('status of '+expected.status+'\\b').test(message));
  });
  expect(unexpected, 'Unexpected console errors').toEqual([]);
}
