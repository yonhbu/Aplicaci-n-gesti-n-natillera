// TEST bootstrap: ephemeral identity/workspace, credentials only in Node memory.
import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { auditRuntime, auditSql } from './lib/audit-test-runtime.mjs';
export default async function bootstrapSyntheticE2E() {
  const runtime = auditRuntime();
  const admin = createClient(runtime.API_URL, runtime.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = crypto.randomUUID().slice(0,8), email = 'e2e-admin-' + suffix + '@example.test';
  const user = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (user.error) {
    const detail = `${user.error.status ?? ''} ${user.error.code ?? ''}: ${user.error.message}`
      .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+|sb_(?:secret|publishable)_[\w-]+/g, '[redacted]');
    throw Error(`No se pudo preparar la identidad sintética E2E (${detail}).`);
  }
  const workspaceId = crypto.randomUUID(), cycleId = crypto.randomUUID();
  auditSql(`begin;
    insert into public.workspaces(id,name) values('${workspaceId}','Natillera E2E sintética ${suffix}');
    insert into public.workspace_users(workspace_id,user_id,role) values('${workspaceId}','${user.data.user.id}','admin');
    insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status) values('${cycleId}','${workspaceId}',2026,'Natillera E2E 2026','2026-01-01','2026-12-05','active');
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${user.data.user.id}',true);
    select public.create_bank_account('${cycleId}','Fondeo E2E sintético','','');
    select public.record_bank_opening('${cycleId}',(select id from public.bank_accounts where workspace_id='${workspaceId}'),'e2e-opening','2026-08-01',1000000,'Fondeo sintético');
    select public.record_internal_liquidity_transfer('${cycleId}','e2e-cash','2026-08-01','bank',(select id from public.bank_accounts where workspace_id='${workspaceId}'),'cash',null,1000000,'Fondeo sintético');
    commit;`);
  process.env.NATILLERA_ADMIN_EMAILS = email;
  mkdirSync('incoming/ci-database', { recursive: true });
  writeFileSync('incoming/ci-database/bootstrap.json', JSON.stringify({ email,workspaceId,cycleId },null,2));
  console.log('Fixture sintético E2E preparado exclusivamente en TEST55421.');
}
if (process.argv[1]?.endsWith('bootstrap-test.mjs')) await bootstrapSyntheticE2E();
