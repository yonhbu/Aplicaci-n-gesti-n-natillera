import { createClient } from '@supabase/supabase-js';
import { loadLocalEnv } from './load-local-env';

loadLocalEnv();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const workspaceName = process.env.NATILLERA_WORKSPACE_NAME ?? 'Natillera local';
const cycleYear = Number(process.env.NATILLERA_CYCLE_YEAR ?? '2026');
const demoLegacyId = 'demo-socio-prueba-hu001';

if (process.env.SUPABASE_ENV === 'test') {
  throw new Error('dev:demo es exclusivo de DEV local; no se ejecuta en TEST.');
}

if (supabaseUrl !== 'http://127.0.0.1:44121') {
  throw new Error(`dev:demo se nego a usar una URL distinta de DEV local 44121: ${supabaseUrl ?? 'sin SUPABASE_URL'}.`);
}

if (!supabaseSecretKey) {
  throw new Error('Falta SUPABASE_SECRET_KEY local para dev:demo.');
}

const admin = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

async function main() {
  const workspace = await admin.from('workspaces').select('*').eq('name', workspaceName).maybeSingle();
  if (workspace.error || !workspace.data) {
    throw new Error(workspace.error?.message ?? `Workspace DEV no encontrado: ${workspaceName}. Ejecuta dev:bootstrap primero.`);
  }

  const cycle = await admin
    .from('cycles')
    .select('*')
    .eq('workspace_id', workspace.data.id)
    .eq('year', cycleYear)
    .maybeSingle();

  if (cycle.error || !cycle.data) {
    throw new Error(cycle.error?.message ?? `Ciclo DEV ${cycleYear} no encontrado.`);
  }

  if (cycle.data.status !== 'active') {
    throw new Error(`dev:demo se nego a operar porque el ciclo ${cycleYear} esta ${cycle.data.status}.`);
  }

  const existingMember = await admin
    .from('members')
    .select('*')
    .eq('workspace_id', workspace.data.id)
    .eq('legacy_id', demoLegacyId)
    .maybeSingle();

  if (existingMember.error) {
    throw new Error(existingMember.error.message);
  }

  const member = existingMember.data
    ? existingMember.data
    : await insertMember(workspace.data.id);

  const existingCycleMember = await admin
    .from('cycle_members')
    .select('*')
    .eq('workspace_id', workspace.data.id)
    .eq('cycle_id', cycle.data.id)
    .eq('member_id', member.id)
    .maybeSingle();

  if (existingCycleMember.error) {
    throw new Error(existingCycleMember.error.message);
  }

  if (!existingCycleMember.data) {
    const inserted = await admin.from('cycle_members').insert({
      workspace_id: workspace.data.id,
      cycle_id: cycle.data.id,
      member_id: member.id,
      monthly_quota: '100000.00',
      participation_start_month: 1,
      participation_end_month: 12,
      participates_in_savings: true,
      participates_in_polla: false,
      participates_in_loan_profit: true
    });
    if (inserted.error) {
      throw new Error(inserted.error.message);
    }
  }

  console.log('Socio demo HU-001 asegurado: Socio prueba.');
}

async function insertMember(workspaceId: string) {
  const inserted = await admin
    .from('members')
    .insert({
      workspace_id: workspaceId,
      display_name: 'Socio prueba',
      legacy_id: demoLegacyId,
      notes: 'Fixture local creado por npm run dev:demo.'
    })
    .select('*')
    .single();

  if (inserted.error || !inserted.data) {
    throw new Error(inserted.error?.message ?? 'No fue posible crear Socio prueba.');
  }

  return inserted.data;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
