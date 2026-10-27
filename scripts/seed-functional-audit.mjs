import { createClient } from '@supabase/supabase-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { auditRuntime, auditSql } from './lib/audit-test-runtime.mjs';

export default async function seedAudit() {
  const runtime = auditRuntime();
  const admin = createClient(runtime.API_URL, runtime.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `audit-${suffix}@example.test`;
  const user = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (user.error) throw Error('No se pudo crear identidad sintética de auditoría.');
  const outsiderEmail = `audit-outsider-${suffix}@example.test`;
  const outsider = await admin.auth.admin.createUser({ email: outsiderEmail, email_confirm: true });
  if (outsider.error) throw Error('No se pudo crear identidad sintética sin membresía.');
  const workspaceId = crypto.randomUUID(), cycleId = crypto.randomUUID(), memberId = crypto.randomUUID(), participationId = crypto.randomUUID();
  auditSql(`begin;
    insert into public.workspaces(id,name) values('${workspaceId}','Auditoría sintética ${suffix}');
    insert into public.workspace_users(workspace_id,user_id,role) values('${workspaceId}','${user.data.user.id}','admin');
    insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status) values('${cycleId}','${workspaceId}',2026,'Ciclo sintético','2026-01-01','2026-12-05','active');
    insert into public.members(id,workspace_id,display_name) values('${memberId}','${workspaceId}','Prestataria sintética');
    insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota) values('${participationId}','${workspaceId}','${cycleId}','${memberId}',100000);
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${user.data.user.id}',true);
    select public.create_bank_account('${cycleId}','Pibank sintético','Pibank','****0000');
    select public.record_bank_opening('${cycleId}',(select id from public.bank_accounts where workspace_id='${workspaceId}'),'audit-opening','2026-08-01',2000000,'Fondeo sintético');
    select public.record_internal_liquidity_transfer('${cycleId}','audit-cash','2026-08-01','bank',(select id from public.bank_accounts where workspace_id='${workspaceId}'),'cash',null,1000000,'Fondeo sintético');
    create temporary table audit_loan as select id from public.create_loan_contract('${cycleId}','audit-p011','${memberId}',null,null,500000,'interest_only','MONTHLY_FIXED',0.05,4,'2026-08-01');
    select public.confirm_loan_disbursement((select id from audit_loan),'audit-disburse','2026-08-01');
    select public.record_loan_payment((select id from audit_loan),'audit-interest-1','2026-09-01',25000,0,25000,'regular');
    select public.record_loan_payment((select id from audit_loan),'audit-interest-2','2026-10-01',25000,0,25000,'regular');
    commit;`);
  const loanId = auditSql(`select id from public.loan_contracts where cycle_id='${cycleId}';`);
  const bankId = auditSql(`select id from public.bank_accounts where workspace_id='${workspaceId}';`);
  mkdirSync('incoming/functional-audit', { recursive: true });
  const today = auditSql('select public.fin_civil_today();');
  writeFileSync('incoming/functional-audit/fixture.json', JSON.stringify({ email, outsiderEmail, workspaceId, cycleId, memberId, participationId, loanId, bankId, today }, null, 2));
  console.log('Fixture sintético independiente creado exclusivamente en TEST55421/55422.');
}

if (process.argv[1]?.endsWith('seed-functional-audit.mjs')) await seedAudit();
