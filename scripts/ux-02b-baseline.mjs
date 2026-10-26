import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const phase = readArg('--phase') ?? 'after';
const port = Number(readArg('--port') ?? '5182');
const suite = readArg('--suite') ?? 'ux-02b';
const outRoot = path.resolve('docs/ux/baseline', suite, phase);
const adminEmail = 'e2e-admin@example.test';
const routes = [
  { name: 'home', hash: '#/home' },
  { name: 'ahorros', hash: '#/savings' },
  ...(suite === 'ux-05' ? [{ name: 'prestamos', hash: '#/loans' }] : []),
  { name: 'movimientos', hash: '#/more/movements' }
];
const viewports = [
  { name: '320', width: 320, height: 720 },
  { name: '375', width: 375, height: 812 },
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1440', width: 1440, height: 1000 }
];

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});

async function main() {
  run('npm', ['run', 'test:infra:start']);
  run('npm', ['run', 'test:infra:reset']);
  run('node', ['scripts/bootstrap-test.mjs']);
  await seedSyntheticDataset();

  const vite = spawn(
    process.platform === 'win32' ? 'cmd.exe' : 'npm',
    process.platform === 'win32'
      ? ['/c', `set SUPABASE_ENV=test&& npm run dev -- --mode test --host 127.0.0.1 --port ${port}`]
      : ['run', 'dev', '--', '--mode', 'test', '--host', '127.0.0.1', '--port', String(port)],
    { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SUPABASE_ENV: 'test' } }
  );

  const output = [];
  vite.stdout.on('data', (chunk) => output.push(chunk.toString()));
  vite.stderr.on('data', (chunk) => output.push(chunk.toString()));

  try {
    await waitForHttp(`http://127.0.0.1:${port}`);
    await captureAll(`http://127.0.0.1:${port}`);
  } finally {
    killProcessTree(vite.pid);
    run('npm', ['run', 'test:infra:stop'], { allowFailure: true });
    await writeFile(path.join(outRoot, 'vite.log'), output.join(''));
  }
}

async function captureAll(baseUrl) {
  await mkdir(outRoot, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome' });
  const page = await browser.newPage();
  const measurements = [];
  const figures = [];
  const savingsSnapshots = [];
  try {
    await login(page, baseUrl);
    if (suite === 'ux-05') {
      await seedUx05Loans(page, baseUrl);
      await writeFile(path.join(outRoot, 'loan-records.json'), JSON.stringify(await readUx05Loans(), null, 2));
    }
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of routes) {
        await page.goto(`${baseUrl}/${route.hash}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(250);
        const fileName = `${route.name}-${viewport.name}.png`;
        await page.screenshot({ path: path.join(outRoot, fileName), fullPage: false });
        if (route.name === 'prestamos') {
          await page.screenshot({ path: path.join(outRoot, `prestamos-${viewport.name}-full.png`), fullPage: true });
        }
        measurements.push(await measureOverflow(page, route.name, viewport.name));
        if (route.name === 'home') {
          figures.push(await readDashboardFigures(page, viewport.name));
        }
        if (route.name === 'ahorros') {
          savingsSnapshots.push(await readSavingsSnapshot(page, viewport.name));
        }
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(outRoot, 'measurements.json'), JSON.stringify(measurements, null, 2));
  await writeFile(path.join(outRoot, 'dashboard-figures.json'), JSON.stringify(figures, null, 2));
  await writeFile(path.join(outRoot, 'savings-snapshot.json'), JSON.stringify(savingsSnapshots, null, 2));
  await writeFile(path.join(outRoot, 'README.md'), [
    `# ${suite} baseline ${phase}`,
    '',
    `Fecha generada: ${new Date().toISOString()}`,
    'Entorno: TEST descartable con dataset sintetico fijo.',
    `Rutas: ${routes.map((route) => route.name).join(', ')}.`,
    'Viewports: 320, 375, 390, 768, 1024, 1440.',
    ''
  ].join('\n'));
}

async function seedUx05Loans(page, baseUrl) {
  await page.goto(`${baseUrl}/#/loans`);
  const loansPanel = page.locator('section.loans-page');
  await loansPanel.waitFor();
  const newLoanSheet = page.locator('section[role="dialog"]').filter({ has: page.getByRole('heading', { name: 'Nuevo préstamo' }) });
  const paySheet = page.locator('section[role="dialog"]').filter({ has: page.getByRole('heading', { name: 'Registrar pago' }) });
  const loanRow = (text) => loansPanel.locator('[data-loan-row]').filter({ hasText: text });
  const fillContract = async ({ borrower, external, principal, method, rate, term }) => {
    await loansPanel.getByRole('button', { name: 'Nuevo préstamo' }).click();
    await newLoanSheet.getByLabel('Socio deudor').selectOption(borrower ? { label: borrower } : '');
    if (!borrower) await newLoanSheet.getByLabel('Deudor externo').fill(external);
    await newLoanSheet.getByLabel('Principal').fill(principal);
    await newLoanSheet.getByLabel('Método', { exact: true }).selectOption(method);
    await newLoanSheet.getByLabel('Base tasa').selectOption('MONTHLY_FIXED');
    await newLoanSheet.getByLabel('Tasa %').fill(rate);
    await newLoanSheet.getByLabel('Plazo meses').fill(term);
    await newLoanSheet.getByLabel('Fecha desembolso').fill('2026-09-06');
    await newLoanSheet.getByRole('button', { name: 'Crear contrato' }).click();
    await newLoanSheet.waitFor({ state: 'detached' });
  };
  const disburse = async (text) => {
    await loanRow(text).getByRole('button', { name: 'Desembolsar' }).click();
    const disburseSheet = page.locator('section[role="dialog"]').filter({ has: page.getByRole('heading', { name: 'Desembolsar préstamo' }) });
    await disburseSheet.getByRole('button', { name: 'Confirmar desembolso' }).click();
    await disburseSheet.waitFor({ state: 'detached' });
    await loanRow(text).filter({ hasNotText: 'Borrador' }).waitFor();
  };
  const openPayment = async (text) => {
    await loanRow(text).getByRole('button', { name: 'Ver detalle' }).click();
    await loansPanel.locator('[data-loan-detail]').getByRole('button', { name: 'Registrar pago' }).click();
    await paySheet.waitFor();
  };
  const payManual = async (text, amount, capital, interest) => {
    await openPayment(text);
    await paySheet.getByRole('button', { name: 'Otro monto' }).click();
    await paySheet.getByLabel('Pago', { exact: true }).fill(amount);
    await paySheet.getByLabel('Capital', { exact: true }).fill(capital);
    await paySheet.getByLabel('Interés', { exact: true }).fill(interest);
    await paySheet.getByLabel('Fecha del pago').fill('2026-10-06');
    await paySheet.getByRole('button', { name: 'Guardar pago' }).click();
    await paySheet.waitFor({ state: 'detached' });
  };
  await fillContract({ borrower: 'Socio UX 02B con nombre largo sintetico', principal: '9.500.000', method: 'fixed_interest', rate: '5', term: '12' });
  await disburse('Socio UX 02B con nombre largo sintetico');
  await payManual('Socio UX 02B', '1.500.000', '1.000.000', '500.000');

  await fillContract({ external: 'Deudor externo UX05 nombre sintetico muy largo', principal: '2.300.000', method: 'interest_only', rate: '0', term: '3' });
  await disburse('Deudor externo UX05');
  await payManual('Deudor externo UX05', '2.300.000', '2.300.000', '0');
  await fillContract({ external: 'Borrador UX05 externo', principal: '750.000', method: 'amortized', rate: '12', term: '6' });
  await openPayment('Socio UX 02B');
  await paySheet.getByRole('button', { name: 'Pagar todo' }).click();
  await paySheet.getByText(/Para cancelar hoy/).waitFor();
  await writeFile(path.join(outRoot, 'loan-quote.txt'), await paySheet.getByText(/Para cancelar hoy/).textContent());
  await paySheet.getByRole('button', { name: 'Cancelar' }).click();

  await fillContract({ external: 'Prepago confirmado UX05 sintetico', principal: '1.200.000', method: 'fixed_interest', rate: '5', term: '3' });
  await disburse('Prepago confirmado UX05 sintetico');
  await openPayment('Prepago confirmado UX05 sintetico');
  await paySheet.getByRole('button', { name: 'Pagar todo' }).click();
  await paySheet.getByText(/Para cancelar hoy/).waitFor();
  await paySheet.getByRole('button', { name: 'Confirmar pago total' }).click();
  await paySheet.waitFor({ state: 'detached' });
}

async function selectLoanOption(select, borrower) {
  const value = await select.locator('option').filter({ hasText: borrower }).first().getAttribute('value');
  if (!value) throw new Error(`Prestamo TEST no encontrado para ${borrower}.`);
  await select.selectOption(value);
}

async function readUx05Loans() {
  const env = await readEnvFile('.env.test.local');
  if (env.SUPABASE_URL !== 'http://127.0.0.1:55421' || !env.SUPABASE_SECRET_KEY) {
    throw new Error('Snapshot de prestamos limitado a TEST local.');
  }
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
  const { data: contracts, error: contractError } = await admin.from('loan_contracts')
    .select('id, borrower_member_id, external_borrower_name, principal, method, rate_unit, rate_value, term_months, start_date, status, legacy_paid_capital_amount, legacy_paid_interest_amount');
  if (contractError) throw new Error(contractError.message);
  const ids = (contracts ?? []).map((loan) => loan.id);
  const { data: payments, error: paymentError } = await admin.from('loan_payments')
    .select('loan_id, payment_date, amount, capital_amount, interest_amount, kind, status')
    .in('loan_id', ids);
  if (paymentError) throw new Error(paymentError.message);
  const memberIds = (contracts ?? []).map((loan) => loan.borrower_member_id).filter(Boolean);
  const { data: members, error: memberError } = await admin.from('members').select('id, display_name').in('id', memberIds);
  if (memberError) throw new Error(memberError.message);
  const names = new Map((members ?? []).map((member) => [member.id, member.display_name]));
  return (contracts ?? []).map((loan) => ({
    borrower: loan.borrower_member_id ? names.get(loan.borrower_member_id) : loan.external_borrower_name,
    principal: loan.principal,
    method: loan.method,
    rateUnit: loan.rate_unit,
    rateValue: loan.rate_value,
    termMonths: loan.term_months,
    startDate: loan.start_date,
    status: loan.status,
    legacyPaidCapital: loan.legacy_paid_capital_amount,
    legacyPaidInterest: loan.legacy_paid_interest_amount,
    payments: (payments ?? []).filter((payment) => payment.loan_id === loan.id)
      .map(({ loan_id: _, ...payment }) => payment)
      .sort((a, b) => a.payment_date.localeCompare(b.payment_date))
  })).sort((a, b) => a.borrower.localeCompare(b.borrower));
}

async function readSavingsSnapshot(page, viewport) {
  return await page.evaluate((viewport) => ({
    viewport,
    hash: location.hash,
    metrics: Array.from(document.querySelectorAll('[data-savings-metric-key]')).map((element) => ({
      key: element.getAttribute('data-savings-metric-key'),
      label: element.querySelector('[data-figure-label]')?.textContent?.trim() ?? '',
      value: element.querySelector('[data-figure-value]')?.textContent?.trim() ?? ''
    })),
    rows: Array.from(document.querySelectorAll(
      document.querySelector('.savings-members-panel')
        ? '.savings-members-panel [data-savings-member-row]'
        : 'table tbody tr'
    )).map((element) => ({
      key: element.getAttribute('data-savings-member-row'),
      text: element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    })),
    contributions: Array.from(document.querySelectorAll('[data-savings-contribution-row]')).map((element) => ({
      key: element.getAttribute('data-savings-contribution-row'),
      text: element.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    }))
  }), viewport);
}

async function readDashboardFigures(page, viewport) {
  return await page.evaluate((viewport) => ({
    viewport,
    hash: location.hash,
    figures: Array.from(document.querySelectorAll('[data-figure-key], .metrics > div')).map((element) => {
      const label = element.querySelector('[data-figure-label]')?.textContent?.trim()
        ?? element.querySelector('span')?.textContent?.trim()
        ?? '';
      const value = element.querySelector('[data-figure-value]')?.textContent?.trim()
        ?? element.querySelector('strong')?.textContent?.trim()
        ?? '';
      return {
        key: element.getAttribute('data-figure-key') ?? label.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        label,
        value
      };
    })
  }), viewport);
}

async function seedSyntheticDataset() {
  const env = await readEnvFile('.env.test.local');
  const supabaseUrl = env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SECRET_KEY;
  if (supabaseUrl !== 'http://127.0.0.1:55421' || !serviceKey) {
    throw new Error('UX baseline se nego a operar fuera de TEST local 55421.');
  }
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const workspace = await admin.from('workspaces').select('*').eq('name', 'Natillera E2E sintetica').single();
  if (workspace.error || !workspace.data) {
    throw new Error(workspace.error?.message ?? 'Workspace TEST no encontrado.');
  }
  const cycle = await admin.from('cycles').select('*').eq('workspace_id', workspace.data.id).eq('year', 2026).single();
  if (cycle.error || !cycle.data) {
    throw new Error(cycle.error?.message ?? 'Ciclo TEST no encontrado.');
  }
  const existingMember = await admin
    .from('members')
    .select('*')
    .eq('workspace_id', workspace.data.id)
    .eq('legacy_id', 'ux02b-socio-largo-001')
    .maybeSingle();
  if (existingMember.error) {
    throw new Error(existingMember.error.message);
  }
  const member = existingMember.data
    ? { data: existingMember.data, error: null }
    : await admin.from('members').insert({
      workspace_id: workspace.data.id,
      legacy_id: 'ux02b-socio-largo-001',
      display_name: 'Socio UX 02B con nombre largo sintetico',
      notes: 'Fixture visual UX-02B. No usar como dato real.'
    }).select('*').single();
  if (member.error || !member.data) {
    throw new Error(member.error?.message ?? 'No fue posible crear socio UX-02B.');
  }
  const existingCycleMember = await admin
    .from('cycle_members')
    .select('*')
    .eq('cycle_id', cycle.data.id)
    .eq('member_id', member.data.id)
    .maybeSingle();
  if (existingCycleMember.error) {
    throw new Error(existingCycleMember.error.message);
  }
  if (!existingCycleMember.data) {
    const cycleMember = await admin.from('cycle_members').insert({
      workspace_id: workspace.data.id,
      cycle_id: cycle.data.id,
      member_id: member.data.id,
      monthly_quota: '125000.00',
      participation_start_month: 1,
      participation_end_month: 12,
      participates_in_savings: true,
      participates_in_polla: true,
      participates_in_loan_profit: true,
      savings_status: 'active'
    });
    if (cycleMember.error) {
      throw new Error(cycleMember.error.message);
    }
  }
  if (suite === 'ux-04') {
    await seedUx04Dataset(admin, workspace.data, cycle.data);
  }
}

async function seedUx04Dataset(admin, workspace, cycle) {
  const users = await admin.auth.admin.listUsers();
  if (users.error) {
    throw new Error(users.error.message);
  }
  const actor = users.data.users.find((user) => user.email?.toLowerCase() === adminEmail);
  if (!actor) {
    throw new Error(`Usuario admin TEST ${adminEmail} no encontrado.`);
  }

  const fixtures = [
    {
      legacyId: 'ux04-socia-rango-parcial-001',
      name: 'Ana Maria UX04 rango febrero a noviembre',
      quota: '150000.00',
      start: 2,
      end: 11,
      polla: true,
      profit: true,
      contributions: [
        ['ux04-ana-feb', '150000.00', '2026-02-05', 2, 'bank_transfer', 'manual'],
        ['ux04-ana-mar-parcial', '75000.00', '2026-03-10', 3, 'cash', 'manual'],
        ['ux04-ana-sep-extra', '1250000.00', '2026-09-29', 10, 'bank_deposit', 'manual']
      ]
    },
    {
      legacyId: 'LEGACY-UX04-HEREDADO-00000000000000000002',
      name: 'Entidad heredada UX04 con identificador muy largo para migracion',
      quota: '200000.00',
      start: 1,
      end: 12,
      polla: false,
      profit: false,
      contributions: [
        ['ux04-legacy-jan', '200000.00', '2026-01-15', 1, 'other', 'legacy_operational_import'],
        ['ux04-legacy-oct-large', '2500000.00', '2026-10-01', 10, 'bank_transfer', 'legacy_operational_import']
      ]
    },
    {
      legacyId: 'ux04-socio-corto-003',
      name: 'Carlos UX04 junio agosto',
      quota: '90000.00',
      start: 6,
      end: 8,
      polla: true,
      profit: false,
      contributions: [
        ['ux04-carlos-jun', '90000.00', '2026-06-03', 6, 'cash', 'manual'],
        ['ux04-carlos-jul-partial', '45000.00', '2026-07-20', 7, 'cash', 'manual']
      ]
    }
  ];

  for (const fixture of fixtures) {
    const existingMember = await admin
      .from('members')
      .select('*')
      .eq('workspace_id', workspace.id)
      .eq('legacy_id', fixture.legacyId)
      .maybeSingle();
    if (existingMember.error) {
      throw new Error(existingMember.error.message);
    }
    const memberResult = existingMember.data
      ? { data: existingMember.data, error: null }
      : await admin.from('members').insert({
        workspace_id: workspace.id,
        legacy_id: fixture.legacyId,
        display_name: fixture.name,
        notes: 'Fixture visual UX-04. No usar como dato real.'
      }).select('*').single();
    if (memberResult.error || !memberResult.data) {
      throw new Error(memberResult.error?.message ?? `No fue posible crear miembro ${fixture.legacyId}.`);
    }

    const existingCycleMember = await admin
      .from('cycle_members')
      .select('*')
      .eq('cycle_id', cycle.id)
      .eq('member_id', memberResult.data.id)
      .maybeSingle();
    if (existingCycleMember.error) {
      throw new Error(existingCycleMember.error.message);
    }
    const cycleMemberResult = existingCycleMember.data
      ? { data: existingCycleMember.data, error: null }
      : await admin.from('cycle_members').insert({
        workspace_id: workspace.id,
        cycle_id: cycle.id,
        member_id: memberResult.data.id,
        monthly_quota: fixture.quota,
        participation_start_month: fixture.start,
        participation_end_month: fixture.end,
        participates_in_savings: true,
        participates_in_polla: fixture.polla,
        participates_in_loan_profit: fixture.profit,
        savings_status: 'active'
      }).select('*').single();
    if (cycleMemberResult.error || !cycleMemberResult.data) {
      throw new Error(cycleMemberResult.error?.message ?? `No fue posible crear participacion ${fixture.legacyId}.`);
    }

    for (const [key, amount, effectiveDate, appliedMonth, method, source] of fixture.contributions) {
      const contribution = await admin.from('savings_contributions').upsert({
        workspace_id: workspace.id,
        cycle_id: cycle.id,
        member_id: memberResult.data.id,
        cycle_member_id: cycleMemberResult.data.id,
        idempotency_key: key,
        amount,
        effective_date: effectiveDate,
        applied_year: cycle.year,
        applied_month: appliedMonth,
        method,
        source,
        actor_user_id: actor.id
      }, { onConflict: 'workspace_id,idempotency_key' });
      if (contribution.error) {
        throw new Error(contribution.error.message);
      }
    }
  }
}

async function login(page, baseUrl) {
  const existingMessageIds = new Set((await listOtpMessages()).map((message) => message.ID));
  await page.goto(baseUrl);
  await page.getByLabel('Correo autorizado').fill(adminEmail);
  await page.getByRole('button', { name: 'Enviar codigo' }).click();
  await page.getByLabel('Codigo recibido').waitFor({ state: 'visible' });
  const token = await readLatestOtp(existingMessageIds);
  await page.getByLabel('Codigo recibido').fill(token);
  await page.getByRole('button', { name: 'Ingresar' }).click();
  await page.getByRole('navigation', { name: 'Secciones principales' }).waitFor({ state: 'visible' });
}

async function measureOverflow(page, route, viewport) {
  return await page.evaluate(({ route, viewport }) => {
    const doc = document.documentElement;
    const body = document.body;
    const tableWraps = Array.from(document.querySelectorAll('.table-wrap')).map((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      hasLocalScroll: element.scrollWidth > element.clientWidth + 1
    }));
    return {
      route,
      viewport,
      documentClientWidth: doc.clientWidth,
      documentScrollWidth: doc.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      hasGlobalOverflow: doc.scrollWidth > doc.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1,
      tableWraps
    };
  }, { route, viewport });
}

async function listOtpMessages() {
  const response = await fetch('http://127.0.0.1:55424/api/v1/messages');
  if (!response.ok) {
    throw new Error(`No se pudo leer Mailpit: ${response.status}`);
  }
  const inbox = await response.json();
  return (inbox.messages ?? []).filter((message) =>
    message.To?.some((recipient) => recipient.Address.toLowerCase() === adminEmail)
  );
}

async function readLatestOtp(excludedMessageIds) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const message = (await listOtpMessages()).find((candidate) => !excludedMessageIds.has(candidate.ID));
    if (!message) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    const detailResponse = await fetch(`http://127.0.0.1:55424/api/v1/message/${encodeURIComponent(message.ID)}`);
    const detail = await detailResponse.json();
    const token = `${detail.Text ?? ''}\n${detail.HTML ?? ''}`.match(/\b\d{6}\b/)?.[0];
    if (token) {
      return token;
    }
    excludedMessageIds.add(message.ID);
  }
  throw new Error(`No hay correo OTP nuevo para ${adminEmail}.`);
}

async function waitForHttp(url) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw new Error(`El servidor no respondio en ${url}.`);
}

async function readEnvFile(fileName) {
  const contents = await readFile(fileName, 'utf8');
  return Object.fromEntries(contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => {
      const [key, ...rest] = line.split('=');
      return [key, rest.join('=')];
    }));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, SUPABASE_ENV: 'test' }
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} fallo con codigo ${result.status}.`);
  }
}

function killProcessTree(pid) {
  if (!pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    try {
      process.kill(pid, 'SIGTERM');
    } catch {
      // Best-effort cleanup only.
    }
  }
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
