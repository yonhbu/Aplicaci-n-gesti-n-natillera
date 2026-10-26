import { expect, test, type Page } from '@playwright/test';

const api = 'http://127.0.0.1:55421';
const app = 'http://127.0.0.1:5188';
const email = 'qa-audit-2026@example.test';
const cycleId = 'a0150000-0000-4000-8000-000000000002';

async function login(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const allowed = [api, app, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'];
    if (!allowed.includes(url.origin)) return route.abort();
    return route.continue();
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByLabel('Correo autorizado').fill(email);
  const sent = page.waitForResponse((r) => r.url() === `${api}/auth/v1/otp`);
  await page.getByRole('button', { name: 'Enviar codigo' }).click();
  expect((await sent).status()).toBe(200);
  await page.getByLabel('Codigo recibido').waitFor();
  const inbox = await (await page.request.get('http://127.0.0.1:55424/api/v1/messages')).json();
  const message = inbox.messages.find((m: { To?: { Address: string }[] }) => m.To?.some((t) => t.Address === email));
  const detail = await (await page.request.get(`http://127.0.0.1:55424/api/v1/message/${encodeURIComponent(message.ID)}`)).json();
  const token = `${detail.Text ?? ''}\n${detail.HTML ?? ''}`.match(/\b\d{6}\b/)?.[0];
  expect(token).toBeTruthy();
  await page.getByLabel('Codigo recibido').fill(token!);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Inicio', exact: true })).toBeVisible();
}

// Polla es sección principal solo en escritorio (≥ 980 px); en móvil se llega desde Más → Polla.
async function goPolla(page: Page) {
  const nav = page.getByRole('navigation', { name: 'Secciones principales' });
  const direct = nav.getByRole('button', { name: 'Polla', exact: true });
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
    return;
  }
  await nav.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('navigation', { name: 'Secciones de mas opciones' }).getByRole('button', { name: 'Polla', exact: true }).click();
}

test('QA-002: previews work through the authenticated TEST API', async ({ page }) => {
  await login(page);
  const result = await page.evaluate(async (id) => {
    const modulePath = '/src/lib/supabase.ts';
    const { supabase } = await import(modulePath);
    const results = [];
    for (const name of ['preview_bank_yield_distribution', 'preview_loan_profit_periods']) {
      const response = await supabase.rpc(name, { p_cycle_id: id, p_cut_date: '2026-12-05' });
      results.push({ name, status: response.status, error: response.error?.message, hash: response.data?.preview_hash });
    }
    return results;
  }, cycleId);
  for (const response of result) {
    expect(response.status, `${response.name}: ${response.error}`).toBe(200);
    expect(response.hash).toMatch(/^[a-f0-9]{32}$/);
  }
});

test('QA-001: a fixed-yield member cannot register a new polla contribution', async ({ page }) => {
  await login(page);
  const result = await page.evaluate(async (id) => {
    const modulePath = '/src/lib/supabase.ts';
    const { supabase } = await import(modulePath);
    const fixed = await supabase.from('cycle_members').select('id').eq('cycle_id', id).eq('economic_mode', 'fixed_yield').limit(1).single();
    const activities = await supabase.from('polla_activities').select('id').eq('cycle_id', id).eq('name', 'QA Guard Regression');
    let activity = activities.data?.[0];
    if (!activity) {
      const created = await supabase.rpc('create_polla_activity', { p_cycle_id: id, p_period_year: 2026, p_period_month: 10, p_name: 'QA Guard Regression' });
      if (created.error) throw Error(created.error.message);
      activity = Array.isArray(created.data) ? created.data[0] : created.data;
    }
    // Keep the accepted pre-fix operation as evidence; do not rewrite its history.
    const response = await supabase.rpc('register_polla_contribution', { p_activity_id: activity.id, p_cycle_member_id: fixed.data.id, p_idempotency_key: 'qa-guard-fixed-yield-retest', p_amount: 10000, p_paid_date: '2026-10-05' });
    const persisted = await supabase.from('polla_contributions').select('id').eq('activity_id', activity.id).eq('idempotency_key', 'qa-guard-fixed-yield-retest');
    return { status: response.status, error: response.error?.message, count: persisted.data?.length };
  }, cycleId);
  expect(result.status).toBe(400);
  expect(result.error).toBe('Este socio solo ahorra al 12 % EA y no participa en polla.');
  expect(result.count).toBe(0);
  await goPolla(page);
  await page.getByRole('button', { name: 'Registrar aporte', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('option', { name: 'QA Bruno D', exact: true })).toHaveCount(0);
});

test('QA-005: settlement administration is not labeled as a bank commission', async ({ page }) => {
  await login(page);
  await page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('navigation', { name: 'Secciones de mas opciones' }).getByRole('button', { name: 'Movimientos', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Cuota de administración · QA Carla D/ })).toBeVisible({ timeout: 2_000 });
  await expect(page.getByRole('button', { name: /^Comisión bancaria · QA Carla D/ })).toHaveCount(0);
});

test('QA-006: a persistent validation error does not block More navigation', async ({ page }) => {
  await login(page);
  const nav = page.getByRole('navigation', { name: 'Secciones principales' });
  await goPolla(page);
  await page.getByRole('button', { name: 'QA Guard Regression', exact: true }).click();
  await page.getByRole('button', { name: 'Registrar aporte', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Participante').selectOption({ label: 'QA Ana D Editada' });
  await dialog.getByLabel('Aporte polla').fill('20.000');
  await dialog.getByLabel('Fecha aporte').fill('2026-10-05');
  await dialog.getByRole('button', { name: 'Guardar aporte', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('no puede superar $10.000');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await nav.getByRole('button', { name: 'Más', exact: true }).click();
  await page.getByRole('navigation', { name: 'Secciones de mas opciones' }).getByRole('button', { name: 'Banco y caja', exact: true }).click({ timeout: 2_000 });
  await expect(page.getByRole('heading', { name: 'Banco y caja', exact: true })).toBeVisible();
});
