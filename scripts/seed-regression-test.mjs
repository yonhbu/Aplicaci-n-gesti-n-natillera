import { createClient } from '@supabase/supabase-js';
import { auditRuntime, auditSql } from './lib/audit-test-runtime.mjs';

// Rebuild the old QA browser scenario from versioned RPC contracts. All data is
// synthetic, including the deliberately unreconciled legacy receipt below.
export default async function seedRegression() {
  const runtime = auditRuntime();
  const admin = createClient(runtime.API_URL, runtime.SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = 'qa-audit-2026@example.test';
  const found = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (found.error) throw Error('No se pudo verificar la identidad QA sintética.');
  let user = found.data.users.find(item => item.email === email);
  if (!user) {
    const result = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (result.error) throw Error('No se pudo crear la identidad QA sintética.');
    user = result.data.user;
  }
  const id = n => 'a0150000-0000-4000-8000-' + String(n).padStart(12, '0');
  if (auditSql(`select count(*) from public.cycles where id='${id(2)}';`) === '1') return;
  auditSql(`begin;
    insert into public.workspaces(id,name) values('${id(1)}','Regresión CI sintética');
    insert into public.workspace_users(workspace_id,user_id,role) values('${id(1)}','${user.id}','admin');
    insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version)
      values('${id(2)}','${id(1)}',2026,'Regresión CI 2026','2026-01-01','2026-12-05','active','fin03-2026');
    insert into public.members(id,workspace_id,display_name) values
      ('${id(11)}','${id(1)}','QA Ana D Editada'),('${id(12)}','${id(1)}','QA Carla D');
    insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_loan_profit) values
      ('${id(21)}','${id(1)}','${id(2)}','${id(11)}',100000,true,true),('${id(22)}','${id(1)}','${id(2)}','${id(12)}',100000,true,true);
    set local role authenticated;
    select set_config('request.jwt.claim.sub','${user.id}',true);
    select public.create_bank_account('${id(2)}','Banco regresión sintético','','');
    select public.record_bank_opening('${id(2)}',(select id from public.bank_accounts where workspace_id='${id(1)}'),'ci-regression-opening','2026-08-01',1000000,'Fondeo sintético CI');
    select public.record_internal_liquidity_transfer('${id(2)}','ci-regression-cash','2026-08-01','bank',(select id from public.bank_accounts where workspace_id='${id(1)}'),'cash',null,500000,'Fondeo sintético CI');
    select public.register_savings_contribution('${id(22)}','ci-regression-carla-saving',200000,'2026-09-01',2026,9,'bank_transfer','manual');
    select public.record_bank_interest_received('${id(2)}',(select id from public.bank_accounts where workspace_id='${id(1)}'),'ci-regression-legacy-interest','2026-09-30',10000,100,100,'Recibo histórico sintético');
    select public.confirm_member_settlement('${id(22)}','ci-regression-carla-settlement','2026-10-10',0,0,0,public.preview_member_settlement('${id(22)}','2026-10-10',0,0,0)->>'preview_hash');
    reset role;
    -- Match the legacy gap tested by fin_qa010_frozen_yield_test.sql. The ledger
    -- and Carla's confirmed 4900 right remain; this is NOT a production repair.
    delete from public.bank_yield_rights where receipt_id in(select id from public.bank_yield_receipts where operation_id=(select id from public.financial_operations where cycle_id='${id(2)}' and idempotency_key='ci-regression-legacy-interest'));
    delete from public.bank_yield_receipts where operation_id=(select id from public.financial_operations where cycle_id='${id(2)}' and idempotency_key='ci-regression-legacy-interest');
    insert into public.members(id,workspace_id,display_name) values('${id(13)}','${id(1)}','QA Maira'),('${id(14)}','${id(1)}','QA Bruno D');
    insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_loan_profit) values
      ('${id(23)}','${id(1)}','${id(2)}','${id(13)}',100000,true,true),('${id(24)}','${id(1)}','${id(2)}','${id(14)}',100000,false,false);
    set local role authenticated;
    select public.record_bank_interest_received('${id(2)}',(select id from public.bank_accounts where workspace_id='${id(1)}'),'ci-regression-frozen-interest','2026-10-12',100,0,0,'Derechos sintéticos nuevos');
    create temporary table ci_ea as select id from public.create_loan_contract('${id(2)}','ci-regression-ea',null,'QA FIN móvil parcial',null,60000,'amortized','EA',0.12,2,'2026-09-01');
    select public.confirm_loan_disbursement((select id from ci_ea),'ci-regression-ea-disburse','2026-09-01');
    select public.record_loan_payment((select id from ci_ea),'ci-regression-ea-partial','2026-10-01',100,0,100,'regular');
    select public.record_loan_payment((select id from ci_ea),'ci-regression-ea-first','2026-10-01',29900,29438.51,461.49,'regular');
    select public.confirm_loan_prepayment((select id from ci_ea),'ci-regression-ea-prepay','2026-10-15',public.quote_loan_prepayment((select id from ci_ea),'2026-10-15')->>'quote_hash');
    commit;`);
  console.log('Regresiones QA históricas preparadas con datos sintéticos TEST.');
}
