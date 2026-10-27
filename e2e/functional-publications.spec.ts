import { expect, test, type Download, type Page } from './test-fixtures';
import { readFileSync } from 'node:fs';
import Decimal from 'decimal.js';
import Papa from 'papaparse';
import { startAuditTrace, finishAuditTrace } from './audit-safe-trace';

const api = 'http://127.0.0.1:55421', app = 'http://127.0.0.1:5198', mailpit = 'http://127.0.0.1:55424';
let f: { email: string; cycleId: string; workspaceId: string; bankId: string; today: string };
test.beforeAll(() => { f = JSON.parse(readFileSync('incoming/functional-audit/fixture.json', 'utf8')); });
test.afterEach(async ({ page }, info) => { await finishAuditTrace(page, info); });
test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date(f.today + 'T17:00:00Z'));
  await page.route('**/*', async route => {
    const origin = new URL(route.request().url()).origin;
    if (![api, app, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(origin)) {
      await route.abort(); throw Error('Destino no autorizado en auditoría: ' + origin);
    }
    await route.fallback();
  });
});
async function login(page: Page) {
  await page.goto('/'); await page.getByLabel('Correo autorizado').fill(f.email);
  const sent = page.waitForResponse(response => response.url() === api + '/auth/v1/otp');
  await page.getByRole('button', { name: 'Enviar codigo', exact: true }).click(); expect((await sent).status()).toBe(200);
  await page.getByLabel('Codigo recibido').waitFor();
  const inbox = await (await page.request.get(mailpit + '/api/v1/messages')).json();
  const mail = inbox.messages.find((item: any) => item.To?.some((to: any) => to.Address === f.email)); expect(mail).toBeTruthy();
  const body = await (await page.request.get(mailpit + '/api/v1/message/' + encodeURIComponent(mail.ID))).json();
  const code = (String(body.Text ?? '') + String(body.HTML ?? '')).match(/\b\d{6}\b/)?.[0]; expect(code).toBeTruthy();
  await page.getByLabel('Codigo recibido').fill(code!); await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible();
  expect(await page.evaluate(async () => { const path = '/src/lib/supabase.ts'; return (await import(/* @vite-ignore */ path)).supabase.supabaseUrl; })).toBe(api);
  await startAuditTrace(page);
}
async function state(page: Page) {
  return page.evaluate(async fixture => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const tables: Record<string, any[]> = {};
    for (const table of ['cycles', 'financial_operations', 'ledger_entries', 'loan_payments']) {
      const rows: any[] = [];
      for (let from = 0;; from += 1000) {
        const r = await supabase.from(table).select('*').eq('workspace_id', fixture.workspaceId).order('id').range(from, from + 999);
        if (r.error) throw Error(table + ': ' + r.error.message);
        rows.push(...r.data); if (r.data.length < 1000) break;
      }
      tables[table] = rows;
    }
    return tables;
  }, f);
}
function sum(rows: any[], account: string) { return rows.filter(row => row.account === account).reduce((total, row) => total.plus(String(row.amount)), new Decimal(0)); }
async function downloadText(download: Download) {
  const stream = await download.createReadStream(); expect(stream).toBeTruthy();
  const chunks: Buffer[] = []; for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

test('Administración: preview documentado, retiro sintético de 1.000 si está disponible y recarga coherente', async ({ page }, info) => {
  await login(page); const before = await state(page);
  const response = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/preview_admin_withdrawal');
  await page.goto('/#/more/admin');
  await expect(page.getByRole('heading', { name: 'Mi ganancia como administrador', exact: true })).toBeVisible();
  const reply = await response; expect(reply.ok()).toBe(true); const preview = await reply.json();
  expect(preview.reserve_through).toBe('2026-12-05');
  expect(new Decimal(String(preview.available)).gte(0)).toBe(true);
  await expect(page.getByText('Disponible para retirar', { exact: true })).toBeVisible();
  await info.attach('admin-preview', { body: JSON.stringify(preview, null, 2), contentType: 'application/json' });
  const open = page.getByRole('button', { name: 'Registrar retiro', exact: true });
  if (preview.needs_review || new Decimal(String(preview.available)).lt(1000)) {
    if (preview.needs_review) await expect(page.getByText('Hay obligaciones pendientes de conciliación. El retiro queda bloqueado.')).toBeVisible();
    if (new Decimal(String(preview.available)).lte(0)) await expect(open).toBeDisabled();
    expect(await state(page)).toEqual(before);
    await info.attach('retiro-no-ejecutado', { body: 'El preview real no acredita 1.000 disponibles sin pendientes. No se fabricó elegibilidad.', contentType: 'text/plain' });
    return;
  }
  await open.click(); const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Cancelar', exact: true }).click(); expect(await state(page)).toEqual(before);
  await open.click(); await sheet.getByLabel('Monto', { exact: true }).fill('1000');
  await expect(sheet.getByLabel('Monto', { exact: true })).toHaveValue('1.000');
  await sheet.getByLabel('Fecha', { exact: true }).fill('2026-10-26');
  await sheet.getByRole('button', { name: 'Banco', exact: true }).click();
  await sheet.getByRole('combobox', { name: 'Cuenta', exact: true }).selectOption(f.bankId);
  await sheet.getByLabel('Comprobante o detalle').fill('Retiro sintético auditoría funcional');
  const posted = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/withdraw_admin_payable');
  await sheet.getByRole('button', { name: 'Registrar retiro', exact: true }).click();
  const receipt = await posted; expect(receipt.ok()).toBe(true);
  expect(receipt.request().postDataJSON()).toMatchObject({ p_cycle_id: f.cycleId, p_amount: '1000.00', p_bank_account_id: f.bankId });
  await expect(sheet).toHaveCount(0); const after = await state(page);
  expect(sum(after.ledger_entries, 'cash').minus(sum(before.ledger_entries, 'cash')).toFixed(2)).toBe('-1000.00');
  expect(sum(after.ledger_entries, 'admin_payable').minus(sum(before.ledger_entries, 'admin_payable')).toFixed(2)).toBe('1000.00');
  expect(after.financial_operations.length).toBe(before.financial_operations.length + 1);
  await page.reload(); await expect(page.getByRole('heading', { name: 'Mi ganancia como administrador', exact: true })).toBeVisible();
  expect(await state(page)).toEqual(after);
});

test('Previews de reparto: cortes 26 oct/5 dic, bloqueo antes del cierre y ninguna publicación', async ({ page }, info) => {
  await login(page); const before = await state(page); const writes: string[] = [];
  page.on('request', request => { if (/\/rpc\/(confirm_|pay_)/.test(request.url())) writes.push(request.url()); });
  await page.goto('/#/more/yield');
  await expect(page.getByRole('heading', { name: 'Rendimientos bancarios', exact: true })).toBeVisible();
  for (const date of ['2026-10-26', '2026-12-05']) {
    await page.getByLabel('Fecha de corte', { exact: true }).fill(date);
    const waiting = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/preview_bank_yield_distribution');
    await page.getByRole('button', { name: 'Calcular reparto', exact: true }).click();
    const response = await waiting; expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toMatchObject({ p_cycle_id: f.cycleId, p_cut_date: date });
    await expect(page.getByRole('button', { name: 'Confirmar reparto', exact: true })).toBeDisabled();
    await expect(page.getByText(/Puedes simular antes, pero el reparto solo se confirma ese día/)).toBeVisible();
    await info.attach('banco-preview-' + date, { body: JSON.stringify(await response.json(), null, 2), contentType: 'application/json' });
  }
  await page.goto('/#/more/profit');
  await expect(page.getByRole('heading', { name: 'Ganancia de préstamos de los socios', exact: true })).toBeVisible();
  const periods = page.getByRole('button', { name: /^Calcular al / });
  if (await periods.count()) {
    const waiting = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/preview_loan_profit_periods');
    await periods.click(); const response = await waiting; expect(response.ok()).toBe(true);
    expect(response.request().postDataJSON()).toMatchObject({ p_cut_date: '2026-12-05' });
    await expect(page.getByRole('button', { name: 'Confirmar reparto', exact: true })).toBeDisabled();
    await expect(page.getByText(/^Se confirma el /)).toBeVisible();
  } else {
    // A cycle without activated rules must retain that fact; this test never approves a policy.
    await expect(page.getByRole('heading', { name: 'Ganancia de préstamos de los socios', exact: true })).toBeVisible();
    await expect(page.getByLabel('Nombre de las reglas')).toBeVisible();
    const calculate = page.getByRole('button', { name: 'Calcular reparto', exact: true });
    const waiting = page.waitForResponse(r => r.url() === api + '/rest/v1/rpc/preview_loan_profit_distribution');
    await calculate.click();
    const response = await waiting; expect(response.ok()).toBe(true);
    const preview = await response.json();
    expect(preview.policy_approved).toBe(false);
    expect(preview.confirmation_allowed).toBe(false);
    await expect(page.getByText('Primero aprueba las reglas del reparto.', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirmar reparto', exact: true })).toBeDisabled();
    await info.attach('utilidad-sin-politica', { body: 'UI conserva reglas no activadas; no se aprobó política ni se fabricaron beneficiarios.', contentType: 'text/plain' });
  }
  // Read-only endpoint supports current-cut comparison even when the UI period control fixes the closing cut.
  const previews = await page.evaluate(async fixture => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const results = [];
    for (const cut of ['2026-10-26', '2026-12-05']) {
      const r = await supabase.rpc('preview_loan_profit_periods', { p_cycle_id: fixture.cycleId, p_cut_date: cut });
      results.push({ cut, data: r.data, error: r.error ? { code: r.error.code, message: r.error.message } : null });
    }
    return results;
  }, f);
  for (const preview of previews) {
    expect(preview.error, 'Read-only profit preview must be available for ' + preview.cut).toBeNull();
    expect(preview.data).toBeTruthy();
  }
  await info.attach('utilidad-previews-readonly', { body: JSON.stringify(previews, null, 2), contentType: 'application/json' });
  expect(writes).toEqual([]); expect(await state(page)).toEqual(before);
});

test('Descargas reales JSON workspace.v3 y CSV; todos los ciclos, notas y saldos preservados; estadísticas/movimientos', async ({ page }, info) => {
  await login(page); const before = await state(page);
  await page.goto('/#/more/exports'); await expect(page.getByRole('heading', { name: 'Respaldos', exact: true })).toBeVisible();
  const jsonReady = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar respaldo', exact: true }).click();
  const jsonDownload = await jsonReady; expect(jsonDownload.suggestedFilename()).toMatch(/respaldo-abcd\.json$/);
  const backup = JSON.parse(await downloadText(jsonDownload));
  expect(backup.format).toBe('natillera-manager.workspace.v3'); expect(backup.workspace_id).toBe(f.workspaceId);
  expect(backup.tables.cycles.map((row: any) => row.id).sort()).toEqual(before.cycles.map(row => row.id).sort());
  expect(backup.counts.cycles).toBe(before.cycles.length);
  expect(backup.tables.ledger_entries).toEqual(before.ledger_entries);
  expect(before.loan_payments.some(row => row.note), 'The earlier payment scenario must supply a real synthetic note to verify').toBe(true);
  for (const payment of before.loan_payments) {
    const saved = backup.tables.loan_payments.find((row: any) => row.id === payment.id);
    expect(saved).toBeTruthy(); expect(saved.note ?? null).toBe(payment.note ?? null);
  }
  const csvReady = page.waitForEvent('download'); await page.getByRole('button', { name: 'Descargar reporte CSV', exact: true }).click();
  const csvDownload = await csvReady; expect(csvDownload.suggestedFilename()).toMatch(/reporte\.csv$/);
  const csv = Papa.parse<Record<string, string>>(await downloadText(csvDownload), { header: true, skipEmptyLines: true });
  expect(csv.errors).toEqual([]); expect(csv.meta.fields).toEqual(['seccion', 'id', 'nombre_o_tipo', 'fecha', 'monto', 'estado', 'detalle']);
  const currentEntries = before.ledger_entries.filter(row => row.cycle_id === f.cycleId);
  expect(csv.data.filter(row => row.seccion === 'partidas').map(row => row.id).sort()).toEqual(currentEntries.map(row => row.id).sort());
  await info.attach('inventario-exportado', { body: JSON.stringify({ format: backup.format, cycles: backup.tables.cycles.map((row: any) => row.id), notes: before.loan_payments.filter(row => row.note).length, csvRows: csv.data.length }, null, 2), contentType: 'application/json' });
  await page.goto('/#/more/stats'); await expect(page.getByRole('heading', { name: 'Distribución del dinero', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /^Ver toda/ }).click();
  await expect(page.getByRole('heading', { name: 'Movimientos financieros', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Banco', exact: true }).click();
  await page.getByRole('button', { name: 'Todo', exact: true }).click();
  await page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('button', { name: 'Inicio', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible();
  expect(await state(page)).toEqual(before);
});

test('reglas clásicas sintéticas: aprobar, reservar, confirmar y pagar una sola vez conserva asignaciones', async ({ page }, info) => {
  test.setTimeout(120_000); await login(page);
  const before = await state(page);
  await page.goto('/#/more/profit');
  const version = 'qa-sintetica-' + crypto.randomUUID().slice(0, 8);
  await page.getByLabel('Nombre de las reglas').fill(version);
  await page.getByLabel('Descripción', { exact: true }).fill('Política exclusivamente sintética de auditoría; no autoriza uso operativo.');
  await page.getByLabel('Costos', { exact: true }).fill('500');
  await page.getByLabel('Reserva', { exact: true }).fill('1000');
  await page.getByRole('button', { name: 'Aprobar reglas', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aprobar reglas', exact: true })).toHaveCount(0);
  expect(await state(page)).toEqual(before);
  const previewReady = page.waitForResponse(r => r.url().endsWith('/rpc/preview_loan_profit_distribution'));
  await page.getByRole('button', { name: 'Calcular reparto', exact: true }).click();
  const preview = await (await previewReady).json();
  expect(preview.policy_approved).toBe(true); expect(preview.confirmation_allowed).toBe(true);
  const confirmedReady = page.waitForResponse(r => r.url().endsWith('/rpc/confirm_loan_profit_distribution'));
  await page.getByRole('button', { name: 'Confirmar reparto', exact: true }).click();
  expect((await confirmedReady).ok()).toBe(true);
  await expect(page.getByRole('button', { name: new RegExp('^Pagar .*' + version + '$') })).toBeVisible();
  const confirmed = await state(page);
  expect(sum(confirmed.ledger_entries, 'cash').toFixed(2)).toBe(sum(before.ledger_entries, 'cash').toFixed(2));
  await page.getByRole('button', { name: new RegExp('^Pagar .*' + version + '$') }).click();
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('button', { name: 'Banco', exact: true }).click();
  await sheet.getByRole('combobox', { name: 'Cuenta', exact: true }).selectOption(f.bankId);
  await sheet.getByLabel('Referencia', { exact: true }).fill('Pago sintético de política clásica');
  const paidReady = page.waitForResponse(r => r.url().endsWith('/rpc/pay_loan_profit_distribution'));
  await sheet.getByRole('button', { name: 'Registrar pago', exact: true }).click();
  const paidResponse = await paidReady; expect(paidResponse.ok()).toBe(true);
  await expect(sheet).toHaveCount(0);
  const snapshot = await page.evaluate(async fixture => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const read = async (table: string) => {
      const r = await supabase.from(table).select('*').eq('cycle_id', fixture.cycleId).order('id');
      if (r.error) throw Error(r.error.message); return r.data;
    };
    return { distributions: await read('loan_profit_distributions'), allocations: await read('loan_profit_distribution_allocations'), payments: await read('loan_profit_distribution_payments') };
  }, f);
  const distribution = snapshot.distributions.find((d: any) => d.policy_version === version);
  expect(distribution.status).toBe('paid');
  const allocations = snapshot.allocations.filter((a: any) => a.distribution_id === distribution.id);
  const assigned = allocations.reduce((s: Decimal, a: any) => s.plus(a.amount), new Decimal(0));
  expect(assigned.plus(distribution.snapshot.rounding_residual).toFixed(2)).toBe(new Decimal(distribution.distributable_amount).toFixed(2));
  expect(snapshot.payments.filter((p: any) => p.distribution_id === distribution.id)).toHaveLength(1);
  const paid = await state(page);
  expect(sum(confirmed.ledger_entries, 'cash').minus(sum(paid.ledger_entries, 'cash')).toFixed(2)).toBe(new Decimal(distribution.payment_amount).toFixed(2));
  const retryError = await page.evaluate(async payload => {
    const path = '/src/lib/supabase.ts'; const { supabase } = await import(/* @vite-ignore */ path);
    const r = await supabase.rpc('pay_loan_profit_distribution', payload); return r.error?.message ?? null;
  }, paidResponse.request().postDataJSON());
  expect(retryError).toBeNull();
  await page.reload(); expect(await state(page)).toEqual(paid);
  await info.attach('politica-clasica-sintetica', { body: JSON.stringify({ version, preview, assigned: assigned.toFixed(2), payment: distribution.payment_amount, payments: 1 }, null, 2), contentType: 'application/json' });
});
