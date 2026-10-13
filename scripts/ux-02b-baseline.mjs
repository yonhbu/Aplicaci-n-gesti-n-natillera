import { chromium } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { spawn, spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const phase = readArg('--phase') ?? 'after';
const port = Number(readArg('--port') ?? '5182');
const outRoot = path.resolve('docs/ux/baseline/ux-02b', phase);
const adminEmail = 'e2e-admin@example.test';
const routes = [
  { name: 'home', hash: '#/home' },
  { name: 'ahorros', hash: '#/savings' },
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
  try {
    await login(page, baseUrl);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of routes) {
        await page.goto(`${baseUrl}/${route.hash}`);
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(250);
        const fileName = `${route.name}-${viewport.name}.png`;
        await page.screenshot({ path: path.join(outRoot, fileName), fullPage: false });
        measurements.push(await measureOverflow(page, route.name, viewport.name));
      }
    }
  } finally {
    await browser.close();
  }
  await writeFile(path.join(outRoot, 'measurements.json'), JSON.stringify(measurements, null, 2));
  await writeFile(path.join(outRoot, 'README.md'), [
    `# UX-02B baseline ${phase}`,
    '',
    `Fecha generada: ${new Date().toISOString()}`,
    'Entorno: TEST descartable con dataset sintetico fijo.',
    'Rutas: home, ahorros, movimientos.',
    'Viewports: 320, 375, 390, 768, 1024, 1440.',
    ''
  ].join('\n'));
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
