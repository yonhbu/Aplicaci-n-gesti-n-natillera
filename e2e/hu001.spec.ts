import { expect, test, type Locator, type Page } from './test-fixtures';
import { createClient } from '@supabase/supabase-js';


const supabaseUrl = process.env.SUPABASE_URL ?? '';
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const adminEmail = (process.env.NATILLERA_ADMIN_EMAILS ?? 'e2e-admin@example.test').split(',')[0].trim();
const outsiderEmail = 'e2e-outsider@example.test';
const mailpitUrl = process.env.E2E_MAILPIT_URL ?? 'http://127.0.0.1:55424';

test.describe.configure({ mode: 'default' });
if (!supabaseUrl || !supabaseSecretKey) throw Error('Se requiere el preflight y bootstrap sintético TEST de npm run test:e2e.');

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

  // Socios es una sección principal propia: el alta de socios vive allí, no en Ahorros (móvil).
  await goMain(page, 'Socios');
  await expect(page.getByRole('heading', { name: 'Socios', exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Nuevo socio', exact: true }).click();
  await page.getByLabel('Nombre visible').fill(memberName);
  await page.getByLabel('Cuota mensual').fill('100.000');
  await page.getByRole('button', { name: 'Crear socio' }).click();
  await expect(page.getByText('Socio guardado.')).toBeVisible();
  await expect(page.getByRole('cell', { name: memberName })).toBeVisible();

  await goMain(page, 'Ahorros');
  await expect(page.getByRole('heading', { name: 'Ahorros', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Registrar aporte', exact: true }).click();
  const savingsPanel = panelByHeading(page, 'Registrar aporte');
  await expect(savingsPanel).toBeVisible();
  await savingsPanel.getByLabel('Socio del aporte').selectOption({ label: memberName });
  await savingsPanel.getByLabel('Monto recibido').fill('50.000');
  await savingsPanel.getByLabel('Fecha efectiva').fill('2026-09-23');
  await savingsPanel.getByLabel('Mes aplicado').selectOption('10');
  await savingsPanel.getByRole('button', { name: 'Guardar aporte' }).click();
  await expect(page.getByText('Aporte confirmado por la base.')).toBeVisible();
  await expect(savingsPanel).toHaveCount(0);
  // El detalle por socio (último aporte, progreso) se consulta en Socios; Ahorros muestra el explorador mensual.
  await goMain(page, 'Socios');
  let memberRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: memberName }) });
  await expect(memberRow.locator('.directory-received')).toContainText('50.000,00');
  await expect(memberRow).toContainText('23/09/2026');

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Socios', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: memberName })).toBeVisible();
  memberRow = page.getByRole('row').filter({ has: page.getByRole('cell', { name: memberName }) });
  await expect(memberRow.locator('.directory-received')).toContainText('50.000,00');
  await expect(memberRow).toContainText('23/09/2026');

  const savedContribution = await page.evaluate(async name => {
    const { supabase } = await import('/src/lib/supabase.ts');
    const member = await supabase.from('members').select('id').eq('display_name',name).single();
    if (member.error) throw Error(member.error.message);
    const participation = await supabase.from('cycle_members').select('id').eq('member_id',member.data.id).single();
    if (participation.error) throw Error(participation.error.message);
    const result = await supabase.from('savings_contributions').select('amount,applied_month,effective_date').eq('cycle_member_id',participation.data.id).single();
    if (result.error) throw Error(result.error.message);
    return result.data;
  }, memberName);
  expect(savedContribution).toEqual({ amount:50000, applied_month:10, effective_date:'2026-09-23' });

  await goMain(page, 'Préstamos');
  const loansPanel = page.locator('section.loans-page');
  await expect(loansPanel).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await loansPanel.getByRole('button', { name: 'Nuevo préstamo' }).click();
  const newLoan = panelByHeading(page, 'Nuevo préstamo');
  const loanField = (label: string) => fieldInPanel(newLoan, label);
  await newLoan.getByLabel('Socio deudor').selectOption({ label: memberName });
  await loanField('Principal').fill('500.000');
  await loanField('Método').selectOption('fixed_interest');
  await loanField('Base tasa').selectOption('MONTHLY_FIXED');
  await loanField('Tasa %').fill('5');
  await loanField('Plazo meses').fill('1');
  await loanField('Fecha desembolso').fill('2026-09-06');
  await newLoan.getByRole('button', { name: 'Crear contrato' }).click();
  await expect(page.getByText('Operación de préstamo confirmada.')).toBeVisible();
  await expect(newLoan).toHaveCount(0);
  const loanRow = loansPanel.locator('[data-loan-row]').filter({ hasText: memberName });
  await expect(loanRow).toContainText('Borrador');
  await loanRow.getByRole('button', { name: 'Desembolsar' }).click();
  const disburseSheet = panelByHeading(page, 'Desembolsar préstamo');
  await expect(fieldInPanel(disburseSheet, 'Fecha del desembolso')).toHaveValue('2026-09-06');
  await disburseSheet.getByRole('button', { name: 'Confirmar desembolso' }).click();
  await expect(disburseSheet).toHaveCount(0);
  await expect(loanRow).not.toContainText('Borrador');
  await expect(loanRow).toContainText('500.000');

  await loanRow.getByRole('button', { name: 'Ver detalle' }).click();
  const loanDetail = loansPanel.locator('[data-loan-detail]');
  await expect(loanDetail.getByText('Capital pendiente', { exact: true })).toBeVisible();
  await loanDetail.getByRole('button', { name: 'Registrar pago' }).click();
  const paySheet = panelByHeading(page, 'Registrar pago');
  const payField = (label: string) => fieldInPanel(paySheet, label);
  await paySheet.getByRole('button', { name: 'Otro monto' }).click();
  await payField('Pago').fill('25.000');
  await payField('Capital').fill('0');
  await payField('Interés').fill('25.000');
  await payField('Fecha del pago').fill('2026-10-06');
  await paySheet.getByRole('button', { name: 'Registrar Pago' }).click();
  await expect(page.getByText('Operación de préstamo confirmada.')).toBeVisible();
  await expect(paySheet).toHaveCount(0);
  await expect(loanDetail.locator('[data-loan-payment-row]')).toHaveCount(1);
  await expect(loanDetail).toContainText('25.000');

  await loansPanel.getByLabel('Buscar contrato').fill('NO-EXISTE-UX05');
  await expect(loansPanel.getByText('No hay contratos que coincidan con el filtro.')).toBeVisible();
  await loansPanel.getByLabel('Buscar contrato').fill(memberName);

  await loanDetail.getByRole('button', { name: 'Registrar pago' }).click();
  await paySheet.getByRole('button', { name: 'Otro monto' }).click();
  await payField('Pago').fill('30.000');
  await payField('Capital').fill('0');
  await payField('Interés').fill('25.000');
  await expect(paySheet.getByRole('button', { name: 'Registrar Pago' })).toBeDisabled();
  await paySheet.getByRole('button', { name: 'Pagar todo' }).click();
  await expect(paySheet.getByText(/Para cancelar/)).toBeVisible();
  await expect(paySheet.getByRole('button', { name: 'Confirmar pago total' })).toBeEnabled();
  await paySheet.getByRole('button', { name: 'Confirmar pago total' }).click();
  await expect(paySheet).toHaveCount(0);
  await expect(loanDetail.locator('[data-loan-payment-row]')).toHaveCount(2);
  await loanDetail.getByRole('button', { name: 'Cerrar detalle', exact: true }).click();
  await expect(loanDetail).toHaveCount(0);
  await loansPanel.getByRole('button', { name: /^Todos/ }).click();
  await expect(loansPanel.locator('[data-loan-row]').filter({ hasText: memberName })).toContainText('Pagado');

  await goPolla(page);
  const pollaPanel = page.locator('section.polla-page');
  await expect(pollaPanel).toBeVisible();
  await pollaPanel.getByRole('button', { name: 'Nueva polla' }).click();
  const newPolla = panelByHeading(page, 'Nueva polla');
  await fieldInPanel(newPolla, 'Nombre actividad').fill(`Polla E2E ${unique}`);
  await fieldInPanel(newPolla, 'Mes').selectOption('10');
  await newPolla.getByRole('button', { name: 'Crear actividad' }).click();
  await expect(page.getByText('Operación de polla confirmada.')).toBeVisible();
  await pollaPanel.getByRole('button', { name: 'Octubre', exact: true }).click();
  await pollaPanel.getByRole('button', { name: `Polla E2E ${unique}`, exact: true }).click();

  await pollaPanel.getByRole('button', { name: 'Registrar aporte', exact: true }).click();
  const pollaSheet = panelByHeading(page, 'Aporte de polla');
  await fieldInPanel(pollaSheet, 'Participante').selectOption({ label: memberName });
  await fieldInPanel(pollaSheet, 'Aporte polla').fill('10.000');
  await fieldInPanel(pollaSheet, 'Fecha aporte').fill('2026-10-06');
  await pollaSheet.getByRole('button', { name: 'Guardar aporte' }).click();
  await expect(pollaSheet).toHaveCount(0);

  await pollaPanel.getByRole('button', { name: 'Asignar ganador' }).click();
  const prizeSheet = panelByHeading(page, 'Asignar ganador');
  await fieldInPanel(prizeSheet, 'Ganador').selectOption({ label: memberName });
  await fieldInPanel(prizeSheet, 'Premio bruto').fill('10.000');
  await fieldInPanel(prizeSheet, 'Fecha premio').fill('2026-10-06');
  await prizeSheet.getByRole('button', { name: 'Asignar premio' }).click();
  await expect(prizeSheet).toHaveCount(0);
  const prizeRow = pollaPanel.locator('[data-prize-row]').filter({ hasText: memberName });
  await expect(prizeRow.first()).toContainText(/Acreditado .*5\.000/);
  await expect(prizeRow.getByRole('button', { name: /Pagar/ })).toHaveCount(0);

  await goMore(page, 'Banco y caja');
  const bankPanel = page.locator('section.bank-page');
  await expect(bankPanel).toBeVisible();
  const openBankSheet = async (button: string, title: string) => {
    await bankPanel.getByRole('button', { name: button, exact: true }).click();
    const sheet = panelByHeading(page, title);
    await expect(sheet).toBeVisible();
    return { sheet, field: (label: string) => fieldInPanel(sheet, label) };
  };
  const accountButton = (await bankPanel.getByRole('button', { name: 'Crear cuenta', exact: true }).isVisible()) ? 'Crear cuenta' : 'Nueva cuenta';
  const account = await openBankSheet(accountButton, 'Nueva cuenta bancaria');
  await account.field('Nombre de la cuenta').fill(`Banco E2E ${unique}`);
  await account.field('Identificador').fill('****2026');
  await account.sheet.getByRole('button', { name: 'Guardar cuenta' }).click();
  await expect(page.getByText('Operación bancaria confirmada.')).toBeVisible();
  const accountChip = bankPanel.getByRole('button', { name: `Banco E2E ${unique}`, exact: true });
  if (await accountChip.isVisible().catch(() => false)) await accountChip.click();

  const opening = await openBankSheet('Saldo inicial', 'Saldo inicial de la cuenta');
  await opening.field('Monto').fill('1.000.000');
  await opening.field('Fecha').fill('2026-10-01');
  await opening.field('Referencia').fill('apertura E2E ficticia');
  await opening.sheet.getByRole('button', { name: 'Registrar saldo inicial' }).click();
  await expect(opening.sheet).toHaveCount(0);

  const interest = await openBankSheet('Intereses', 'Intereses del banco');
  await interest.field('Interés bruto').fill('10.000');
  await interest.field('Fecha').fill('2026-10-02');
  await interest.sheet.getByRole('button', { name: 'Registrar intereses' }).click();
  await expect(interest.sheet).toHaveCount(0);

  const fee = await openBankSheet('Comisión', 'Comisión bancaria');
  await fee.field('Monto').fill('1.000');
  await fee.field('Fecha').fill('2026-10-03');
  await fee.sheet.getByRole('button', { name: 'Registrar comisión' }).click();
  await expect(fee.sheet).toHaveCount(0);

  const transfer = await openBankSheet('Mover entre banco y efectivo', 'Mover entre banco y efectivo');
  await transfer.sheet.getByRole('button', { name: 'Banco → efectivo' }).click();
  await transfer.field('Monto').fill('100.000');
  await transfer.field('Fecha').fill('2026-10-04');
  await transfer.sheet.getByRole('button', { name: 'Registrar traslado' }).click();
  await expect(transfer.sheet).toHaveCount(0);
  await expect(bankPanel.locator('.value-row').filter({ hasText: `Banco E2E ${unique}` })).toContainText('909.000');

  const reconcile = await openBankSheet('Conciliar', 'Conciliar con el extracto');
  await reconcile.field('Fecha del corte').fill('2026-10-06');
  await reconcile.field('Saldo del extracto').fill('908.500');
  await reconcile.field('Saldo inicial verificado').fill('1.000.000');
  await reconcile.field('Fecha del saldo inicial').fill('2026-10-01');
  await expect(reconcile.sheet.getByText('Diferencia')).toBeVisible();
  await reconcile.sheet.getByRole('button', { name: 'Guardar conciliación' }).click();
  await expect(reconcile.sheet).toHaveCount(0);
  await expect(bankPanel.locator('[data-reconciliation-row]').first()).toContainText(/Diferencia.*500/);

  await goMain(page, 'Socios');
  const settlementName = `Liquidacion E2E ${unique}`;
  await page.getByRole('button', { name: 'Nuevo socio', exact: true }).click();
  await page.getByLabel('Nombre visible').fill(settlementName);
  await page.getByLabel('Cuota mensual').fill('100.000');
  await page.getByRole('button', { name: 'Crear socio' }).click();
  await expect(page.getByText('Socio guardado.')).toBeVisible();
  await goMain(page, 'Ahorros');
  await page.getByRole('button', { name: 'Registrar aporte', exact: true }).click();
  await expect(savingsPanel).toBeVisible();
  await savingsPanel.getByLabel('Socio del aporte').selectOption({ label: settlementName });
  await savingsPanel.getByLabel('Monto recibido').fill('100.000');
  await savingsPanel.getByLabel('Fecha efectiva').fill('2026-09-23');
  await savingsPanel.getByLabel('Mes aplicado').selectOption('10');
  await savingsPanel.getByRole('button', { name: 'Guardar aporte' }).click();
  await expect(page.getByText('Aporte confirmado por la base.')).toBeVisible();

  await goMore(page, 'Cuentas finales');
  const settlementPanel = page.locator('section.settlement-page');
  await expect(settlementPanel).toBeVisible();
  await settlementPanel.getByRole('button').filter({ hasText: settlementName }).click();
  const settlementSheet = page.getByRole('dialog');
  await expect(settlementSheet.getByRole('heading', { name: `Cuenta final de ${settlementName}`, exact: true })).toBeVisible();
  const settlementField = (label: string) => label === 'Cuenta'
    ? settlementSheet.getByRole('combobox', { name: label, exact: true })
    : settlementSheet.getByLabel(label, { exact: true });
  await settlementField('Fecha de corte').fill('2026-10-06');
  await settlementSheet.getByRole('button', { name: 'Calcular' }).click();
  await expect(settlementSheet.getByText(/Transferencia redondeada/)).toBeVisible();
  await settlementSheet.getByRole('button', { name: 'Confirmar cuenta final' }).click();
  await expect(settlementSheet.getByText('Cálculo confirmado', { exact: false })).toBeVisible();
  await settlementSheet.getByRole('button', { name: 'Banco', exact: true }).click();
  await settlementField('Cuenta').selectOption({ label: `Banco E2E ${unique}` });
  await settlementField('Referencia').fill('pago liquidacion E2E ficticio');
  await settlementSheet.getByRole('button', { name: /^Pagar / }).click();
  await expect(settlementSheet).toHaveCount(0);
  await expect(settlementPanel.getByRole('button').filter({ hasText: settlementName })).toContainText('Pagada');

  await goMore(page, 'Respaldos');
  const jsonDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Descargar respaldo' }).click();
  const jsonDownload = await jsonDownloadPromise;
  const jsonText = await downloadText(jsonDownload);
  const parsed = JSON.parse(jsonText) as { format: string; tables: Record<string, unknown[]> };
  expect(parsed.format).toBe('natillera-manager.workspace.v3');
  for (const key of ['member_capital_credits', 'bank_yield_distributions', 'loan_profit_period_distributions', 'loan_profit_period_allocations', 'fin_rules_activations']) {
    expect(Array.isArray(parsed.tables[key]), key).toBe(true);
  }
  expect(parsed.tables.cycle_members.length).toBeGreaterThanOrEqual(2);
  expect(parsed.tables.savings_contributions.length).toBeGreaterThanOrEqual(2);
  expect(parsed.tables.loan_contracts.length).toBeGreaterThanOrEqual(1);

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
  await expect(page.locator('section.loans-page')).toBeVisible();
  await goMore(page,'Banco y caja');
  const trail = [page.url()];
  let captureHistory = true;
  page.on('framenavigated', frame => {
    if (captureHistory && frame === page.mainFrame() && page.url() !== trail.at(-1)) trail.push(page.url());
  });
  await expect(page.getByRole('button',{name:'Migración',exact:true})).toHaveCount(0);
  // Legacy review is a domain/CLI operation; it no longer has a client import screen.
  const report = await page.evaluate(async () => {
    const { buildMigrationDryRun } = await import('/src/domain/migrationD.ts');
    return buildMigrationDryRun({jsonText: JSON.stringify({socios:[{id:'FORMULA',nombre:'=texto protegido'}],cuotas:[]}),sourceHash:'synthetic-ci-review',sourceNames:['legacy-e2e-synthetic.json']});
  });
  expect(report.format).toBe('natillera-manager.migration-d.dry-run.v1');
  expect(Array.isArray(report.issues)).toBe(true);
  for (const [label,heading] of [['Respaldos','Respaldos'],['Movimientos','Movimientos financieros'],['Respaldos','Respaldos']]) {
    await goMore(page,label);
    await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  }
  captureHistory = false;
  await page.reload(); await expect(page.getByRole('heading',{name:'Respaldos',exact:true})).toBeVisible();
  for (const url of trail.slice(0,-1).reverse()) { await page.goBack(); await expect(page).toHaveURL(url); }
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

    await goMain(page, 'Más');
    await goMore(page, 'Movimientos');
    await expect(panelByHeading(page, 'Movimientos financieros')).toBeVisible();
    await expectShellNavigationClear(page);

    await page.reload();
    await expect(panelByHeading(page, 'Movimientos financieros')).toBeVisible();
    await expectShellNavigationClear(page);

    const history = [page.url()];
    const record = () => { if (page.url() !== history.at(-1)) history.push(page.url()); };
    page.on('framenavigated', record);
    await goMore(page, 'Respaldos');
    await expect(panelByHeading(page, 'Respaldos')).toBeVisible();
    page.off('framenavigated', record);
    for (const url of history.slice(0,-1).reverse()) { await page.goBack(); await expect(page).toHaveURL(url); }
    await expect(panelByHeading(page, 'Movimientos financieros')).toBeVisible();
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

// Polla es una sección principal solo en escritorio (≥ 980 px); en móvil se llega desde Más → Polla.
async function goPolla(page: Page) {
  const direct = page.getByRole('navigation', { name: 'Secciones principales' }).getByRole('button', { name: 'Polla', exact: true });
  if (await direct.isVisible().catch(() => false)) {
    await clickNavigationButton(direct);
    return;
  }
  await goMain(page, 'Más');
  await clickNavigationButton(page.getByRole('navigation', { name: 'Secciones de mas opciones' }).getByRole('button', { name: 'Polla', exact: true }));
}

async function goMore(page: Page, name: string) {
  if (!(await page.getByRole('button', { name: 'Banco y caja' }).isVisible().catch(() => false))) {
    await goMain(page, 'Más');
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
      await lastMainButton.evaluate((element) => element.scrollIntoView({ block: 'center' }));
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
      // Pestañas exclusivas de escritorio (Polla) están ocultas en móvil: no cuentan como navegación visible.
      if (rect.width === 0 && rect.height === 0) continue;
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
