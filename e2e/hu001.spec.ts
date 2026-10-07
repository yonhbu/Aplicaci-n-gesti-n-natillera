import { expect, test, type Page } from '@playwright/test';
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

test('OTP, socio, aporte, recarga y usuario sin membresia', async ({ page }) => {
  test.setTimeout(90_000);
  const unique = Date.now();
  const memberName = `Persona E2E ${unique}`;

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Natillera Manager' })).toBeVisible();
  await expect(page.getByLabel('Correo autorizado')).toBeVisible();

  await loginWithOtp(page, adminEmail);
  await expect(page.getByText(/Natillera/)).toBeVisible();

  await page.getByLabel('Nombre visible').fill(memberName);
  await page.getByLabel('Cuota mensual').fill('100.000');
  await page.getByRole('button', { name: 'Crear socio' }).click();
  await expect(page.getByText('Socio guardado.')).toBeVisible();
  await expect(page.getByRole('cell', { name: memberName })).toBeVisible();

  await page.getByLabel('Socio del aporte').selectOption({ label: memberName });
  await page.getByLabel('Monto recibido').fill('50.000');
  await page.getByLabel('Fecha efectiva').fill('2026-09-23');
  await page.getByLabel('Mes aplicado').selectOption('10');
  await page.getByRole('button', { name: 'Registrar aporte' }).click();
  await expect(page.getByText('Aporte confirmado por la base.')).toBeVisible();
  let memberRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: memberName }) });
  await expect(memberRow.getByText(/2026-10:.*50\.000/)).toBeVisible();

  await page.reload();
  await expect(page.getByRole('cell', { name: memberName })).toBeVisible();
  memberRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: memberName }) });
  await expect(memberRow.getByText(/2026-10:.*50\.000/)).toBeVisible();

  await page.getByRole('button', { name: 'Salir' }).click();
  await loginWithOtp(page, outsiderEmail);
  await expect(page.getByRole('heading', { name: 'Sin acceso asignado' })).toBeVisible();
});

async function loginWithOtp(page: Page, email: string) {
  await page.getByLabel('Correo autorizado').fill(email);
  await page.getByRole('button', { name: 'Enviar codigo' }).click();
  await expect(page.getByLabel('Codigo recibido')).toBeVisible();
  const token = await readLatestOtp(email);
  await page.getByLabel('Codigo recibido').fill(token);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

async function readLatestOtp(email: string) {
  const response = await fetch(`${mailpitUrl}/api/v1/messages`);
  if (!response.ok) {
    throw new Error(`No se pudo leer Mailpit: ${response.status}`);
  }
  const inbox = await response.json() as { messages?: Array<{ ID: string; To?: Array<{ Address: string }> }> };
  const message = inbox.messages?.find((candidate) =>
    candidate.To?.some((recipient) => recipient.Address.toLowerCase() === email.toLowerCase()),
  );
  if (!message) {
    throw new Error(`No hay correo OTP para ${email}.`);
  }

  const detailResponse = await fetch(`${mailpitUrl}/api/v1/message/${encodeURIComponent(message.ID)}`);
  if (!detailResponse.ok) {
    throw new Error(`No se pudo leer mensaje OTP: ${detailResponse.status}`);
  }
  const detail = await detailResponse.json() as { Text?: string; HTML?: string };
  const token = `${detail.Text ?? ''}\n${detail.HTML ?? ''}`.match(/\b\d{6}\b/)?.[0];
  if (!token) {
    throw new Error(`No se encontro OTP de 6 digitos para ${email}.`);
  }
  return token;
}
