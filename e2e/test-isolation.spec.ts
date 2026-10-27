import { test, expect } from './test-fixtures';

test('producción queda bloqueada antes de enviar solicitudes desde navegador y APIRequestContext', async ({ page, request, browser }) => {
  // Reserved .invalid domain: no production host or credentials are used in this test.
  await expect(page.request.get('https://production.invalid/rest/v1/')).rejects.toThrow(/bloqueada/);
  await expect(request.get('http://127.0.0.1:44121/rest/v1/')).rejects.toThrow(/bloqueada/);
  await page.goto('http://127.0.0.1:5198/');
  const target = await page.evaluate(async () => {
    const { readAppEnv } = await import('/src/lib/env.ts');
    return readAppEnv().supabaseUrl;
  });
  expect(target).toBe('http://127.0.0.1:55421');
  const response = await page.request.get('http://127.0.0.1:5198/src/lib/env.ts');
  expect(response.ok()).toBe(true);
  const source = await response.text();
  expect(source).toContain('http://127.0.0.1:55421');
  expect(source).toMatch(/"MODE"\s*:\s*"test"/);
  expect([...new Set(source.match(/VITE_[A-Z_]+/g))].sort()).toEqual(['VITE_SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_URL']);
  const extra = await browser.newContext();
  try {
    const extraPage = await extra.newPage();
    await expect(extraPage.goto('https://production.invalid')).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
    await expect(extraPage.request.get('https://production.invalid')).rejects.toThrow(/bloqueada/);
  } finally { await extra.close(); }
  await expect(page.goto('https://production.invalid')).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
});
