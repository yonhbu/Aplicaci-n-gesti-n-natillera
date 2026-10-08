import { createClient } from '@supabase/supabase-js';
import { loadLocalEnv } from './load-local-env';

loadLocalEnv();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const workspaceName = process.env.NATILLERA_WORKSPACE_NAME;
const cycleName = process.env.NATILLERA_CYCLE_NAME ?? 'Natillera 2026';
const cycleYear = Number(process.env.NATILLERA_CYCLE_YEAR ?? '2026');
const cycleStart = process.env.NATILLERA_CYCLE_START ?? '2026-01-01';
const cycleClose = process.env.NATILLERA_CYCLE_CLOSE ?? '2026-12-15';
const adminEmails = (process.env.NATILLERA_ADMIN_EMAILS ?? '')
  .split(',')
  .map((email) => email.trim().toLowerCase())
  .filter(Boolean);

if (!supabaseUrl || !supabaseSecretKey || !workspaceName || adminEmails.length < 1) {
  throw new Error(
    'Faltan SUPABASE_URL, SUPABASE_SECRET_KEY, NATILLERA_WORKSPACE_NAME o NATILLERA_ADMIN_EMAILS.',
  );
}

const admin = createClient(supabaseUrl, supabaseSecretKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

if (process.env.SUPABASE_ENV === 'test' && supabaseUrl !== 'http://127.0.0.1:55421') {
  throw new Error(`Bootstrap TEST se nego a usar URL distinta de TEST local 55421: ${supabaseUrl}.`);
}

if (process.env.SUPABASE_ENV !== 'test' && supabaseUrl !== 'http://127.0.0.1:44121') {
  throw new Error(`Bootstrap DEV se nego a usar URL distinta de DEV local 44121: ${supabaseUrl}.`);
}

async function ensureAuthUser(email: string) {
  let page = 1;
  while (true) {
    const users = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (users.error) {
      throw new Error(users.error.message);
    }

    const existing = users.data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (existing) {
      return existing;
    }
    if (users.data.users.length < 1000) {
      break;
    }
    page += 1;
  }

  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error || !created.data.user) {
    throw new Error(created.error?.message ?? `No fue posible crear el usuario Auth ${email}.`);
  }
  return created.data.user;
}

async function main() {
  const existingWorkspace = await admin
    .from('workspaces')
    .select('*')
    .eq('name', workspaceName)
    .maybeSingle();

  if (existingWorkspace.error) {
    throw new Error(existingWorkspace.error.message);
  }

  const workspaceResult = existingWorkspace.data
    ? { data: existingWorkspace.data, error: null }
    : await admin
      .from('workspaces')
      .insert({ name: workspaceName })
      .select('*')
      .single();

  if (workspaceResult.error || !workspaceResult.data) {
    throw new Error(workspaceResult.error?.message ?? 'No fue posible asegurar el workspace.');
  }

  const workspace = workspaceResult.data;

  const existingCycle = await admin
    .from('cycles')
    .select('*')
    .eq('workspace_id', workspace.id)
    .eq('year', cycleYear)
    .maybeSingle();

  if (existingCycle.error) {
    throw new Error(existingCycle.error.message);
  }

  const cycleResult = existingCycle.data
    ? { data: existingCycle.data, error: null }
    : await admin
    .from('cycles')
    .insert(
      {
        workspace_id: workspace.id,
        year: cycleYear,
        name: cycleName,
        starts_on: cycleStart,
        closes_on: cycleClose,
        status: 'active'
      },
    )
    .select('*')
    .single();

  if (cycleResult.error || !cycleResult.data) {
    throw new Error(cycleResult.error?.message ?? 'No fue posible asegurar el ciclo.');
  }

  if (existingCycle.data) {
    const mismatches = [
      existingCycle.data.name !== cycleName ? 'nombre' : '',
      existingCycle.data.starts_on !== cycleStart ? 'fecha inicial' : '',
      existingCycle.data.closes_on !== cycleClose ? 'fecha de cierre' : ''
    ].filter(Boolean);
    if (mismatches.length > 0) {
      console.warn(`Ciclo existente conservado sin cambios; difiere en: ${mismatches.join(', ')}.`);
    }
  }

  for (const email of adminEmails) {
    const user = await ensureAuthUser(email);
    const membership = await admin.from('workspace_users').upsert(
      {
        workspace_id: workspace.id,
        user_id: user.id,
        role: 'admin'
      },
      { onConflict: 'workspace_id,user_id' },
    );
    if (membership.error) {
      throw new Error(membership.error.message);
    }
  }

  console.log(`Workspace "${workspace.name}" y ciclo "${cycleResult.data.name}" listos para ${adminEmails.length} usuario(s).`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
