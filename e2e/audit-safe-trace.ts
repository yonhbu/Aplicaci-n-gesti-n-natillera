import { expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { unlinkSync } from 'node:fs';

const tracked = new WeakMap<Page, { errors: string[]; console: string[] }>();
export async function startAuditTrace(page: Page) {
  // Start after OTP verification so no code-entry screen is captured.
  const messages = { errors: [] as string[], console: [] as string[] };
  tracked.set(page, messages);
  page.on('pageerror', error => messages.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') messages.console.push(message.text()); });
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
  const unexpected = messages.console.filter(message => !info.title.includes('respuesta perdida') || !/ERR_FAILED|Failed to fetch/i.test(message));
  expect(unexpected, 'Unexpected console errors').toEqual([]);
}
