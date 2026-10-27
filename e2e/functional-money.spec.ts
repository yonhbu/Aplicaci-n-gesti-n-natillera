import { expect, test, type Locator, type Page } from './test-fixtures';
import { readFileSync } from 'node:fs';
import { startAuditTrace, finishAuditTrace } from './audit-safe-trace';

const api = 'http://127.0.0.1:55421';
const app = 'http://127.0.0.1:5198';
const mailpit = 'http://127.0.0.1:55424';
let fixture: { email: string; cycleId: string; today: string };
test.afterEach(async ({ page }, info) => { await finishAuditTrace(page, info); });

test.beforeAll(() => { fixture = JSON.parse(readFileSync('incoming/functional-audit/fixture.json', 'utf8')); });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(fixture.today + 'T17:00:00Z'));
  await page.route('**/*', async route => {
    const origin = new URL(route.request().url()).origin;
    if (![api, app, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(origin)) {
      await route.abort(); throw Error('Destino no autorizado en auditoría monetaria: ' + origin);
    }
    await route.fallback();
  });
});

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo autorizado').fill(fixture.email);
  const sent = page.waitForResponse(response => response.url() === api + '/auth/v1/otp');
  await page.getByRole('button', { name: 'Enviar codigo', exact: true }).click();
  expect((await sent).status()).toBe(200);
  await page.getByLabel('Codigo recibido').waitFor();
  const inbox = await (await page.request.get(mailpit + '/api/v1/messages')).json();
  const mail = inbox.messages.find((item: { To?: { Address: string }[] }) => item.To?.some(to => to.Address === fixture.email));
  expect(mail).toBeTruthy();
  const body = await (await page.request.get(mailpit + '/api/v1/message/' + encodeURIComponent(mail.ID))).json();
  const code = (String(body.Text ?? '') + String(body.HTML ?? '')).match(/\b\d{6}\b/)?.[0];
  expect(code).toBeTruthy();
  await page.getByLabel('Codigo recibido').fill(code!);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    return supabase.supabaseUrl;
  })).toBe(api);
  await startAuditTrace(page);
}

async function select(field: Locator, start: number, end = start) {
  await field.focus();
  await field.evaluate((node, range) => (node as HTMLInputElement).setSelectionRange(range.start, range.end), { start, end });
}
async function paste(page: Page, field: Locator, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: app });
  await page.evaluate(value => navigator.clipboard.writeText(value), text);
  await field.press('Control+V');
}
async function caret(field: Locator) {
  return field.evaluate(node => (node as HTMLInputElement).selectionStart);
}

test('COP real: teclado, portapapeles, cursor, selección, borrado, centavos y RPC exacta sin tocar P011', async ({ page }, info) => {
  test.setTimeout(120_000);
  await login(page);
  await page.goto('/#/members');
  await page.getByRole('button', { name: 'Nuevo socio', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const quota = sheet.getByLabel('Cuota mensual');
  const memberName = 'Auditoría COP ' + crypto.randomUUID().slice(0, 8);
  await sheet.getByLabel('Nombre visible').fill(memberName);
  await quota.pressSequentially('200000');
  await expect(quota).toHaveValue('200.000');
  expect(await caret(quota)).toBe(7);
  await expect(quota).toHaveAttribute('inputmode', 'decimal');
  await select(quota, 1); await quota.press('9');
  await expect(quota).toHaveValue('2.900.000'); expect(await caret(quota)).toBe(3);
  await quota.fill('12345'); await select(quota, 3); await quota.press('Backspace');
  await expect(quota).toHaveValue('1.345'); expect(await caret(quota)).toBe(1);
  await quota.press('Delete'); await expect(quota).toHaveValue('145'); expect(await caret(quota)).toBe(1);
  await quota.fill('1234567'); await select(quota, 2, 5); await paste(page, quota, '9000');
  await expect(quota).toHaveValue('19.000.567'); expect(await caret(quota)).toBe(6);
  await quota.press('Control+A'); await quota.press('Backspace'); await expect(quota).toHaveValue('');
  for (const invalid of ['-10', '12.34', '200000,123', 'abc200000']) {
    await quota.press('Control+A'); await paste(page, quota, invalid);
    await expect(quota).toHaveValue(invalid);
    expect(await quota.evaluate(node => (node as HTMLInputElement).validity.valid)).toBe(false);
    let posted = false;
    const watch = (request: import('@playwright/test').Request) => { if (request.url().endsWith('/rpc/save_cycle_member')) posted = true; };
    page.on('request', watch);
    await sheet.getByRole('button', { name: 'Crear socio', exact: true }).click();
    await expect(sheet).toBeVisible();
    expect(posted).toBe(false); page.off('request', watch);
  }
  await quota.press('Control+A'); await paste(page, quota, '200000,15');
  await expect(quota).toHaveValue('200.000,15');
  expect(await quota.evaluate(node => (node as HTMLInputElement).validity.valid)).toBe(true);
  const request = page.waitForRequest(request => request.url() === api + '/rest/v1/rpc/save_cycle_member');
  const response = page.waitForResponse(response => response.url() === api + '/rest/v1/rpc/save_cycle_member');
  await sheet.getByRole('button', { name: 'Crear socio', exact: true }).click();
  const payload = (await request).postDataJSON();
  expect(payload).toMatchObject({ p_monthly_quota: '200000.15', p_cycle_id: fixture.cycleId, p_display_name: memberName, p_member_id: null, p_cycle_member_id: null });
  expect((await response).ok()).toBe(true);
  await expect(sheet).toHaveCount(0);
  await page.reload();
  const persisted = await page.evaluate(async ({ cycleId, name }) => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const result = await supabase.from('cycle_members').select('monthly_quota, member:members!inner(display_name)').eq('cycle_id', cycleId).eq('member.display_name', name).single();
    if (result.error) throw Error(result.error.message); return String(result.data.monthly_quota);
  }, { cycleId: fixture.cycleId, name: memberName });
  expect(persisted).toBe('200000.15');
  await info.attach('payload-cop-sintetico', { body: JSON.stringify(payload, null, 2), contentType: 'application/json' });

  // Additional real forms are edited and cancelled: no loan or contribution is posted.
  await page.goto('/#/loans'); await page.getByRole('button', { name: 'Nuevo préstamo', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Principal', { exact: true }).pressSequentially('1500000,25');
  await expect(page.getByRole('dialog').getByLabel('Principal', { exact: true })).toHaveValue('1.500.000,25');
  await page.getByRole('dialog').getByLabel('Tasa %', { exact: true }).fill('2,25');
  await expect(page.getByRole('dialog').getByLabel('Tasa %', { exact: true })).toHaveValue('2,25');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.goto('/#/savings'); await page.getByRole('button', { name: 'Registrar aporte', exact: true }).click();
  await page.getByRole('dialog').getByLabel('Monto recibido').pressSequentially('200000,15');
  await expect(page.getByRole('dialog').getByLabel('Monto recibido')).toHaveValue('200.000,15');
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar', exact: true }).click();
});

// Source-level coverage inventory, explicitly separate from browser interaction coverage above.
// Each field must retain the same reusable component; rates and nonmonetary inputs are excluded.
const integrations = {
  'App.tsx': ['monthlyQuota', 'amountText', 'principal', 'paymentAmount', 'capitalAmount', 'interestAmount', 'pollaAmount', 'prizeGross', 'amount', 'interestWithholding', 'interestFee', 'externalBalance', 'openingBalance', 'amount', 'otherDiscounts', 'annualFee', 'penalty', 'costs', 'reserve', 'committedYield'],
  'CompletionReceipt.tsx': ['amount'], 'StatementCheck.tsx': ['amount'], 'PersonalFunds.tsx': ['amount']
};
for (const [file, fields] of Object.entries(integrations)) {
  test(`Inventario de integración COP: ${file}, ${fields.length} campos`, async ({}, info) => {
    const source = readFileSync('src/ui/' + file, 'utf8');
    const tags = source.match(/<CopInput\b[^]*?\/>/g) ?? [];
    expect(tags).toHaveLength(fields.length);
    for (const field of new Set(fields)) expect(tags.filter(tag => tag.includes(`value={${field}}`))).toHaveLength(fields.filter(name => name === field).length);
    if (file === 'App.tsx') expect(source).toMatch(/<input[^>]*value=\{rateValue\}/);
    await info.attach('campos-integrados', { body: JSON.stringify({ file, fields, coverage: 'source integration; browser interaction is tested separately' }, null, 2), contentType: 'application/json' });
  });
}
