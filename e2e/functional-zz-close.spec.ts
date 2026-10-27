import { expect, test, type Page, type Locator } from './test-fixtures';
import { readFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import { startAuditTrace, finishAuditTrace } from './audit-safe-trace';

// Historical synthetic cycle: publication is due without overriding the real
// server calendar, TEST clock, RPC responses, or any financial safety guard.
const api = 'http://127.0.0.1:55421', app = 'http://127.0.0.1:5198';
let fixture: { email: string; workspaceId: string; cycleId: string; bankId: string; participationA: string; participationB: string; today: string };
test.describe.configure({ mode: 'serial' });
test.beforeAll(() => { fixture = JSON.parse(readFileSync('incoming/functional-audit/close-fixture.json', 'utf8')); });
test.afterEach(async ({ page }, info) => { await finishAuditTrace(page, info); });

async function login(page: Page) {
  await page.clock.setFixedTime(new Date(fixture.today + 'T17:00:00Z'));
  await page.route('**/*', async route => {
    if (![api, app, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(new URL(route.request().url()).origin)) {
      await route.abort(); throw Error('Destino no autorizado en publicación sintética.');
    }
    await route.fallback();
  });
  await page.goto('/');
  await page.getByLabel('Correo autorizado').fill(fixture.email);
  const sent = page.waitForResponse(r => r.url() === api + '/auth/v1/otp');
  await page.getByRole('button', { name: 'Enviar codigo', exact: true }).click();
  expect((await sent).ok()).toBe(true);
  await page.getByLabel('Codigo recibido').waitFor();
  const inbox = await (await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
  const mail = inbox.messages.find((m: { To?: { Address: string }[] }) => m.To?.some(to => to.Address === fixture.email));
  expect(mail).toBeTruthy();
  const body = await (await page.request.get('http://127.0.0.1:55424/api/v1/message/' + encodeURIComponent(mail.ID))).json();
  const code = (String(body.Text ?? '') + String(body.HTML ?? '')).match(/\b\d{6}\b/)?.[0];
  expect(code).toBeTruthy();
  await page.getByLabel('Codigo recibido').fill(code!);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible();
  await startAuditTrace(page);
}

async function state(page: Page) {
  const rows = await page.evaluate(async f => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const read = async (table: string, columns = '*') => {
      const r = await supabase.from(table).select(columns).eq('cycle_id', f.cycleId);
      if (r.error) throw Error(r.error.message); return r.data;
    };
    const [entries, credits, bank, profit, allocations, operations, members] = await Promise.all([
      read('ledger_entries'), read('member_capital_credits'), read('bank_yield_distributions'),
      read('loan_profit_period_distributions'), read('loan_profit_period_allocations'), read('financial_operations'), read('cycle_members')
    ]);
    const outside = await supabase.from('ledger_entries').select('id').neq('workspace_id', f.workspaceId).limit(1);
    if (outside.error) throw Error(outside.error.message);
    return { entries, credits, bank, profit, allocations, operations, members, outsideRows: outside.data.length };
  }, fixture);
  const total = (account: string, location?: string): number => rows.entries
    .filter((e: any) => e.account === account && (!location || e.liquidity_location === location))
    .reduce((sum: Decimal, e: any) => sum.add(e.amount), new Decimal(0)).mul(100).toNumber();
  const grouped = new Map<string, Decimal>();
  for (const e of rows.entries) grouped.set(e.operation_id, (grouped.get(e.operation_id) ?? new Decimal(0)).add(e.amount));
  // FIN07 confirmation posts -ea to savings_yield_expense and -collective to
  // utility_distribution_payable. These are obligations, without a cash entry.
  const obligation = (account: string) => {
    const amount = new Decimal(total(account)).negated();
    return amount.isZero() ? 0 : amount.toNumber();
  };
  return { ...rows, cash: total('cash'), bankCash: total('cash', 'bank'),
    eaReserve: obligation('savings_yield_expense'), payable: obligation('utility_distribution_payable'),
    unbalanced: [...grouped.values()].filter(value => !value.isZero()).length };
}

const cents = (value: string | number) => new Decimal(value).mul(100).toNumber();

async function clickRpc(page: Page, button: Locator, rpc: string) {
  const response = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/' + rpc);
  await button.click(); const result = await response;
  expect(result.ok(), rpc + ' succeeds through the actual API').toBe(true);
  return result.request().postDataJSON();
}
async function retry(page: Page, rpc: string, payload: unknown) {
  const error = await page.evaluate(async ({ rpc, payload }) => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const r = await supabase.rpc(rpc, payload); return r.error?.message ?? null;
  }, { rpc, payload });
  expect(error).toBeNull();
}

test('publicación histórica FIN03: derechos bancarios, reserva 12 EA, obligaciones, pago único y correcciones trazadas', async ({ page }, info) => {
  test.setTimeout(180_000);
  await login(page);
  const initial = await state(page);
  expect(initial.unbalanced).toBe(0); expect(initial.outsideRows).toBe(0);
  expect(initial.credits).toHaveLength(0); expect(initial.profit).toHaveLength(0);
  expect(initial.members.find((m: any) => m.id === fixture.participationA).economic_mode).toBe('collective');
  expect(initial.members.find((m: any) => m.id === fixture.participationB).economic_mode).toBe('fixed_yield');

  await page.goto('/#/more/yield');
  const yieldPanel = page.locator('section.yield-page');
  await yieldPanel.getByRole('button', { name: 'Calcular reparto', exact: true }).click();
  await expect(yieldPanel.getByRole('button', { name: 'Confirmar reparto', exact: true })).toBeEnabled();
  const bankPayload = await clickRpc(page, yieldPanel.getByRole('button', { name: 'Confirmar reparto', exact: true }), 'confirm_bank_yield_distribution');
  expect(bankPayload.p_cut_date).toBe('2025-12-05');
  await expect(yieldPanel.getByRole('heading', { name: 'Reparto por socio' })).toBeVisible();
  let current = await state(page);
  expect(current.cash).toBe(initial.cash); expect(current.bankCash).toBe(initial.bankCash);
  const credit = current.credits.filter((r: any) => r.reversed_at === null);
  expect(credit).toHaveLength(1); expect(credit[0].cycle_member_id).toBe(fixture.participationA);
  expect(Number(credit[0].amount)).toBe(10000);
  await retry(page, 'confirm_bank_yield_distribution', bankPayload);
  expect((await state(page)).credits).toHaveLength(1);
  page.once('dialog', dialog => dialog.accept('Corrección sintética de publicación bancaria'));
  await clickRpc(page, yieldPanel.getByRole('button', { name: 'Deshacer reparto para corregir', exact: true }), 'reverse_bank_yield_distribution');
  await expect(yieldPanel.getByRole('button', { name: 'Calcular reparto', exact: true })).toBeVisible();
  current = await state(page);
  expect(current.credits.filter((r: any) => r.reversed_at !== null)).toHaveLength(1);
  expect(current.cash).toBe(initial.cash);
  await yieldPanel.getByRole('button', { name: 'Calcular reparto', exact: true }).click();
  await clickRpc(page, yieldPanel.getByRole('button', { name: 'Confirmar reparto', exact: true }), 'confirm_bank_yield_distribution');
  await expect(yieldPanel.getByRole('heading', { name: 'Reparto por socio' })).toBeVisible();

  await page.goto('/#/more/profit');
  const profit = page.locator('div.polla-block').filter({ has: page.getByRole('heading', { name: 'Reparto por periodos', exact: true }) });
  await profit.getByRole('button', { name: /^Calcular al / }).click();
  await expect(profit.getByRole('button', { name: 'Confirmar reparto', exact: true })).toBeEnabled();
  const publication = await clickRpc(page, profit.getByRole('button', { name: 'Confirmar reparto', exact: true }), 'confirm_loan_profit_periods');
  await expect(profit.getByRole('button', { name: 'Pagar a todos los pendientes', exact: true })).toBeVisible();
  current = await state(page);
  const dist = current.profit.find((r: any) => r.status !== 'reversed');
  expect(Number(dist.fund_total)).toBe(90000);
  expect(Number(dist.ea_obligation)).toBeGreaterThan(0);
  expect(new Decimal(dist.ea_obligation).add(dist.collective_total).eq(90000)).toBe(true);
  expect(current.eaReserve).toBe(cents(dist.ea_obligation));
  expect(current.payable).toBe(cents(dist.collective_total));
  expect(current.cash).toBe(initial.cash);
  expect(current.allocations).toHaveLength(1); expect(current.allocations[0].cycle_member_id).toBe(fixture.participationA);
  await retry(page, 'confirm_loan_profit_periods', publication);
  expect((await state(page)).profit).toHaveLength(1);
  page.once('dialog', dialog => dialog.accept('Corrección sintética de utilidad antes de pago'));
  await clickRpc(page, profit.getByRole('button', { name: 'Deshacer reparto para corregir', exact: true }), 'reverse_loan_profit_periods');
  await expect(profit.getByRole('button', { name: /^Calcular al / })).toBeVisible();
  current = await state(page); expect(current.payable).toBe(0); expect(current.eaReserve).toBe(0); expect(current.cash).toBe(initial.cash);
  await profit.getByRole('button', { name: /^Calcular al / }).click();
  await clickRpc(page, profit.getByRole('button', { name: 'Confirmar reparto', exact: true }), 'confirm_loan_profit_periods');
  await expect(profit.getByLabel('Fecha del pago')).toBeVisible();
  await profit.getByRole('button', { name: 'Banco', exact: true }).click();
  await profit.getByRole('combobox').selectOption(fixture.bankId);
  await profit.getByLabel('Fecha del pago').fill('2026-10-26');
  await profit.getByLabel('Referencia', { exact: true }).fill('Transferencia sintética al beneficiario colectivo');
  const paid = await clickRpc(page, profit.getByRole('button', { name: 'Pagar', exact: true }), 'pay_loan_profit_allocation');
  await expect(profit.getByRole('button', { name: 'Pagar a todos los pendientes', exact: true })).toHaveCount(0);
  current = await state(page);
  expect(current.profit.filter((r: any) => r.status === 'paid')).toHaveLength(1);
  expect(current.allocations.filter((r: any) => r.paid_operation_id !== null)).toHaveLength(1);
  expect(current.cash).toBe(initial.cash - cents(dist.collective_total));
  expect(current.bankCash).toBe(initial.bankCash - cents(dist.collective_total));
  expect(current.payable).toBe(0); expect(current.unbalanced).toBe(0);
  await retry(page, 'pay_loan_profit_allocation', paid);
  const replay = await state(page);
  expect(replay.cash).toBe(current.cash);
  expect(replay.operations.filter((r: any) => r.operation_type === 'loan_profit_period_paid')).toHaveLength(1);
  await expect(profit.getByRole('button', { name: 'Deshacer reparto para corregir', exact: true })).toHaveCount(0);
  await page.reload();
  expect((await state(page)).cash).toBe(current.cash);
  expect((await state(page)).outsideRows).toBe(0);
  await info.attach('publicacion-sintetica-invariantes', { body: JSON.stringify({ year: 2025, policy: 'fin03-2026',
    bankCredit: 10000, fund: 90000, eaObligation: dist.ea_obligation, collective: dist.collective_total,
    paidBeneficiaries: 1, duplicatePayments: 0, unbalancedOperations: 0, cycleArchived: false }, null, 2), contentType: 'application/json' });
});
