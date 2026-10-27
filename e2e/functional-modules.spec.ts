import { expect, test, type Page, type Locator } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { startAuditTrace, finishAuditTrace } from './audit-safe-trace';
import Decimal from 'decimal.js';

// Only root's disposable synthetic fixture metadata is read. No dotenv or real backup.
const api = 'http://127.0.0.1:55421';
const app = 'http://127.0.0.1:5198';
let f: { email: string; cycleId: string; bankId: string; loanId: string; today: string };
// Root's audit configuration runs one worker. A failed scenario must not skip
// the remaining independent modules; each uses unique names and state deltas.
test.describe.configure({ mode: 'default' });
test.afterEach(async ({ page }, info) => { await finishAuditTrace(page, info); });
test.beforeAll(() => { f = JSON.parse(readFileSync('incoming/functional-audit/fixture.json', 'utf8')); });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(f.today + 'T17:00:00Z'));
  await page.route('**/*', async route => {
    const origin = new URL(route.request().url()).origin;
    if (![api, app, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(origin)) {
      await route.abort(); throw Error('Destino no autorizado en TEST: ' + origin);
    }
    await route.continue();
  });
});

async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('Correo autorizado').fill(f.email);
  const sent = page.waitForResponse(r => r.url() === api + '/auth/v1/otp');
  await page.getByRole('button', { name: 'Enviar codigo', exact: true }).click();
  expect((await sent).status()).toBe(200);
  await page.getByLabel('Codigo recibido').waitFor();
  const inbox = await (await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
  const mail = inbox.messages.find((m: any) => m.To?.some((t: any) => t.Address === f.email));
  expect(mail).toBeTruthy();
  const body = await (await page.request.get('http://127.0.0.1:55424/api/v1/message/' + mail.ID)).json();
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

async function state(page: Page) {
  return page.evaluate(async fixture => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const moneyPath = '/src/domain/money.ts'; const { parseCop } = await import(/* @vite-ignore */ moneyPath);
    const names = ['cycle_members', 'savings_contributions', 'loan_contracts', 'loan_payments', 'loan_payment_applications', 'polla_activities', 'polla_contributions', 'polla_prizes', 'member_capital_credits', 'bank_reconciliations', 'member_settlements', 'financial_operations', 'ledger_entries'];
    const tables: Record<string, any[]> = {};
    await Promise.all(names.map(async table => {
      const rows: any[] = []; let from = 0;
      for (;;) {
        const r = await supabase.from(table).select('*').eq('cycle_id', fixture.cycleId).order('id').range(from, from + 999);
        if (r.error) throw Error(table + ': ' + r.error.message);
        rows.push(...r.data); if (r.data.length < 1000) break; from += 1000;
      }
      tables[table] = rows;
    }));
    const sum = (rows: any[]) => rows.reduce((s, e) => s.plus(String(e.amount)), parseCop('0')).toFixed(2);
    const entries = tables.ledger_entries;
    const balances = Object.fromEntries([...new Set(entries.map(e => e.account))].map(a => [a, sum(entries.filter(e => e.account === a))]));
    const banks = Object.fromEntries([...new Set(entries.filter(e => e.bank_account_id).map(e => e.bank_account_id))].map(id => [id, sum(entries.filter(e => e.account === 'cash' && e.bank_account_id === id))]));
    const unbalanced = tables.financial_operations.filter(o => sum(entries.filter(e => e.operation_id === o.id)) !== '0.00').map(o => o.id);
    return { tables, balances, banks, unbalanced };
  }, f);
}

async function delta(page: Page, current: string | undefined, before: string | undefined) {
  return page.evaluate(async values => {
    const path = '/src/domain/money.ts'; const { parseCop } = await import(/* @vite-ignore */ path);
    return parseCop('0').plus(values.current ?? '0').minus(values.before ?? '0').toFixed(2);
  }, { current, before });
}
async function closed(sheet: Locator) { await expect(sheet).toHaveCount(0); }
async function createMember(page: Page, name: string, fixed = false) {
  await page.goto('/#/members');
  await page.getByRole('button', { name: 'Nuevo socio', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Nombre visible').fill(name);
  await sheet.getByLabel('Cuota mensual').fill('100000');
  await expect(sheet.getByLabel('Cuota mensual')).toHaveValue('100.000');
  if (fixed) await sheet.getByRole('button', { name: 'Solo ahorro 12 % EA', exact: true }).click();
  await sheet.getByRole('button', { name: 'Crear socio', exact: true }).click();
  await closed(sheet);
  const s = await state(page);
  const rows = await page.evaluate(async fixture => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const r = await supabase.from('members').select('id,display_name').eq('display_name', fixture.name);
    if (r.error) throw Error(r.error.message); return r.data;
  }, { name });
  expect(rows).toHaveLength(1);
  const participation = s.tables.cycle_members.find(m => m.member_id === rows[0].id);
  expect(participation).toBeTruthy();
  return participation.id as string;
}
async function contribution(page: Page, name: string, amount: string, month: string) {
  await page.goto('/#/savings');
  await page.getByRole('button', { name: 'Registrar aporte', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('combobox', { name: 'Socio del aporte', exact: true }).selectOption({ label: name });
  await sheet.getByLabel('Monto recibido').fill(amount);
  await sheet.getByLabel('Fecha efectiva').fill('2026-10-26');
  await sheet.getByRole('combobox', { name: 'Mes aplicado', exact: true }).selectOption(month);
  await sheet.getByRole('button', { name: 'Guardar aporte', exact: true }).click();
  await closed(sheet);
}

test('socios A/B, edición, aporte completo y parcial, polla y premio acreditado conservan fondos separados', async ({ page }, info) => {
  test.setTimeout(150_000);
  await login(page);
  const suffix = Date.now().toString(36);
  const name = 'Socio sintético A ' + suffix;
  const member = await createMember(page, name);
  await page.goto('/#/members');
  const row = page.locator(`[data-savings-member-row="${member}"]`);
  await row.getByRole('button', { name: 'Editar', exact: true }).click();
  const edit = page.getByRole('dialog');
  const updatedName = name + ' editado';
  await edit.getByLabel('Nombre visible').fill(updatedName);
  await edit.getByRole('button', { name: 'Actualizar socio', exact: true }).click();
  await closed(edit);
  await expect(row).toContainText(updatedName);
  await createMember(page, 'Socio sintético B ' + suffix, true);
  const before = await state(page);
  await contribution(page, updatedName, '100000', '10');
  await contribution(page, updatedName, '25000', '11');
  const saved = await state(page);
  expect(saved.tables.savings_contributions.filter(c => c.cycle_member_id === member).map(c => Number(c.amount)).sort((a, b) => a - b)).toEqual([25000, 100000]);
  expect(await delta(page, saved.balances.cash, before.balances.cash)).toBe('125000.00');
  await page.goto('/#/members');
  await expect(row).toContainText('125.000,00');
  await page.reload();
  await expect(row).toContainText(updatedName);
  await expect(row).toContainText('125.000,00');

  await page.goto('/#/polla');
  await page.getByRole('button', { name: 'Nueva polla', exact: true }).click();
  const sheet = page.getByRole('dialog');
  const activityName = 'Polla sintética ' + suffix;
  await sheet.getByLabel('Nombre actividad').fill(activityName);
  await sheet.getByRole('combobox', { name: 'Mes', exact: true }).selectOption('10');
  await sheet.getByRole('button', { name: 'Crear actividad', exact: true }).click();
  await closed(sheet);
  await page.getByRole('button', { name: 'Octubre', exact: true }).click();
  await page.getByRole('button', { name: activityName, exact: true }).click();
  const prePolla = await state(page);
  await page.getByRole('button', { name: 'Registrar aporte', exact: true }).click();
  await sheet.getByRole('combobox', { name: 'Participante', exact: true }).selectOption({ label: updatedName });
  await sheet.getByLabel('Aporte polla', { exact: true }).fill('10000');
  await sheet.getByLabel('Fecha aporte', { exact: true }).fill('2026-10-26');
  await sheet.getByRole('button', { name: 'Guardar aporte', exact: true }).click();
  await closed(sheet);
  await page.getByRole('button', { name: 'Asignar ganador', exact: true }).click();
  await sheet.getByRole('combobox', { name: 'Ganador', exact: true }).selectOption({ label: updatedName });
  await sheet.getByLabel('Premio bruto', { exact: true }).fill('10000');
  await sheet.getByLabel('Fecha premio', { exact: true }).fill('2026-10-26');
  await sheet.getByRole('button', { name: 'Asignar premio', exact: true }).click();
  await closed(sheet);
  const after = await state(page);
  expect(after.tables.polla_prizes.filter(p => p.winner_cycle_member_id === member)).toHaveLength(1);
  expect(after.tables.member_capital_credits.filter(c => c.cycle_member_id === member).map(c => Number(c.amount))).toEqual([5000]);
  expect(await delta(page, after.balances.cash, prePolla.balances.cash)).toBe('10000.00');
  expect(await delta(page, after.balances.admin_payable, prePolla.balances.admin_payable)).toBe('-5000.00');
  expect(after.tables.savings_contributions.filter(c => c.cycle_member_id === member)).toHaveLength(2);
  expect(after.unbalanced).toEqual([]);
  await page.reload();
  await expect(page.locator('[data-prize-row]').filter({ hasText: updatedName }).first()).toContainText('5.000');
  await page.screenshot({ path: info.outputPath('polla-capital-and-commission.png'), fullPage: true });
});

test('contrato fijo real, desembolso, interés recibido en efectivo y anulación restauran cartera y utilidad', async ({ page }) => {
  test.setTimeout(120_000); await login(page);
  const name = 'Deudor sintético ' + Date.now().toString(36);
  await page.goto('/#/loans');
  await page.getByRole('button', { name: 'Nuevo préstamo', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('combobox', { name: 'Socio deudor', exact: true }).selectOption('');
  await sheet.getByLabel('Deudor externo', { exact: true }).fill(name);
  await sheet.getByLabel('Principal', { exact: true }).fill('100000');
  await sheet.getByRole('combobox', { name: 'Método', exact: true }).selectOption('fixed_interest');
  await sheet.getByRole('combobox', { name: 'Base tasa', exact: true }).selectOption('MONTHLY_FIXED');
  await sheet.getByLabel('Tasa %', { exact: true }).fill('5');
  await sheet.getByLabel('Plazo meses', { exact: true }).fill('2');
  await sheet.getByLabel('Fecha desembolso', { exact: true }).fill('2026-09-01');
  const before = await state(page);
  await sheet.getByRole('button', { name: 'Crear contrato', exact: true }).click(); await closed(sheet);
  const created = await state(page);
  expect(created.balances).toEqual(before.balances);
  const contract = created.tables.loan_contracts.find(l => l.external_borrower_name === name);
  expect(contract.status).toBe('draft'); expect(contract.id).not.toBe(f.loanId);
  const row = page.locator(`[data-loan-row="${contract.id}"]`);
  await row.getByRole('button', { name: 'Desembolsar', exact: true }).click();
  await sheet.getByRole('button', { name: 'Confirmar desembolso', exact: true }).click(); await closed(sheet);
  const disbursed = await state(page);
  expect(await delta(page, disbursed.balances.cash, before.balances.cash)).toBe('-100000.00');
  expect(await delta(page, disbursed.balances.loans_receivable, before.balances.loans_receivable)).toBe('100000.00');
  await row.getByRole('button', { name: 'Ver detalle', exact: true }).click();
  const detail = page.locator(`[data-loan-detail="${contract.id}"]`);
  await detail.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  await sheet.getByRole('button', { name: 'Otro monto', exact: true }).click();
  await sheet.getByRole('button', { name: 'Efectivo', exact: true }).click();
  await sheet.getByLabel('Pago', { exact: true }).fill('5000');
  await sheet.getByLabel('Capital', { exact: true }).fill('0');
  await sheet.getByLabel('Interés', { exact: true }).fill('5000');
  await sheet.getByLabel('Fecha del pago', { exact: true }).fill('2026-10-26');
  await sheet.getByLabel('Nota del pago').fill('Interés sintético documentado');
  await sheet.getByRole('button', { name: 'Registrar Pago', exact: true }).click(); await closed(sheet);
  const paid = await state(page);
  expect(await delta(page, paid.balances.cash, disbursed.balances.cash)).toBe('5000.00');
  expect(await delta(page, paid.balances.admin_payable, disbursed.balances.admin_payable)).toBe('-500.00');
  expect(await delta(page, paid.balances.member_loan_profit_fund, disbursed.balances.member_loan_profit_fund)).toBe('-4500.00');
  expect(paid.banks).toEqual(disbursed.banks);
  expect(paid.tables.loan_payments.filter(p => p.loan_id === contract.id)).toHaveLength(1);
  await page.reload();
  await page.locator(`[data-loan-row="${contract.id}"]`).getByRole('button', { name: 'Ver detalle', exact: true }).click();
  await expect(detail).toContainText('Interés sintético documentado');
  await detail.locator('[data-loan-payment-row]').getByRole('button', { name: 'Anular', exact: true }).click();
  await sheet.getByLabel('Motivo').fill('Reverso sintético de prueba');
  await sheet.getByRole('button', { name: 'Confirmar anulación', exact: true }).click(); await closed(sheet);
  const reversed = await state(page);
  expect(reversed.balances).toEqual(disbursed.balances);
  expect(reversed.unbalanced).toEqual([]);
  expect(reversed.tables.loan_payments.find(p => p.loan_id === contract.id).status).toBe('reversed');
});

test('banco: apertura, rendimiento neto, comisión, traslado y conciliación conservan liquidez y no crean ajustes', async ({ page }, info) => {
  test.setTimeout(120_000); await login(page);
  await page.goto('/#/more/bank');
  const bank = page.locator('section.bank-page');
  const accountName = 'Banco sintético ' + Date.now().toString(36);
  await bank.getByRole('button', { name: 'Nueva cuenta', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Nombre de la cuenta').fill(accountName);
  await sheet.getByLabel('Identificador', { exact: true }).fill('****0000');
  await sheet.getByRole('button', { name: 'Guardar cuenta', exact: true }).click(); await closed(sheet);
  await bank.getByRole('button', { name: accountName, exact: true }).click();
  const before = await state(page);
  async function operation(button: string, amountLabel: string, amount: string, confirm: string) {
    await bank.getByRole('button', { name: button, exact: true }).click();
    await sheet.getByLabel(amountLabel, { exact: true }).fill(amount);
    await sheet.getByLabel('Fecha', { exact: true }).fill('2026-10-26');
    await sheet.getByLabel('Referencia', { exact: true }).fill('Operación bancaria sintética documentada');
    await sheet.getByRole('button', { name: confirm, exact: true }).click(); await closed(sheet);
  }
  await operation('Saldo inicial', 'Monto', '1000000', 'Registrar saldo inicial');
  await bank.getByRole('button', { name: 'Intereses', exact: true }).click();
  await sheet.getByLabel('Interés bruto', { exact: true }).fill('10000');
  await sheet.getByLabel('Retención en la fuente', { exact: true }).fill('500');
  await sheet.getByLabel('Comisión sobre intereses', { exact: true }).fill('100');
  await sheet.getByLabel('Fecha', { exact: true }).fill('2026-10-26');
  await sheet.getByRole('button', { name: 'Registrar intereses', exact: true }).click(); await closed(sheet);
  await operation('Comisión', 'Monto', '1000', 'Registrar comisión');
  const preTransfer = await state(page);
  await operation('Mover entre banco y efectivo', 'Monto', '100000', 'Registrar traslado');
  const transferred = await state(page);
  expect(transferred.balances).toEqual(preTransfer.balances);
  expect(await delta(page, transferred.balances.cash, before.balances.cash)).toBe('1008400.00');
  const newBankId = Object.keys(transferred.banks).find(id => !(id in before.banks))!;
  expect(newBankId).toBeTruthy(); expect(transferred.banks[newBankId]).toBe('908400.00');
  await bank.getByRole('button', { name: 'Conciliar', exact: true }).click();
  await sheet.getByLabel('Fecha del corte', { exact: true }).fill('2026-10-26');
  await sheet.getByLabel('Saldo del extracto', { exact: true }).fill('908000');
  await sheet.getByLabel('Saldo inicial verificado', { exact: true }).fill('1000000');
  await sheet.getByLabel('Fecha del saldo inicial', { exact: true }).fill('2026-10-26');
  await sheet.getByRole('button', { name: 'Guardar conciliación', exact: true }).click(); await closed(sheet);
  const after = await state(page);
  expect(after.balances).toEqual(transferred.balances);
  expect(after.tables.financial_operations.length).toBe(transferred.tables.financial_operations.length);
  const reconciliation = after.tables.bank_reconciliations.find(r => r.bank_account_id === newBankId);
  expect(Number(reconciliation.difference_amount)).toBe(-400);
  expect(after.unbalanced).toEqual([]);
  await page.reload();
  await bank.getByRole('button', { name: accountName, exact: true }).click();
  await expect(bank.locator('[data-reconciliation-row]').first()).toContainText('400');
  await page.screenshot({ path: info.outputPath('bank-reconciled-difference.png'), fullPage: true });
});

test('cuenta final de socio sintético separa confirmación y salida real de banco', async ({ page }) => {
  test.setTimeout(120_000); await login(page);
  const name = 'Retiro sintético ' + Date.now().toString(36);
  const member = await createMember(page, name, true);
  await contribution(page, name, '200000', '10');
  await page.goto('/#/more/settlements');
  await page.locator(`[data-settlement-member="${member}"]`).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Fecha de corte', { exact: true }).fill('2026-10-26');
  await sheet.getByRole('button', { name: 'Calcular', exact: true }).click();
  await expect(sheet.getByRole('button', { name: 'Confirmar cuenta final', exact: true })).toBeEnabled();
  const before = await state(page);
  await sheet.getByRole('button', { name: 'Confirmar cuenta final', exact: true }).click();
  await expect(sheet.getByRole('button', { name: /^Pagar \$/ })).toBeVisible();
  const confirmed = await state(page);
  expect(confirmed.balances.cash).toBe(before.balances.cash);
  const settlement = confirmed.tables.member_settlements.find(s => s.cycle_member_id === member);
  expect(settlement.status).toBe('confirmed'); expect(Number(settlement.transfer_amount)).toBeGreaterThan(0);
  await sheet.getByRole('button', { name: 'Banco', exact: true }).click();
  await sheet.getByRole('combobox', { name: 'Cuenta', exact: true }).selectOption(f.bankId);
  await sheet.getByLabel('Referencia', { exact: true }).fill('Entrega sintética auditada');
  await sheet.getByRole('button', { name: /^Pagar \$/ }).click();
  await expect(sheet).toHaveCount(0);
  const paid = await state(page);
  expect(await delta(page, confirmed.balances.cash, paid.balances.cash)).toBe(Number(settlement.transfer_amount).toFixed(2));
  expect(await delta(page, confirmed.banks[f.bankId], paid.banks[f.bankId])).toBe(Number(settlement.transfer_amount).toFixed(2));
  expect(paid.tables.member_settlements.find(s => s.id === settlement.id).status).toBe('paid');
  expect(paid.unbalanced).toEqual([]);
  await page.reload();
  await expect(page.locator(`[data-settlement-member="${member}"]`)).toContainText('Pagada');
});

for (const width of [320, 768, 1440]) test('todas las superficies mantienen navegación y coherencia sin desbordamiento a ' + width, async ({ page }, info) => {
  test.setTimeout(150_000); await page.setViewportSize({ width, height: 900 }); await login(page);
  const before = await state(page);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  for (const route of ['home', 'members', 'savings', 'loans', 'polla', 'more', 'more/bank', 'more/movements', 'more/yield', 'more/admin', 'more/settlements', 'more/profit', 'more/exports', 'more/stats']) {
    await page.goto('/#/' + route);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: route + ' horizontal overflow' }).toBeLessThanOrEqual(1);
    expect(new URL(page.url()).hash).toBe('#/' + route);
  }
  const navigation = page.getByRole('navigation', { name: 'Secciones principales' });
  for (const label of ['Inicio', 'Socios', 'Ahorros', 'Préstamos', 'Más']) {
    const button = navigation.getByRole('button', { name: label, exact: true });
    expect(await button.evaluate(node => {
      const rect = node.getBoundingClientRect();
      const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return rect.width > 0 && rect.height > 0 && !!target && (target === node || node.contains(target));
    }), 'Navigation hit target: ' + label).toBe(true);
    await button.click();
    await expect(page.locator('main').getByRole('heading').first()).toBeVisible();
  }
  await page.getByRole('navigation', { name: 'Secciones de mas opciones' }).getByRole('button', { name: 'Movimientos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Movimientos financieros', exact: true })).toBeVisible();
  await page.reload();
  const after = await state(page);
  expect(after.balances).toEqual(before.balances);
  expect(after.tables.financial_operations.length).toBe(before.tables.financial_operations.length);
  expect(after.unbalanced).toEqual([]); expect(errors).toEqual([]);
  await expect(page.getByRole('heading', { name: 'Movimientos financieros', exact: true })).toBeVisible();
  for (const amount of await page.locator('.flow-totals strong').all()) {
    expect(await amount.evaluate(node => {
      const range = document.createRange(); range.selectNodeContents(node);
      return range.getClientRects().length;
    }), 'Los totales monetarios deben conservar una sola línea').toBe(1);
  }
  await page.screenshot({ path: info.outputPath('surface-' + width + '.png'), fullPage: true });
});

test('correcciones de ahorro y polla: reversos por UI neutralizan importes y cancelan actividad sin borrar historia', async ({ page }, info) => {
  test.setTimeout(150_000);
  await login(page);
  const name = 'Correcciones sintéticas ' + crypto.randomUUID().slice(0, 8);
  const member = await createMember(page, name);
  const before = await state(page);
  await contribution(page, name, '10000', '10');
  const saved = await state(page);
  const saving = saved.tables.savings_contributions.find(c => c.cycle_member_id === member);
  expect(saving).toBeTruthy();
  const history = page.locator(`[data-savings-contribution-row="${saving.id}"]`);
  await history.getByRole('button').first().click();
  await history.getByRole('button', { name: 'Anular', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Motivo', { exact: true }).fill('Reverso sintético de aporte');
  await dialog.getByRole('button', { name: 'Confirmar anulación', exact: true }).click();
  await closed(dialog);
  let current = await state(page);
  expect(current.tables.savings_contributions.find(c => c.id === saving.id).status).toBe('reversed');
  expect(await delta(page, current.balances.cash, before.balances.cash)).toBe('0.00');
  expect(await delta(page, current.balances.savings_liability, before.balances.savings_liability)).toBe('0.00');

  const activityName = 'Polla corregida ' + crypto.randomUUID().slice(0, 8);
  await page.goto('/#/polla');
  await page.getByRole('button', { name: 'Nueva polla', exact: true }).click();
  await dialog.getByLabel('Nombre actividad').fill(activityName);
  await dialog.getByRole('combobox', { name: 'Mes', exact: true }).selectOption('10');
  await dialog.getByRole('button', { name: 'Crear actividad', exact: true }).click(); await closed(dialog);
  await page.getByRole('button', { name: 'Octubre', exact: true }).click();
  await page.getByRole('button', { name: activityName, exact: true }).click();
  await page.getByRole('button', { name: 'Registrar aporte', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Participante', exact: true }).selectOption({ label: name });
  await dialog.getByLabel('Aporte polla', { exact: true }).fill('10000');
  await dialog.getByRole('button', { name: 'Guardar aporte', exact: true }).click(); await closed(dialog);
  await page.getByRole('button', { name: 'Asignar ganador', exact: true }).click();
  await dialog.getByRole('combobox', { name: 'Ganador', exact: true }).selectOption({ label: name });
  await dialog.getByLabel('Premio bruto', { exact: true }).fill('10000');
  await dialog.getByRole('button', { name: 'Asignar premio', exact: true }).click(); await closed(dialog);
  current = await state(page);
  const prize = current.tables.polla_prizes.find(p => p.winner_cycle_member_id === member);
  expect(prize).toBeTruthy();
  await page.locator(`[data-prize-row="${prize.id}"]`).getByRole('button', { name: 'Anular premio', exact: true }).click();
  await dialog.getByLabel('Motivo', { exact: true }).fill('Reverso sintético del premio y comisión');
  await dialog.getByRole('button', { name: 'Confirmar anulación', exact: true }).click(); await closed(dialog);
  current = await state(page);
  expect(current.tables.polla_prizes.find(p => p.id === prize.id).status).toBe('reversed');
  expect(current.tables.member_capital_credits.filter(c => c.cycle_member_id === member && !c.reversed_at)).toHaveLength(0);
  expect(await delta(page, current.balances.admin_payable, before.balances.admin_payable)).toBe('0.00');
  await page.getByText(/^Aportes registrados \(/).click();
  await page.locator('.polla-contribution-history').getByRole('button', { name: 'Anular', exact: true }).click();
  await dialog.getByLabel('Motivo', { exact: true }).fill('Reverso sintético de aporte de polla');
  await dialog.getByRole('button', { name: 'Confirmar anulación', exact: true }).click(); await closed(dialog);
  await page.getByRole('button', { name: 'Cancelar polla', exact: true }).click();
  await dialog.getByLabel('Motivo', { exact: true }).fill('Actividad sintética cancelada sin efectos vigentes');
  await dialog.getByRole('button', { name: 'Confirmar cancelación', exact: true }).click(); await closed(dialog);
  await page.reload();
  await expect(page.getByRole('button', { name: activityName, exact: true })).toHaveCount(0);
  const after = await state(page);
  for (const account of new Set([...Object.keys(before.balances), ...Object.keys(after.balances)])) {
    expect(await delta(page, after.balances[account], before.balances[account]), account).toBe('0.00');
  }
  expect(after.unbalanced).toEqual([]);
  expect(after.tables.savings_contributions.find(c => c.id === saving.id)).toBeTruthy();
  expect(after.tables.polla_prizes.find(p => p.id === prize.id)).toBeTruthy();
  await info.attach('reversos-sinteticos', { body: JSON.stringify({ saving: saving.id, prize: prize.id, netChange: '0.00', unbalanced: after.unbalanced.length, historyPreserved: true }, null, 2), contentType: 'application/json' });
});

test('amortizado EA: parcial de interés, cuota mixta y cancelación usan aplicaciones y causación fechada', async ({ page }, info) => {
  test.setTimeout(150_000); await login(page);
  const before = await state(page), name = 'Amortizado sintético ' + crypto.randomUUID().slice(0, 8);
  await page.goto('/#/loans');
  await page.getByRole('button', { name: 'Nuevo préstamo', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByLabel('Deudor externo', { exact: true }).fill(name);
  await sheet.getByLabel('Principal', { exact: true }).fill('60000');
  await sheet.getByRole('combobox', { name: 'Método', exact: true }).selectOption('amortized');
  await sheet.getByRole('combobox', { name: 'Base tasa', exact: true }).selectOption('EA');
  await sheet.getByLabel('Tasa %', { exact: true }).fill('12');
  await sheet.getByLabel('Plazo meses', { exact: true }).fill('2');
  await sheet.getByLabel('Fecha desembolso', { exact: true }).fill('2026-09-01');
  await sheet.getByRole('button', { name: 'Crear contrato', exact: true }).click(); await closed(sheet);
  const loan = (await state(page)).tables.loan_contracts.find(l => l.external_borrower_name === name);
  const card = page.locator(`[data-loan-row="${loan.id}"]`);
  await card.getByRole('button', { name: 'Desembolsar', exact: true }).click();
  await sheet.getByRole('button', { name: 'Confirmar desembolso', exact: true }).click(); await closed(sheet);
  await card.getByRole('button', { name: 'Ver detalle', exact: true }).click();
  const detail = page.locator(`[data-loan-detail="${loan.id}"]`);
  await detail.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  await sheet.getByRole('button', { name: 'Efectivo', exact: true }).click();
  await sheet.getByRole('button', { name: 'Otro monto', exact: true }).click();
  await sheet.getByLabel('Fecha del pago', { exact: true }).fill('2026-10-26');
  await sheet.getByLabel('Pago', { exact: true }).fill('100');
  await expect(sheet.getByLabel('Capital', { exact: true })).toHaveValue('0');
  await expect(sheet.getByLabel('Interés', { exact: true })).toHaveValue('100');
  await expect(sheet.getByLabel('Capital', { exact: true })).toHaveAttribute('readonly', '');
  await sheet.getByRole('button', { name: 'Registrar Pago', exact: true }).click(); await closed(sheet);
  let current = await state(page);
  expect(current.tables.loan_payments.filter(p => p.loan_id === loan.id)).toHaveLength(1);
  await detail.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  await expect(sheet.getByLabel('Pago', { exact: true })).toHaveValue('29.900');
  await expect(sheet.getByLabel('Capital', { exact: true })).toHaveValue('29.438,51');
  await expect(sheet.getByLabel('Interés', { exact: true })).toHaveValue('461,49');
  await sheet.getByRole('button', { name: 'Registrar Pago', exact: true }).click(); await closed(sheet);
  current = await state(page);
  expect(current.tables.loan_payment_applications.filter(a => a.loan_id === loan.id).reduce((s, a) => s.plus(a.capital_amount).plus(a.interest_amount), new Decimal(0)).toFixed(2)).toBe('30000.00');
  const quoteResponse = page.waitForResponse(r => r.url().endsWith('/rpc/quote_loan_prepayment'));
  await detail.getByRole('button', { name: 'Pagar todo', exact: true }).click();
  const quote = await (await quoteResponse).json();
  expect(quote.quote_date).toBe('2026-10-26');
  expect(new Decimal(quote.principal_due).toFixed(2)).toBe('30561.49');
  const expectedInterest = await page.evaluate(async () => {
    const path = '/src/domain/loanFinance.ts'; const { calculateEaInterest } = await import(/* @vite-ignore */ path);
    return calculateEaInterest({ principal: '60000', annualEffectiveRate: '0.12', fromDate: '2026-10-01', toDate: '2026-10-26' }).cents.toFixed(2);
  });
  expect(new Decimal(quote.interest_due).toFixed(2)).toBe(expectedInterest);
  await sheet.getByRole('button', { name: 'Confirmar pago total', exact: true }).click(); await closed(sheet);
  await page.reload(); current = await state(page);
  const receipts = current.tables.loan_payments.filter(p => p.loan_id === loan.id && p.status === 'posted');
  expect(receipts).toHaveLength(3);
  expect(receipts.reduce((s, p) => s.plus(p.capital_amount), new Decimal(0)).toFixed(2)).toBe('60000.00');
  expect(await delta(page, current.balances.loans_receivable, before.balances.loans_receivable)).toBe('0.00');
  expect(await delta(page, current.balances.cash, before.balances.cash)).toBe(receipts.reduce((s, p) => s.plus(p.interest_amount), new Decimal(0)).toFixed(2));
  expect(current.tables.loan_contracts.find(l => l.id === loan.id).status).toBe('paid');
  expect(current.unbalanced).toEqual([]);
  await info.attach('amortizado-causacion', { body: JSON.stringify({ quote, expectedInterest, capitalSatisfied: '60000.00', unbalanced: 0 }, null, 2), contentType: 'application/json' });
});
