import { expect, test, type Locator, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

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

  const savingsPanel = panelByHeading(page, 'Aportes de ahorro');
  const loansPanel = panelByHeading(page, 'Prestamos y cobros');
  const pollaPanel = panelByHeading(page, 'Pollas y premios');
  const bankPanel = panelByHeading(page, 'Banco y conciliacion');
  const settlementPanel = panelByHeading(page, 'Liquidaciones');

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
  await expect(page.getByRole('cell', { name: memberName })).toBeVisible();
  memberRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: memberName }) });
  await expect(memberRow.getByText(/2026-10:.*50\.000/)).toBeVisible();

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
  await expect(page.getByText(/Administracion por pagar/)).toBeVisible();
  await expect(loansPanel.getByText(new RegExp(`${escapeRegExp(memberName)}.*interes cobrado.*25\\.000`))).toBeVisible();

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
  await expect(pollaPanel.getByText(/paid/)).toBeVisible();

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
  await expect(bankPanel.getByText(/909\.000 en banco/)).toBeVisible();
  await bankField('Fecha').fill('2026-10-06');
  await bankField('Saldo externo').fill('908.500');
  await bankPanel.getByRole('button', { name: 'Conciliar corte' }).click();
  await expect(bankPanel.getByText(/diferencia.*500/)).toBeVisible();

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

  await page.getByRole('button', { name: 'Salir' }).click();
  await loginWithOtp(page, outsiderEmail);
  await expect(page.getByRole('heading', { name: 'Sin acceso asignado' })).toBeVisible();
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
