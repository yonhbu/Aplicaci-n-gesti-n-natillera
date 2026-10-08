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
  await loansPanel.getByRole('button', { name: 'Crear y desembolsar' }).click();
  await expect(page.getByText('Operacion de prestamo confirmada.')).toBeVisible();
  await expect(loansPanel.getByText(new RegExp(`${escapeRegExp(memberName)}.*cartera.*500\\.000`))).toBeVisible();

  await loanField('Prestamo').selectOption({ index: 1 });
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

  await pollaField('Actividad').selectOption({ index: 1 });
  await pollaField('Participante / ganador').selectOption({ label: memberName });
  await pollaField('Aporte polla').fill('10.000');
  await pollaPanel.getByRole('button', { name: 'Registrar aporte' }).click();
  await expect(page.getByText('Operacion de polla confirmada.')).toBeVisible();

  await pollaField('Premio bruto').fill('40.000');
  await pollaPanel.getByRole('button', { name: 'Asignar premio' }).click();
  await expect(pollaPanel.getByText(/neto.*35\.000/)).toBeVisible();
  await pollaPanel.getByRole('button', { name: 'Pagar neto' }).click();
  await expect(pollaPanel.getByText(/paid/)).toBeVisible();

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
