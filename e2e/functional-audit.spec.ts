import { expect, test, type Page } from './test-fixtures';
import { readFileSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { startAuditTrace, finishAuditTrace } from './audit-safe-trace';

const api = 'http://127.0.0.1:55421';
const app = 'http://127.0.0.1:5198';
let f: { email: string; outsiderEmail: string; cycleId: string; loanId: string; bankId: string; participationId: string; today: string };
test.describe.configure({ mode: 'serial' });
test.afterEach(async ({ page }, info) => { await finishAuditTrace(page, info); });
test.beforeAll(() => { f = JSON.parse(readFileSync('incoming/functional-audit/fixture.json', 'utf8')); });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(f.today + 'T17:00:00Z'));
  await page.route('**/*', async route => {
    const origin = new URL(route.request().url()).origin;
    if (![api, app, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(origin)) {
      await route.abort();
      throw Error('Destino de red no autorizado en auditoría: ' + origin);
    }
    await route.fallback();
  });
});
async function login(page: Page, email = f.email, heading = 'Inicio') {
  await page.goto('/');
  await page.getByLabel('Correo autorizado').fill(email);
  const sent = page.waitForResponse(r => r.url() === api + '/auth/v1/otp');
  await page.getByRole('button', { name: 'Enviar codigo', exact: true }).click();
  expect((await sent).status()).toBe(200);
  await page.getByLabel('Codigo recibido').waitFor();
  const inbox = await (await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
  const mail = inbox.messages.find((m: any) => m.To?.some((t: any) => t.Address === email));
  const body = await (await page.request.get('http://127.0.0.1:55424/api/v1/message/' + mail.ID)).json();
  const code = (String(body.Text ?? '') + String(body.HTML ?? '')).match(/\b\d{6}\b/)?.[0];
  expect(code).toBeTruthy();
  await page.getByLabel('Codigo recibido').fill(code!);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
  expect(await page.evaluate(async () => {
    const modulePath = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ modulePath);
    return supabase.supabaseUrl;
  })).toBe(api);
  await startAuditTrace(page);
}
async function state(page: Page) {
  return page.evaluate(async fixture => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const decimalPath = '/src/domain/money.ts'; const { parseCop } = await import(/* @vite-ignore */ decimalPath);
    const read = async (table: string) => {
      const r = await supabase.from(table).select('*').eq('cycle_id', fixture.cycleId);
      if (r.error) throw Error(r.error.message); return r.data;
    };
    const [payments, schedules, entries, operations, applications] = await Promise.all(
      ['loan_payments', 'loan_schedule_progress', 'ledger_entries', 'financial_operations', 'loan_payment_applications'].map(read));
    const sum = (items: any[]) => items.reduce((s, e) => s.plus(e.amount), parseCop('0')).toFixed(2);
    const balances = Object.fromEntries(['cash', 'loans_receivable', 'admin_payable', 'member_loan_profit_fund'].map(a => [a, sum(entries.filter((e: any) => e.account === a))]));
    const bank = sum(entries.filter((e: any) => e.account === 'cash' && e.bank_account_id === fixture.bankId));
    const cashOnHand = sum(entries.filter((e: any) => e.account === 'cash' && e.liquidity_location === 'cash'));
    const unbalanced = operations.filter((o: any) => sum(entries.filter((e: any) => e.operation_id === o.id)) !== '0.00').length;
    return { payments, schedules, balances, bank, cashOnHand, unbalanced, applications, operations: operations.length, entries: entries.length };
  }, f);
}
async function detail(page: Page) {
  await page.goto('/#/loans');
  await page.locator(`[data-loan-row="${f.loanId}"]`).getByRole('button', { name: 'Ver detalle', exact: true }).click();
  return page.locator(`[data-loan-detail="${f.loanId}"]`);
}

test('P011: abono 200.000 deja cuota final pendiente 325.000, nunca 525.000 como saldo', async ({ page }, info) => {
  await login(page);
  const before = await state(page);
  expect(before.balances.loans_receivable).toBe('500000.00');
  const panel = await detail(page);
  await panel.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Efectivo', exact: true }).click();
  await sheet.getByLabel('Pago', { exact: true }).fill('200000');
  await sheet.getByLabel('Capital', { exact: true }).fill('200000');
  await sheet.getByLabel('Interés', { exact: true }).fill('0');
  await sheet.getByLabel('Fecha del pago', { exact: true }).fill('2026-10-26');
  await sheet.getByLabel('Nota del pago', { exact: true }).fill('Abono extraordinario al capital');
  await expect(sheet.getByRole('button', { name: 'Otro monto', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const response = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/record_noted_loan_payment');
  await sheet.getByRole('button', { name: 'Registrar Pago', exact: true }).dblclick();
  const saved = await response;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON()).toMatchObject({ p_amount: '200000.00', p_capital_amount: '200000.00', p_interest_amount: '0.00', p_bank_account_id: null, p_note: 'Abono extraordinario al capital' });
  await expect(sheet).toHaveCount(0);
  const after = await state(page);
  expect(after.balances.loans_receivable).toBe('300000.00');
  expect(after.balances.cash).toBe('1750000.00');
  expect(after.cashOnHand).toBe('750000.00');
  expect(after.bank).toBe(before.bank);
  expect(after.unbalanced).toBe(0);
  expect(after.payments).toHaveLength(before.payments.length + 1);
  expect(after.balances.admin_payable).toBe(before.balances.admin_payable);
  expect(after.balances.member_loan_profit_fund).toBe(before.balances.member_loan_profit_fund);
  const last = panel.getByRole('listitem').filter({ hasText: 'Cuota 4' });
  await expect(last.locator('.row-amount')).toHaveText(/325\.000/);
  await expect(last).toContainText(/Capital pendiente.*300\.000/);
  await page.reload();
  const reloaded = await detail(page);
  await expect(reloaded.getByRole('listitem').filter({ hasText: 'Cuota 4' }).locator('.row-amount')).toHaveText(/325\.000/);
  await expect(reloaded).toContainText('Nota: Abono extraordinario al capital');
  await page.goto('/#/home');
  await expect(page.locator('[data-figure-key="dinero-prestado"] [data-figure-value]')).toContainText('300.000,00');
  await page.screenshot({ path: info.outputPath('p011-home-after.png'), fullPage: true });
  writeFileSync('incoming/functional-audit/p011-after-capital.json', JSON.stringify(after, null, 2));
  await page.getByLabel('Fecha de corte', { exact: true }).fill('2026-10-25');
  await expect(page.locator('[data-figure-key="dinero-prestado"] [data-figure-value]')).toContainText('500.000,00');
  const historical = await detail(page);
  const historicalFinal = historical.getByRole('listitem').filter({ hasText: 'Cuota 4' });
  await expect(historicalFinal.locator('.row-amount')).toHaveText(/525\.000/);
  await expect(historicalFinal).toContainText(/Capital pendiente.*500\.000/);
  await expect(historical.getByText('Nota: Abono extraordinario al capital', { exact: true })).toHaveCount(0);
  await expect(historical.getByRole('button', { name: 'Registrar pago', exact: true })).toBeDisabled();
  await expect(historical.getByRole('button', { name: 'Registrar pago', exact: true })).toHaveAccessibleDescription(/Consulta histórica/);
  await page.screenshot({ path: info.outputPath('p011-historical-before-capital.png'), fullPage: true });
});

test('P011: reverso restaura 500.000; respuesta perdida y reintento no duplican; pago total deja cero', async ({ page }, info) => {
  test.setTimeout(150_000);
  await login(page);
  const before = await state(page);
  let panel = await detail(page);
  const capital = before.payments.find((p: any) => p.note === 'Abono extraordinario al capital');
  expect(capital).toBeTruthy();
  await panel.locator(`[data-loan-payment-row="${capital.id}"]`).getByRole('button', { name: 'Anular', exact: true }).click();
  let sheet = page.getByRole('dialog');
  await sheet.getByLabel('Fecha de la anulación').fill('2026-10-26');
  await sheet.getByLabel('Motivo', { exact: true }).fill('Reverso sintético del abono');
  await sheet.getByRole('button', { name: 'Confirmar anulación', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const reversed = await state(page);
  expect(reversed.balances.loans_receivable).toBe('500000.00');
  expect(reversed.balances.cash).toBe('1550000.00');
  expect(reversed.cashOnHand).toBe('550000.00');
  expect(reversed.bank).toBe(before.bank);
  expect(reversed.unbalanced).toBe(0);
  expect(reversed.schedules.find((s: any) => s.installment_number === 4).principal_paid).toBe(0);
  await expect(panel.locator(`[data-loan-payment-row="${capital.id}"]`)).toContainText('Revertido');
  await expect(panel.locator(`[data-loan-payment-row="${capital.id}"]`)).toContainText('Abono extraordinario al capital');
  // The server commits, then the transport loses its response. Retrying must reuse the persisted key.
  const endpoint = api + '/rest/v1/rpc/record_noted_loan_payment';
  await page.route(endpoint, async route => { const result = await route.fetch(); expect(result.status()).toBe(200); await route.abort('failed'); }, { times: 1 });
  await panel.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Efectivo', exact: true }).click();
  await sheet.getByLabel('Pago', { exact: true }).fill('200000');
  await sheet.getByLabel('Capital', { exact: true }).fill('200000');
  await sheet.getByLabel('Interés', { exact: true }).fill('0');
  await sheet.getByLabel('Nota del pago', { exact: true }).fill('Reintento sintético');
  await sheet.getByLabel('Fecha del pago', { exact: true }).fill('2026-10-26');
  await sheet.getByRole('button', { name: 'Registrar Pago', exact: true }).click();
  await expect(sheet.getByRole('alert')).toBeVisible();
  const committed = await state(page);
  expect(committed.balances.loans_receivable).toBe('300000.00');
  await page.reload();
  panel = await detail(page);
  await panel.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  sheet = page.getByRole('dialog');
  await expect(sheet.getByLabel('Nota del pago', { exact: true })).toHaveValue('Reintento sintético');
  await sheet.getByRole('button', { name: 'Registrar Pago', exact: true }).click();
  await expect(sheet).toHaveCount(0);
  const retried = await state(page);
  expect(retried.payments.length).toBe(committed.payments.length);
  expect(retried.entries).toBe(committed.entries);
  expect(retried.balances).toEqual(committed.balances);
  await panel.getByRole('button', { name: 'Pagar todo', exact: true }).click();
  sheet = page.getByRole('dialog');
  await expect(sheet.getByText(/Para cancelar en la fecha elegida/)).toContainText('300.000,00');
  await sheet.getByLabel('Fecha del pago', { exact: true }).fill('2026-10-26');
  const recalculate = sheet.getByRole('button', { name: 'Calcular', exact: true });
  if (await recalculate.isVisible()) await recalculate.click();
  await sheet.getByLabel('Nota del pago', { exact: true }).fill('Cancelación sintética');
  const response = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/confirm_noted_loan_prepayment');
  await sheet.getByRole('button', { name: 'Confirmar pago total', exact: true }).dblclick();
  expect((await response).status()).toBe(200);
  await expect(sheet).toHaveCount(0);
  const closed = await state(page);
  expect(closed.balances.loans_receivable).toBe('0.00');
  expect(closed.balances.cash).toBe('2050000.00');
  expect(closed.cashOnHand).toBe('1050000.00');
  expect(closed.bank).toBe(before.bank);
  expect(closed.unbalanced).toBe(0);
  expect(closed.payments.filter((p: any) => p.note === 'Cancelación sintética')).toHaveLength(1);
  await page.reload();
  await page.goto('/#/home');
  await expect(page.locator('[data-figure-key="dinero-prestado"] [data-figure-value]')).toContainText('0,00');
  await page.screenshot({ path: info.outputPath('p011-final-zero.png'), fullPage: true });
  writeFileSync('incoming/functional-audit/p011-final.json', JSON.stringify(closed, null, 2));
  await page.getByLabel('Fecha de corte', { exact: true }).fill('2026-10-25');
  await expect(page.locator('[data-figure-key="dinero-prestado"] [data-figure-value]')).toContainText('500.000,00');
  const historical = await detail(page);
  await expect(historical.getByRole('listitem').filter({ hasText: 'Cuota 4' }).locator('.row-amount')).toHaveText(/525\.000/);
  await expect(historical.locator('[data-loan-payment-row]')).toHaveCount(2);
  await finishAuditTrace(page, info);
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await expect(page.getByLabel('Correo autorizado')).toBeVisible();
  await login(page);
  await page.goto('/#/home');
  await page.getByLabel('Fecha de corte', { exact: true }).fill('2026-10-26');
  await expect(page.locator('[data-figure-key="dinero-prestado"] [data-figure-value]')).toContainText('0,00');
  expect((await state(page)).balances).toEqual(closed.balances);
  await finishAuditTrace(page, info);
  await page.getByRole('button', { name: 'Salir', exact: true }).click();
  await expect(page.getByLabel('Correo autorizado')).toBeVisible();
  const workspaceWrites: string[] = [];
  page.on('request', request => {
    if (request.method() === 'POST' && /\/rest\/v1\/(workspaces|rpc\/.*workspace)/.test(request.url())) workspaceWrites.push(request.url());
  });
  await login(page, f.outsiderEmail, 'Sin acceso asignado');
  await expect(page.getByRole('button', { name: /Crear.*(?:natillera|workspace)/i })).toHaveCount(0);
  expect(workspaceWrites).toEqual([]);
  const forbidden = await page.evaluate(async cycleId => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const response = await supabase.from('loan_payments').select('id,note').eq('cycle_id', cycleId);
    if (response.error) throw Error(response.error.message);
    return response.data;
  }, f.cycleId);
  expect(forbidden).toEqual([]);
});
