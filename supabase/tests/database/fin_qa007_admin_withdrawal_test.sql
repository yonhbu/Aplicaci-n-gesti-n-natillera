begin;
create extension if not exists pgtap;
select plan(14);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('f0070000-0000-4000-8000-000000000001','authenticated','authenticated','fin-qa007@example.test','',now(),now(),now());
insert into public.workspaces(id,name) values('f0070000-0000-4000-8000-000000000002','FIN QA007 synthetic');
insert into public.workspace_users(workspace_id,user_id,role) values('f0070000-0000-4000-8000-000000000002','f0070000-0000-4000-8000-000000000001','admin');
insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version) values
('f0070000-0000-4000-8000-000000000003','f0070000-0000-4000-8000-000000000002',2026,'QA007','2026-01-01','2026-12-05','active','fin03-2026');
insert into public.members(id,workspace_id,display_name) values
('f0070000-0000-4000-8000-000000000004','f0070000-0000-4000-8000-000000000002','Ana QA007'),
('f0070000-0000-4000-8000-000000000005','f0070000-0000-4000-8000-000000000002','Beto QA007'),
('f0070000-0000-4000-8000-000000000006','f0070000-0000-4000-8000-000000000002','Carlos QA007');
insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_loan_profit) values
('f0070000-0000-4000-8000-000000000007','f0070000-0000-4000-8000-000000000002','f0070000-0000-4000-8000-000000000003','f0070000-0000-4000-8000-000000000004',100000,true,true),
('f0070000-0000-4000-8000-000000000008','f0070000-0000-4000-8000-000000000002','f0070000-0000-4000-8000-000000000003','f0070000-0000-4000-8000-000000000005',100000,true,true),
('f0070000-0000-4000-8000-000000000009','f0070000-0000-4000-8000-000000000002','f0070000-0000-4000-8000-000000000003','f0070000-0000-4000-8000-000000000006',100000,false,false);
set local natillera.civil_today='2026-10-16';
set local role authenticated;
set local request.jwt.claim.sub='f0070000-0000-4000-8000-000000000001';
select public.create_bank_account('f0070000-0000-4000-8000-000000000003','QA007 bank','','');
select public.record_bank_opening('f0070000-0000-4000-8000-000000000003',(select id from public.bank_accounts where display_name='QA007 bank'),'qa007-open','2026-01-01',100000,'synthetic opening');
select public.register_savings_contribution('f0070000-0000-4000-8000-000000000009','qa007-saving',10000,'2026-01-05',2026,1,'bank_transfer','manual');
select public.create_polla_activity('f0070000-0000-4000-8000-000000000003',2026,9,'QA007 polla');
select public.register_polla_contribution((select id from public.polla_activities where name='QA007 polla'),'f0070000-0000-4000-8000-000000000007','qa007-p1',10000,'2026-09-01');
select public.register_polla_contribution((select id from public.polla_activities where name='QA007 polla'),'f0070000-0000-4000-8000-000000000008','qa007-p2',10000,'2026-09-01');
select public.award_polla_prize_to_capital((select id from public.polla_activities where name='QA007 polla'),'f0070000-0000-4000-8000-000000000007','qa007-award',20000,'2026-09-02');
create temporary table qa007_available as select public.preview_admin_withdrawal('f0070000-0000-4000-8000-000000000003','2026-10-15') p;
select is((select (p->>'admin_balance')::numeric from qa007_available),5000::numeric,'gross administrative fund is 5000');
select ok((select (p->>'ea_reserve')::numeric from qa007_available)>0,'projects fixed saver EA through closing');
select ok((select (p->>'available')::numeric from qa007_available)<5000,'withdrawable fund excludes projected EA reserve');
select throws_ok($$select public.withdraw_admin_payable('f0070000-0000-4000-8000-000000000003','qa007-too-much','2026-10-15',5000,'synthetic reference','bank',(select id from public.bank_accounts where display_name='QA007 bank'))$$,'P0001','El retiro supera el saldo libre despues de reservar el 12 % EA hasta el cierre.','cannot withdraw committed EA coverage');
select throws_ok($$select public.withdraw_admin_payable('f0070000-0000-4000-8000-000000000003','qa007-no-cash','2026-10-15',1000,'synthetic reference','cash',null)$$,'P0001','No hay liquidez suficiente en el origen seleccionado.','unknown cash does not fund a cash withdrawal');
select throws_ok($$select public.withdraw_admin_payable('f0070000-0000-4000-8000-000000000003','qa007-no-origin','2026-10-15',1000,'synthetic reference')$$,'P0001','Seleccione banco con cuenta o efectivo como origen del retiro.','old signature cannot bypass location');
select lives_ok($$select public.withdraw_admin_payable('f0070000-0000-4000-8000-000000000003','qa007-bank','2026-10-15',1000,'synthetic bank receipt','bank',(select id from public.bank_accounts where display_name='QA007 bank'))$$,'withdraws from selected bank');
select is(public.cash_available_at('f0070000-0000-4000-8000-000000000003','2026-10-15','bank',(select id from public.bank_accounts where display_name='QA007 bank')),99000::numeric,'selected bank decreases by exact withdrawal');
select lives_ok($$select public.withdraw_admin_payable('f0070000-0000-4000-8000-000000000003','qa007-bank','2026-10-15',1000,'synthetic bank receipt','bank',(select id from public.bank_accounts where display_name='QA007 bank'))$$,'same withdrawal retry is idempotent');
select throws_ok($$select public.withdraw_admin_payable('f0070000-0000-4000-8000-000000000003','qa007-bank','2026-10-15',1000,'synthetic bank receipt','cash',null)$$,'P0001','La clave de idempotencia del retiro ya existe con otro contenido.','retry cannot change source');
select public.record_internal_liquidity_transfer('f0070000-0000-4000-8000-000000000003','qa007-cash','2026-10-15','bank',(select id from public.bank_accounts where display_name='QA007 bank'),'cash',null,2000,'synthetic cash source');
select public.withdraw_admin_payable('f0070000-0000-4000-8000-000000000003','qa007-cash-withdraw','2026-10-15',500,'synthetic cash receipt','cash',null);
select is(public.cash_available_at('f0070000-0000-4000-8000-000000000003','2026-10-15','cash',null),1500::numeric,'cash source decreases independently');
select is((public.preview_admin_withdrawal('f0070000-0000-4000-8000-000000000003','2026-10-15')->>'admin_balance')::numeric,3500::numeric,'fund decreases once per successful withdrawal');
select is((select count(*) from public.financial_operations where cycle_id='f0070000-0000-4000-8000-000000000003' and operation_type='admin_withdrawal'),2::bigint,'rejections and retry create no extra withdrawal');
select is((select count(*) from (select operation_id from public.ledger_entries where cycle_id='f0070000-0000-4000-8000-000000000003' group by operation_id having sum(amount)<>0) s),0::bigint,'all withdrawal operations balance');
select * from finish();
rollback;
