import { readFileSync } from 'node:fs';
const fixture = JSON.parse(readFileSync('incoming/reconciliation-synthetic-2026-10-17/fixture.json', 'utf8')) as { cycleId: string; email: string };
import { expect, test, type Page } from '@playwright/test';
const app = 'http://127.0.0.1:5198', api = 'http://127.0.0.1:55421';
const faults = new WeakMap<Page, string[]>();
const tracing = new WeakSet<Page>();
test.beforeEach(async ({ page }) => {
  const list: string[] = []; faults.set(page, list);
  page.on('pageerror', error => list.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) list.push(message.text()); });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([app, api, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin)) return route.continue();
    return route.abort();
  });
});
test.afterEach(async ({ page, context }, info) => { if (tracing.has(page)) await context.tracing.stop({ path: info.outputPath('trace.zip') }); expect(faults.get(page)).toEqual([]); });
async function login(page: Page) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Correo autorizado').fill(fixture.email);
  const otp = page.waitForResponse(response => response.url() === api + '/auth/v1/otp');
  await page.getByRole('button', { name: 'Enviar codigo', exact: true }).click(); expect((await otp).status()).toBe(200);
  await page.getByLabel('Codigo recibido').waitFor();
  const inbox = await (await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
  const mail = inbox.messages.find((m: { To?: { Address: string }[] }) => m.To?.some(to => to.Address === fixture.email));
  const body = await (await page.request.get('http://127.0.0.1:55424/api/v1/message/' + encodeURIComponent(mail.ID))).json();
  const token = `${body.Text ?? ''}\n${body.HTML ?? ''}`.match(/\b\d{6}\b/)?.[0]; expect(token).toBeTruthy();
  await page.getByLabel('Codigo recibido').fill(token!); await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible();
  // A read from the real browser client proves the destination before any mutation.
  const destination = await page.evaluate(async () => { const { supabase } = await import('/src/lib/supabase.ts'); return (supabase as unknown as { supabaseUrl: string }).supabaseUrl; });
  expect(destination).toBe(api);
  await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true }); tracing.add(page);
}
async function bank(page: Page) {
  await page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('navigation', { name: 'Secciones de mas opciones' }).getByRole('button', { name: 'Banco y caja', exact: true }).click();
}
async function count(page: Page, table: string) {
  return page.evaluate(async ({ table, cycleId }) => { const { supabase } = await import('/src/lib/supabase.ts'); const result = await supabase.from(table).select('*', { count: 'exact', head: true }).eq('cycle_id', cycleId); if (result.error) throw Error(result.error.message); return result.count; }, { table, cycleId: fixture.cycleId });
}
async function comparison(page: Page) {
  return page.evaluate(async cycleId => { const { statementComparison } = await import('/src/data/reconciliation.ts'); return statementComparison(cycleId); }, fixture.cycleId);
}

test('empty state and cancel preserve all financial records', async ({ page }) => {
  await login(page); await bank(page); const n = await count(page, 'financial_operations');
  await page.getByRole('button', { name: 'Comparar extracto', exact: true }).click();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click(); expect(await count(page, 'financial_operations')).toBe(n);
});
test('extract comparison persists on reload and creates no financial operation', async ({ page }) => {
  await login(page); await bank(page); const n = await count(page, 'financial_operations');
  await page.getByRole('button', { name: 'Comparar extracto', exact: true }).click();
  await page.getByLabel('Fecha del registro').fill('2026-10-17'); await page.getByLabel('Saldo del extracto').fill('121000');
  await page.getByLabel('Nota de la comparación').fill('Comparación sintética verificada');
  const response = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/record_bank_statement_check');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click(); expect((await response).status()).toBe(200);
  await expect(page.getByText('Registro guardado y consultado nuevamente en la base de datos.')).toBeVisible();
  expect(Number((await comparison(page)).difference)).toBe(0);
  expect(await count(page, 'financial_operations')).toBe(n);
  await page.reload(); await bank(page);
  expect((await comparison(page)).check?.note).toBe('Comparación sintética verificada');
  await expect(page.getByRole('article', { name: 'Cuadre' })).toHaveCount(0);
});
for (const width of [320, 390, 768, 1280]) test(`home and bank omit statement comparison at ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 1000 }); await login(page);
  for (const section of ['home', 'bank']) {
    if (section === 'bank') await bank(page);
    await expect(page.getByRole('article', { name: 'Cuadre' })).toHaveCount(0);
    await expect(page.getByText('Ver comparación con el último extracto registrado', { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Dinero personal por retirar|Diferencia con esa cuenta|Dinero disponible según la app al corte/)).toHaveCount(0);
    if(section==='bank')await page.getByText('Ver cálculo del dinero',{exact:true}).click();
    const card = section==='home' ? page.locator('[data-figure-key="dinero-en-caja"]') : page.getByRole('article', { name: 'Dinero de la natillera en el banco' });
    await expect(card).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await card.screenshot({ path: info.outputPath(section + '-bank-' + width + '.png') });
  }
});
test('fine credits administrator, survives reload and can be reversed', async ({ page }, info) => {
  await login(page); await bank(page); const n = await count(page, 'financial_operations');
  await page.getByRole('button', { name: 'Registrar multa recibida', exact: true }).click();
  await page.getByLabel('Fecha del registro').fill('2026-10-17'); await page.getByLabel('Valor de la multa').fill('1200'); await page.getByLabel('Motivo de la multa').fill('Incumplimiento sintético');
  const saved = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/record_admin_fine'); await page.getByRole('button', { name: 'Guardar registro', exact: true }).click(); expect((await saved).status()).toBe(200);
  await expect(page.getByText('Registro guardado y consultado nuevamente en la base de datos.')).toBeVisible(); expect(await count(page, 'financial_operations')).toBe(n! + 1);
  await page.reload(); await bank(page);
  await page.getByText('Ver cálculo del dinero',{exact:true}).click();
  for (const width of [320, 390, 768, 1280]) { await page.setViewportSize({ width, height: 1000 }); const card = page.getByRole('article', { name: 'Dinero de la natillera en el banco' }); await expect(card).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await card.screenshot({ path: info.outputPath(`cuadre-amber-${width}.png`) }); }
  await page.evaluate(async cycleId => { const { supabase } = await import('/src/lib/supabase.ts'); const result = await supabase.from('financial_operations').select('id').eq('cycle_id', cycleId).eq('operation_type', 'admin_fine_received').single(); if (result.error) throw Error(result.error.message); const entries = await supabase.from('ledger_entries').select('account,amount').eq('operation_id', result.data.id); if (entries.error) throw Error(entries.error.message); if (!entries.data.some(e => e.account === 'admin_payable' && Number(e.amount) === -1200) || entries.data.some(e => e.account === 'common_income')) throw Error('Fine routing mismatch'); const undo = await supabase.rpc('reverse_financial_operation', { p_operation_id: result.data.id, p_idempotency_key: 'browser-fine-undo', p_effective_date: '2026-10-17', p_reason: 'Fin de prueba sintética' }); if (undo.error) throw Error(undo.error.message); }, fixture.cycleId);
});
test('initial reconciliation confirms once, persists and uses atomic undo', async ({ page }, info) => {
  await login(page); await bank(page); const payments = await count(page, 'loan_payments');
  await page.getByRole('button', { name: 'Revisar saldo inicial' }).click(); await expect(page.getByRole('region', { name: 'Previsualización de conciliación' })).toContainText('Son 5 operaciones');
  await page.getByRole('button', { name: 'Ver operaciones y saldos' }).click(); await expect(page.getByText('Saldos antes y después')).toBeVisible();
  const saved = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/confirm_legacy_reconciliation'); await page.getByRole('button', { name: 'Confirmar revisión del saldo inicial' }).click(); expect((await saved).status()).toBe(200);
  await expect(page.getByText('Registro guardado y consultado nuevamente en la base de datos.')).toBeVisible(); expect(await count(page, 'loan_payments')).toBe(payments);
  const evidence = await page.evaluate(async cycleId => { const { supabase } = await import('/src/lib/supabase.ts'); const group = await supabase.from('legacy_reconciliations').select('snapshot,operation_ids').eq('cycle_id', cycleId).single(); if (group.error) throw Error(group.error.message); const ledger = await supabase.from('ledger_entries').select('account,amount,liquidity_location,operation_id').eq('cycle_id', cycleId); if (ledger.error) throw Error(ledger.error.message); return { preview: group.data.snapshot, created: group.data.operation_ids, actualLedgerAfterConfirm: ledger.data }; }, fixture.cycleId);
  await info.attach('synthetic-confirmed.json', { body: JSON.stringify(evidence, null, 2), contentType: 'application/json' });
  await page.reload(); await bank(page); await page.getByRole('button', { name: 'Revisar saldo inicial' }).click(); await expect(page.getByText('Esta conciliación ya está aplicada.')).toBeVisible();
  await page.getByLabel('Motivo para revertir conciliación').fill('Restituir escenario sintético');
  const undone = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/reverse_legacy_reconciliation'); await page.getByRole('button', { name: 'Anular conciliación completa' }).click(); expect((await undone).status()).toBe(200);
  await expect(page.getByText('Registro guardado y consultado nuevamente en la base de datos.')).toBeVisible(); await page.reload(); await bank(page); await page.getByRole('button', { name: 'Revisar saldo inicial' }).click(); await expect(page.getByText(/fue revertida/)).toBeVisible();
});

test('confirmed receipt keeps cents, preserves cash payment and leaves personal difference outside ledger', async ({ page }, info) => {
  await login(page); await bank(page);
  const result = await page.evaluate(async cycleId => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const loan = await supabase.from('loan_contracts').select('id,workspace_id').eq('cycle_id', cycleId).eq('legacy_id', 'SYN-01').single();
    if (loan.error) throw Error(loan.error.message);
    const bank = await supabase.from('bank_accounts').select('id').eq('workspace_id', loan.data.workspace_id).single();
    if (loan.error || bank.error) throw Error('Synthetic sources missing');
    const payment = await supabase.rpc('record_loan_payment', { p_loan_id: loan.data.id, p_idempotency_key: 'synthetic-cash-preserved', p_payment_date: '2026-10-15', p_amount: 1000, p_capital_amount: 0, p_interest_amount: 1000, p_kind: 'regular' });
    if (payment.error) throw Error(payment.error.message);
    const args = { p_cycle_id: cycleId, p_bank_account_id: bank.data.id, p_idempotency_key: 'synthetic-first-day-receipt', p_effective_date: '2026-10-01', p_gross_amount: 123.25, p_withholding_amount: 0, p_fee_amount: 0, p_reference: 'Abono bancario confirmado' };
    for (let i = 0; i < 2; i++) { const receipt = await supabase.rpc('record_bank_interest_received', args); if (receipt.error) throw Error(receipt.error.message); }
    const receipts = await supabase.from('bank_yield_receipts').select('id,effective_date,net_amount,state').eq('cycle_id', cycleId);
    if (receipts.error) throw Error(receipts.error.message);
    return { paymentId: payment.data.id, receipts: receipts.data };
  }, fixture.cycleId);
  expect(result.receipts).toHaveLength(1); expect(result.receipts[0]).toMatchObject({ effective_date: '2026-10-01', net_amount: 123.25, state: 'frozen' });
  const financialCount = await count(page, 'financial_operations');
  await page.getByRole('button', { name: 'Comparar extracto', exact: true }).click();
  await page.getByLabel('Fecha del registro').fill('2026-10-17'); await page.getByLabel('Saldo del extracto').fill('121.423,40');
  await page.getByLabel('Nota de la comparación').fill('Dinero personal por retirar; importe por verificar');
  const saved = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/record_bank_statement_check');
  await page.getByRole('button', { name: 'Guardar registro', exact: true }).click(); expect((await saved).status()).toBe(200);
  await expect(page.getByText('Registro guardado y consultado nuevamente en la base de datos.')).toBeVisible();
  await page.reload(); await bank(page);
  await page.getByText('Ver cálculo del dinero',{exact:true}).click();
  const card = page.getByRole('article', { name: 'Dinero de la natillera en el banco' });
  await expect(page.getByRole('article', { name: 'Cuadre' })).toHaveCount(0);
  await expect(page.getByText('Dinero personal por retirar; importe por verificar', { exact: true })).toHaveCount(0);
  expect(await count(page, 'financial_operations')).toBe(financialCount);
  const persisted = await page.evaluate(async ({ cycleId, paymentId }) => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const payment = await supabase.from('loan_payments').select('status,amount').eq('id', paymentId).single();
    const comparison = await supabase.rpc('preview_bank_statement_check', { p_cycle_id: cycleId });
    const rights = await supabase.from('bank_yield_rights').select('amount').eq('cycle_id', cycleId);
    if (payment.error || comparison.error || rights.error) throw Error('Persistence read failed');
    return { payment: payment.data, comparison: comparison.data, rights: rights.data };
  }, { cycleId: fixture.cycleId, paymentId: result.paymentId });
  expect(persisted.payment).toMatchObject({ status: 'posted', amount: 1000 });
  expect(persisted.comparison.check.note).toBe('Dinero personal por retirar; importe por verificar');
  expect(Number(persisted.comparison.account_balance)).toBe(121123.25);
  expect(Number(persisted.comparison.check.statement_balance)).toBe(121423.40);
  expect(Number(persisted.comparison.difference)).toBe(300.15); expect(Number(persisted.comparison.physical_cash)).toBe(1000);
  expect(persisted.rights.reduce((sum, r) => sum + Number(r.amount), 0)).toBeCloseTo(123.25, 2);
  await info.attach('synthetic-bank-cents.json', { body: JSON.stringify(persisted, null, 2), contentType: 'application/json' });
  for (const width of [320, 1280]) { await page.setViewportSize({ width, height: 1100 }); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await card.screenshot({ path: info.outputPath(`cuadre-cents-${width}.png`) }); }
});
