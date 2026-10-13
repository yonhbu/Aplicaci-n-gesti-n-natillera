import { expect, test, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';

const supabaseUrl = process.env.SUPABASE_URL ?? '';
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const adminEmail = (process.env.NATILLERA_ADMIN_EMAILS ?? 'e2e-admin@example.test').split(',')[0].trim();
const outsiderEmail = 'e2e-outsider@example.test';
const mailpitUrl = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:55424';

test.describe.configure({ mode: 'serial' });
test.skip(!supabaseUrl || !supabaseSecretKey, 'Requiere Supabase TEST y variables generadas por scripts/write-test-env.mjs.');

test.beforeAll(async () => {
  const admin = createClient(supabaseUrl, supabaseSecretKey as string, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const existing = await admin.auth.admin.listUsers();
  if (existing.error) {
    throw new Error(existing.error.message);
  }
  if (!existing.data.users.some((user) => user.email?.toLowerCase() === outsiderEmail)) {
    const created = await admin.auth.admin.createUser({ email: outsiderEmail, email_confirm: true });
    if (created.error) {
      const retry = await admin.auth.admin.listUsers();
      if (retry.error || !retry.data.users.some((user) => user.email?.toLowerCase() === outsiderEmail)) {
        throw new Error(created.error.message);
      }
    }
  }
});

test('OTP, socio, aporte, prestamo, polla, recarga y usuario sin membresia', async ({ page }) => {
  test.setTimeout(150_000);
  const unique = Date.now();
  const memberName = `Persona E2E ${unique}`;

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Natillera Manager' })).toBeVisible();
  await expect(page.getByLabel('Correo autorizado')).toBeVisible();

  await loginWithOtp(page, adminEmail);
  await expect(page.getByText(/Natillera/)).toBeVisible();
  await expect(panelByHeading(page, 'Inicio')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aportes de ahorro' })).not.toBeVisible();

  await goMain(page, 'Ahorros');
  const savingsPanel = panelByHeading(page, 'Aportes de ahorro');
  await expect(savingsPanel).toBeVisible();

  await page.getByLabel('Nombre visible').fill(memberName);
  await page.getByLabel('Cuota mensual').fill('100.000');
  await page.getByRole('button', { name: 'Crear socio' }).click();
  await expect(page.getByText('Socio guardado.')).toBeVisible();
  await expect(page.getByRole('cell', { name: memberName })).toBeVisible();

  await savingsPanel.getByLabel('Socio del aporte').selectOption({ label: memberName });
  await savingsPanel.getByLabel('Monto recibido').fill('50.000');
  await savingsPanel.getByLabel('Fecha efectiva').fill('2026-09-23');
  await savingsPanel.getByLabel('Mes aplicado').selectOption('10');
  await savingsPanel.getByRole('button', { name: 'Registrar aporte' }).click();
  await expect(page.getByText('Aporte confirmado por la base.')).toBeVisible();
  let memberRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: memberName }) });
  await expect(memberRow.getByText(/2026-10:.*50\.000/)).toBeVisible();

  await page.reload();
  await expect(savingsPanel).toBeVisible();
  await expect(page.getByRole('cell', { name: memberName })).toBeVisible();
  memberRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: memberName }) });
  await expect(memberRow.getByText(/2026-10:.*50\.000/)).toBeVisible();

  await goMain(page, 'Prestamos');
  const loansPanel = panelByHeading(page, 'Prestamos y cobros');
  await expect(loansPanel).toBeVisible();
  const loanField = (label: string) => fieldInPanel(loansPanel, label);
  await loansPanel.getByLabel('Socio deudor').selectOption({ label: memberName });
  await loanField('Principal').fill('500.000');
  await loanField('Metodo').selectOption('fixed_interest');
  await loanField('Base tasa').selectOption('MONTHLY_FIXED');
  await loanField('Tasa %').fill('5');
  await loanField('Plazo meses').fill('1');
  await loanField('Fecha desembolso').fill('2026-09-06');
  await loansPanel.getByRole('button', { name: 'Crear contrato' }).click();
  await expect(page.getByText('Operacion de prestamo confirmada.')).toBeVisible();
  await loansPanel.locator('p').filter({ hasText: new RegExp(`${escapeRegExp(memberName)}.*draft`) }).getByRole('button', { name: 'Desembolsar' }).click();
  await expect(page.getByText('Operacion de prestamo confirmada.')).toBeVisible();
  await expect(loansPanel.getByText(new RegExp(`${escapeRegExp(memberName)}.*cartera.*500\\.000`))).toBeVisible();

  await selectOptionContaining(loanField('Prestamo'), memberName);
  await loanField('Pago').fill('25.000');
  await loanField('Capital').fill('0');
  await loanField('Interes').fill('25.000');
  await loanField('Fecha cobro').fill('2026-10-06');
  await loansPanel.getByRole('button', { name: 'Registrar cobro' }).click();
  await expect(page.getByText('Operacion de prestamo confirmada.')).toBeVisible();
  await expect(loansPanel.getByText(new RegExp(`${escapeRegExp(memberName)}.*interes cobrado.*25\\.000`))).toBeVisible();

  await goMain(page, 'Polla');
  const pollaPanel = panelByHeading(page, 'Pollas y premios');
  await expect(pollaPanel).toBeVisible();
  const pollaField = (label: string) => fieldInPanel(pollaPanel, label);
  await pollaPanel.getByLabel('Nombre actividad').fill(`Polla E2E ${unique}`);
  await pollaField('Mes').selectOption('10');
  await pollaPanel.getByRole('button', { name: 'Crear actividad' }).click();
  await expect(page.getByText('Operacion de polla confirmada.')).toBeVisible();

  await selectOptionContaining(pollaField('Actividad'), `Polla E2E ${unique}`);
  await pollaField('Participante / ganador').selectOption({ label: memberName });
  await pollaField('Aporte polla').fill('10.000');
  await pollaField('Fecha aporte').fill('2026-10-06');
  await pollaPanel.getByRole('button', { name: 'Registrar aporte' }).click();
  await expect(page.getByText('Operacion de polla confirmada.')).toBeVisible();

  await pollaField('Premio bruto').fill('40.000');
  await pollaField('Fecha premio').fill('2026-10-06');
  await pollaPanel.getByRole('button', { name: 'Asignar premio' }).click();
  await expect(pollaPanel.getByText(/neto.*35\.000/).first()).toBeVisible();
  await pollaPanel.getByRole('button', { name: 'Pagar neto' }).first().click();
  await expect(pollaPanel.getByText(/paid/).first()).toBeVisible();

  await goMore(page, 'Banco y caja');
  const bankPanel = panelByHeading(page, 'Banco y conciliacion');
  await expect(bankPanel).toBeVisible();
  const bankField = (label: string) => fieldInPanel(bankPanel, label);
  await bankField('Cuenta').fill(`Banco E2E ${unique}`);
  await bankField('Identificador').fill('****2026');
  await bankPanel.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByText('Operacion bancaria confirmada.')).toBeVisible();
  await bankField('Cuenta operativa').selectOption({ label: `Banco E2E ${unique}` });
  await bankField('Fecha').fill('2026-10-01');
  await bankField('Monto').fill('1.000.000');
  await bankField('Referencia').fill('apertura E2E ficticia');
  await bankPanel.getByRole('button', { name: 'Registrar apertura' }).click();
  await expect(page.getByText('Operacion bancaria confirmada.')).toBeVisible();
  await bankField('Fecha').fill('2026-10-02');
  await bankField('Interes bruto').fill('10.000');
  await bankPanel.getByRole('button', { name: 'Registrar interes' }).click();
  await expect(page.getByText('Operacion bancaria confirmada.')).toBeVisible();
  await bankField('Fecha').fill('2026-10-03');
  await bankField('Comision').fill('1.000');
  await bankPanel.getByRole('button', { name: 'Registrar comision' }).click();
  await expect(page.getByText('Operacion bancaria confirmada.')).toBeVisible();
  await bankField('Fecha').fill('2026-10-04');
  await bankField('Monto').fill('100.000');
  await bankPanel.getByRole('button', { name: 'Trasladar a efectivo' }).click();
  await expect(bankPanel.getByText(new RegExp(`Banco E2E ${unique}.*909\\.000`))).toBeVisible();
  await bankField('Fecha').fill('2026-10-06');
  await bankField('Saldo externo').fill('908.500');
  await bankPanel.getByRole('button', { name: 'Conciliar corte' }).click();
  await expect(bankPanel.getByText(/diferencia.*500/).first()).toBeVisible();

  await goMain(page, 'Ahorros');
  const settlementName = `Liquidacion E2E ${unique}`;
  await page.getByLabel('Nombre visible').fill(settlementName);
  await page.getByLabel('Cuota mensual').fill('100.000');
  await page.getByRole('button', { name: 'Crear socio' }).click();
  await expect(page.getByText('Socio guardado.')).toBeVisible();
  await savingsPanel.getByLabel('Socio del aporte').selectOption({ label: settlementName });
  await savingsPanel.getByLabel('Monto recibido').fill('100.000');
  await savingsPanel.getByLabel('Fecha efectiva').fill('2026-09-23');
  await savingsPanel.getByLabel('Mes aplicado').selectOption('10');
  await savingsPanel.getByRole('button', { name: 'Registrar aporte' }).click();
  await expect(page.getByText('Aporte confirmado por la base.')).toBeVisible();

  await goMore(page, 'Liquidaciones');
  const settlementPanel = panelByHeading(page, 'Liquidaciones');
  await expect(settlementPanel).toBeVisible();
  const settlementField = (label: string) => fieldInPanel(settlementPanel, label);
  await settlementField('Socio').selectOption({ label: settlementName });
  await settlementField('Corte').fill('2026-10-06');
  await settlementField('Cuota anual').fill('0');
  await settlementField('Penalidad').fill('0');
  await settlementPanel.getByRole('button', { name: 'Previsualizar' }).click();
  await expect(settlementPanel.getByText(/Transferencia/)).toBeVisible();
  await settlementPanel.getByRole('button', { name: 'Confirmar' }).click();
  await expect(page.getByText('Liquidacion actualizada.')).toBeVisible();
  await selectOptionContaining(settlementField('Liquidacion'), settlementName);
  await settlementField('Cuenta pago').selectOption({ label: `Banco E2E ${unique}` });
  await settlementField('Referencia pago').fill('pago liquidacion E2E ficticio');
  await settlementPanel.getByRole('button', { name: 'Registrar pago' }).click();
  await expect(page.getByText('Liquidacion actualizada.')).toBeVisible();

  await goMore(page, 'Respaldos');
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar respaldo JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonText = await downloadText(jsonDownload);
  const parsed = JSON.parse(jsonText) as { format: string; data: { cycleMembers: unknown[]; contributions: unknown[]; loans: unknown[] } };
  expect(parsed.format).toBe('natillera-manager.abcd.v1');
  expect(parsed.data.cycleMembers.length).toBeGreaterThanOrEqual(2);
  expect(parsed.data.contributions.length).toBeGreaterThanOrEqual(2);
  expect(parsed.data.loans.length).toBeGreaterThanOrEqual(1);

  const csvDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar reporte CSV' }).click();
  const csvDownload = await csvDownloadPromise;
  const csvText = await downloadText(csvDownload);
  expect(csvText).toContain('"seccion","id","nombre_o_tipo","fecha","monto","estado","detalle"');
  expect(csvText).toContain(memberName);
  expect(csvText).toContain('aportes_ahorro');

  await page.getByRole('button', { name: 'Salir' }).click();
  await loginWithOtp(page, outsiderEmail);
  await expect(page.getByRole('heading', { name: 'Sin acceso asignado' })).toBeVisible();
});

test('navegacion principal oculta modulos inactivos y conserva hash', async ({ page }) => {
  await page.goto('/#/loans');
  await loginWithOtp(page, adminEmail);
  await expect(panelByHeading(page, 'Prestamos y cobros')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Aportes de ahorro' })).not.toBeVisible();

  await goMain(page, 'Mas');
  await goMore(page, 'Migracion');
  await expect(panelByHeading(page, 'Migracion D: prevalidacion y dry-run')).toBeVisible();
  await page.getByLabel('JSON respaldo navegador').setInputFiles({
    name: 'legacy-e2e.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ socios: [{ id: 'FORMULA', nombre: '=texto protegido' }], cuotas: [] }))
  });
  await page.getByRole('button', { name: 'Prevalidar sin escrituras' }).click();
  await expect(page.getByText('Hash fuente')).toBeVisible();

  await goMore(page, 'Respaldos');
  const migrationDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar informe de migracion' }).click();
  const migrationDownload = await migrationDownloadPromise;
  const migrationText = await downloadText(migrationDownload);
  const migrationParsed = JSON.parse(migrationText) as { format: string; issues: unknown[] };
  expect(migrationParsed.format).toBe('natillera-manager.migration-d.dry-run.v1');
  expect(Array.isArray(migrationParsed.issues)).toBe(true);

  await goMore(page, 'Migracion');
  await page.reload();
  await expect(panelByHeading(page, 'Migracion D: prevalidacion y dry-run')).toBeVisible();
  await page.goBack();
  await expect(panelByHeading(page, 'Respaldos y exportaciones')).toBeVisible();
  await page.goBack();
  await expect(panelByHeading(page, 'Migracion D: prevalidacion y dry-run')).toBeVisible();
  await page.goBack();
  await expect(panelByHeading(page, 'Banco y conciliacion')).toBeVisible();
  await page.goBack();
  await expect(panelByHeading(page, 'Prestamos y cobros')).toBeVisible();
});

test('shell responsive mantiene navegacion accionable sin solapamientos', async ({ page }) => {
  await page.goto('/');
  await loginWithOtp(page, adminEmail);

  for (const viewport of [
    { width: 320, height: 720 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 1000 }
  ]) {
    await page.setViewportSize(viewport);

    await goMain(page, 'Inicio');
    await expect(panelByHeading(page, 'Inicio')).toBeVisible();
    await expectShellNavigationClear(page);

    await goMain(page, 'Mas');
    await goMore(page, 'Migracion');
    await expect(panelByHeading(page, 'Migracion D: prevalidacion y dry-run')).toBeVisible();
    await expectShellNavigationClear(page);

    await page.reload();
    await expect(panelByHeading(page, 'Migracion D: prevalidacion y dry-run')).toBeVisible();
    await expectShellNavigationClear(page);

    await goMore(page, 'Respaldos');
    await expect(panelByHeading(page, 'Respaldos y exportaciones')).toBeVisible();
    await page.goBack();
    await expect(panelByHeading(page, 'Migracion D: prevalidacion y dry-run')).toBeVisible();
  }
});

async function loginWithOtp(page: Page, email: string) {
  const existingMessageIds = new Set((await listOtpMessages(email)).map((message) => message.ID));
  await page.getByLabel('Correo autorizado').fill(email);
  await page.getByRole('button', { name: 'Enviar codigo' }).click();
  await expect(page.getByLabel('Codigo recibido')).toBeVisible();
  const token = await readLatestOtp(email, existingMessageIds);
  await page.waitForTimeout(1_000);
  await page.getByLabel('Codigo recibido').fill(token);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

function panelByHeading(page: Page, heading: string) {
  return page.locator('section').filter({ has: page.getByRole('heading', { name: heading }) });
}

function fieldInPanel(panel: Locator, label: string) {
  return panel
    .locator('label')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(label)}`) })
    .locator('input, select')
    .first();
}

async function goMain(page: Page, name: string) {
  const button = page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('button', { name, exact: true });
  await clickNavigationButton(button);
}

async function goMore(page: Page, name: string) {
  if (!(await page.getByRole('button', { name: 'Banco y caja' }).isVisible().catch(() => false))) {
    await goMain(page, 'Mas');
  }
  const button = page.getByRole('navigation', { name: 'Secciones de mas opciones' }).getByRole('button', { name, exact: true });
  await clickNavigationButton(button);
}

async function clickNavigationButton(button: Locator) {
  await button.click({ timeout: 5_000 });
}

async function expectShellNavigationClear(page: Page) {
  const navBox = await page.locator('.section-tabs').boundingBox();
  expect(navBox).not.toBeNull();

  const viewport = page.viewportSize();
  if (navBox && viewport && viewport.width < 980) {
    expect(navBox.y + navBox.height).toBeLessThanOrEqual(viewport.height + 1);

    const lastMainButton = page.locator('main button:visible').last();
    if (await lastMainButton.count()) {
      await lastMainButton.scrollIntoViewIfNeeded();
      const buttonBox = await lastMainButton.boundingBox();
      if (buttonBox) {
        if (navBox.y < viewport.height / 2) {
          expect(buttonBox.y).toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);
        } else {
          expect(buttonBox.y + Math.min(buttonBox.height, 44)).toBeLessThan(navBox.y);
        }
      }
    }
  }

  await page.evaluate(() => {
    const nav = document.querySelector('.section-tabs');
    if (!nav) {
      throw new Error('No se encontro la navegacion principal.');
    }
    for (const button of Array.from(nav.querySelectorAll('button'))) {
      const rect = button.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const target = document.elementFromPoint(x, y);
      if (!target || (target !== button && !button.contains(target))) {
        throw new Error(`El boton de navegacion "${button.textContent?.trim() ?? ''}" no es accionable.`);
      }
    }
  });

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const body = document.body;
    return {
      documentClientWidth: doc.clientWidth,
      documentScrollWidth: doc.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      tableWraps: Array.from(document.querySelectorAll('.table-wrap')).map((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth
      }))
    };
  });
  expect(overflow.documentScrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.documentClientWidth + 1);
  expect(overflow.bodyScrollWidth, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.bodyClientWidth + 1);
}

async function downloadText(download: { path(): Promise<string | null> }) {
  const path = await download.path();
  if (!path) {
    throw new Error('La descarga no produjo archivo local.');
  }
  return await import('node:fs/promises').then((fs) => fs.readFile(path, 'utf8'));
}

async function selectOptionContaining(select: Locator, text: string) {
  const value = await select.locator('option').filter({ hasText: text }).last().getAttribute('value');
  if (!value) {
    throw new Error(`No se encontro opcion que contenga: ${text}`);
  }
  await select.selectOption(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

type MailpitMessage = { ID: string; To?: Array<{ Address: string }> };

async function listOtpMessages(email: string) {
  const response = await fetch(`${mailpitUrl}/api/v1/messages`);
  if (!response.ok) {
    throw new Error(`No se pudo leer Mailpit: ${response.status}`);
  }
  const inbox = await response.json() as { messages?: MailpitMessage[] };
  return (inbox.messages ?? []).filter((candidate) =>
    candidate.To?.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase()),
  );
}

async function readLatestOtp(email: string, excludedMessageIds: Set<string>) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const message = (await listOtpMessages(email)).find((candidate) => !excludedMessageIds.has(candidate.ID));
    if (!message) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }

    const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${encodeURIComponent(message.ID)}`);
    if (!detailResponse.ok) {
      throw new Error(`No se pudo leer mensaje OTP: ${detailResponse.status}`);
    }
    const detail = await detailResponse.json() as { Text?: string; HTML?: string };
    const token = `${detail.Text ?? ''}\n${detail.HTML ?? ''}`.match(/\b\d{6}\b/)?.[0];
    if (token) {
      return token;
    }
    excludedMessageIds.add(message.ID);
  }
  throw new Error(`No hay correo OTP nuevo para ${email}.`);
}
