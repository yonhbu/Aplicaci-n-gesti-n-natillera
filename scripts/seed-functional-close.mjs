import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { auditRuntime, auditSql } from './lib/audit-test-runtime.mjs';

// Independent synthetic 2025 cycle with explicit FIN03 policy. Publication is
// already due in the actual server calendar. No clock or safety guard is changed.
export default async function seedFunctionalClose() {
  const runtime = auditRuntime();
  const admin = createClient(runtime.API_URL, runtime.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = crypto.randomUUID().slice(0, 8), email = `audit-close-${suffix}@example.test`;
  const user = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (user.error || !user.data.user) throw Error('No se pudo crear identidad sintética de publicación.');
  const userId = user.data.user.id, workspaceId = crypto.randomUUID(), cycleId = crypto.randomUUID();
  const memberA = crypto.randomUUID(), memberB = crypto.randomUUID(), participationA = crypto.randomUUID(), participationB = crypto.randomUUID();
  // Contracts follow fin08 publication and fin05 periods fixtures; every amount,
  // identity and reference below is synthetic and belongs only to this workspace.
  auditSql(`begin;
    insert into public.workspaces(id,name) values('${workspaceId}','Publicación sintética ${suffix}');
    insert into public.workspace_users(workspace_id,user_id,role) values('${workspaceId}','${userId}','admin');
    insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version)
      values('${cycleId}','${workspaceId}',2025,'Publicación sintética 2025','2025-01-01','2025-12-05','active','fin03-2026');
    insert into public.members(id,workspace_id,display_name) values('${memberA}','${workspaceId}','Socio colectivo sintético'),('${memberB}','${workspaceId}','Socia 12 EA sintética');
    insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_loan_profit)
      values('${participationA}','${workspaceId}','${cycleId}','${memberA}',10000,true,true),
            ('${participationB}','${workspaceId}','${cycleId}','${memberB}',10000,false,false);
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${userId}',true);
    select public.create_bank_account('${cycleId}','Banco publicación sintético','Banco sintético','****0000');
    select public.record_bank_opening('${cycleId}',(select id from public.bank_accounts where workspace_id='${workspaceId}'),'close-opening','2025-02-01',2000000,'Fondeo sintético de publicación');
    select public.record_internal_liquidity_transfer('${cycleId}','close-cash','2025-08-01','bank',(select id from public.bank_accounts where workspace_id='${workspaceId}'),'cash',null,500000,'Desembolso sintético');
    select public.register_savings_contribution('${participationA}','close-saving-a',10000,'2025-02-05',2025,2,'bank_transfer','manual');
    select public.register_savings_contribution('${participationB}','close-saving-b',10000,'2025-02-05',2025,2,'bank_transfer','manual');
    create temporary table close_loan as select id from public.create_loan_contract('${cycleId}','close-loan',null,'Deudor externo sintético',null,500000,'fixed_interest','MONTHLY_FIXED',0.20,4,'2025-08-01');
    select public.confirm_loan_disbursement((select id from close_loan),'close-disburse','2025-08-01');
    select public.record_located_loan_payment((select id from close_loan),'close-interest','2025-09-01',100000,0,100000,'regular',(select id from public.bank_accounts where workspace_id='${workspaceId}'),null);
    select public.record_bank_interest_received('${cycleId}',(select id from public.bank_accounts where workspace_id='${workspaceId}'),'close-bank-yield','2025-09-30',10000,0,0,'Rendimiento sintético con derechos congelados');
    commit;`);
  const bankId = auditSql(`select id from public.bank_accounts where workspace_id='${workspaceId}';`);
  mkdirSync('incoming/functional-audit', { recursive: true });
  const today = auditSql('select public.fin_civil_today();');
  writeFileSync('incoming/functional-audit/close-fixture.json', JSON.stringify({ email, userId, workspaceId, cycleId, bankId, participationA, participationB, today }, null, 2));
  console.log('Fixture de publicación sintético preparado exclusivamente en TEST55421/55422; reloj conservado.');
}

if (process.argv[1]?.endsWith('seed-functional-close.mjs')) await seedFunctionalClose();
