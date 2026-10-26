begin;
create extension if not exists pgtap;
select plan(20);
insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values
('f0100000-0000-4000-8000-000000000001','authenticated','authenticated','fin-qa010@example.test','',now(),now(),now());
insert into public.workspaces(id,name) values('f0100000-0000-4000-8000-000000000002','FIN QA010 synthetic');
insert into public.workspace_users(workspace_id,user_id,role) values('f0100000-0000-4000-8000-000000000002','f0100000-0000-4000-8000-000000000001','admin');
insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version) values
('f0100000-0000-4000-8000-000000000003','f0100000-0000-4000-8000-000000000002',2026,'QA010','2026-01-01','2026-12-05','active','fin03-2026');
insert into public.members(id,workspace_id,display_name) values
('f0100000-0000-4000-8000-000000000004','f0100000-0000-4000-8000-000000000002','Ana QA010'),
('f0100000-0000-4000-8000-000000000005','f0100000-0000-4000-8000-000000000002','Carla QA010');
insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_loan_profit) values
('f0100000-0000-4000-8000-000000000006','f0100000-0000-4000-8000-000000000002','f0100000-0000-4000-8000-000000000003','f0100000-0000-4000-8000-000000000004',100000,true,true),
('f0100000-0000-4000-8000-000000000007','f0100000-0000-4000-8000-000000000002','f0100000-0000-4000-8000-000000000003','f0100000-0000-4000-8000-000000000005',100000,true,true);
set local role authenticated;
set local request.jwt.claim.sub='f0100000-0000-4000-8000-000000000001';
select public.create_bank_account('f0100000-0000-4000-8000-000000000003','QA010 bank','','');
select public.register_savings_contribution('f0100000-0000-4000-8000-000000000007','qa010-saving',200000,'2026-09-01',2026,9,'bank_transfer','manual');
select public.record_bank_interest_received('f0100000-0000-4000-8000-000000000003',(select id from public.bank_accounts where display_name='QA010 bank'),'qa010-bank-1','2026-09-30',10000,100,100,'synthetic receipt');
select is((select count(*) from public.bank_yield_rights where cycle_id='f0100000-0000-4000-8000-000000000003'),2::bigint,'receipt freezes two individual rights');
select is((select sum(amount) from public.bank_yield_rights where cycle_id='f0100000-0000-4000-8000-000000000003'),9800::numeric,'rights equal net receipt');
select public.confirm_member_settlement('f0100000-0000-4000-8000-000000000007','qa010-settle','2026-10-10',0,0,0,public.preview_member_settlement('f0100000-0000-4000-8000-000000000007','2026-10-10',0,0,0)->>'preview_hash');
select is((select (snapshot->>'bank_yield_share')::numeric from public.member_settlements where idempotency_key='qa010-settle'),4900::numeric,'confirmed settlement fixes 4900');
reset role;
insert into public.members(id,workspace_id,display_name) values('f0100000-0000-4000-8000-000000000008','f0100000-0000-4000-8000-000000000002','Maira QA010');
insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_loan_profit) values
('f0100000-0000-4000-8000-000000000009','f0100000-0000-4000-8000-000000000002','f0100000-0000-4000-8000-000000000003','f0100000-0000-4000-8000-000000000008',100000,true,true);
set local role authenticated;
select is((select sum(amount) from public.bank_yield_rights where cycle_member_id='f0100000-0000-4000-8000-000000000006'),4900::numeric,'retroactive new member does not dilute original Ana right');
select is((select count(*) from public.bank_yield_rights where cycle_member_id='f0100000-0000-4000-8000-000000000009'),0::bigint,'no retroactive rights invented for Maira');
select public.record_bank_interest_received('f0100000-0000-4000-8000-000000000003',(select id from public.bank_accounts where display_name='QA010 bank'),'qa010-bank-2','2026-10-12',1000,0,0,'prospective receipt');
create temporary table qa010_preview as select public.preview_bank_yield_distribution('f0100000-0000-4000-8000-000000000003','2026-12-05') p;
select is((select (p->>'pool')::numeric from qa010_preview),5900::numeric,'10800 received minus 4900 confirmed yields 5900');
select is((select (p->>'recognized_in_withdrawals')::numeric from qa010_preview),4900::numeric,'actual confirmed amount is authoritative');
select is((select (p->>'rights_mismatch')::numeric from qa010_preview),0::numeric,'individual rights reconcile exactly');
select throws_ok($$update public.bank_yield_rights set amount=1 where cycle_member_id='f0100000-0000-4000-8000-000000000006'$$,'42501',null,'client cannot rewrite frozen rights');
-- Simulate a legacy receipt without saved rights inside this rolled-back fixture only.
reset role;
delete from public.bank_yield_rights where receipt_id in(select id from public.bank_yield_receipts where operation_id=(select id from public.financial_operations where idempotency_key='qa010-bank-1'));
delete from public.bank_yield_receipts where operation_id=(select id from public.financial_operations where idempotency_key='qa010-bank-1');
set local role authenticated;
select is((public.preview_bank_yield_distribution('f0100000-0000-4000-8000-000000000003','2026-12-05')->>'confirmation_allowed')::boolean,false,'missing historical rights block distribution');
select throws_ok($$select public.reconcile_bank_yield_receipt((select id from public.financial_operations where idempotency_key='qa010-bank-1'),'[{"cycle_member_id":"f0100000-0000-4000-8000-000000000007","amount":4901}]','Verified synthetic evidence QA010')$$,'P0001','La conciliacion aumentaria un derecho ya liquidado; requiere correccion financiera explicita.','reconciliation cannot silently increase confirmed Carla rights');
select lives_ok($$select public.reconcile_bank_yield_receipt((select id from public.financial_operations where idempotency_key='qa010-bank-1'),'[{"cycle_member_id":"f0100000-0000-4000-8000-000000000006","amount":4900},{"cycle_member_id":"f0100000-0000-4000-8000-000000000007","amount":4900}]','Verified synthetic evidence QA010')$$,'explicit historical reconciliation preserves original amounts');
select lives_ok($$select public.reconcile_bank_yield_receipt((select id from public.financial_operations where idempotency_key='qa010-bank-1'),'[{"cycle_member_id":"f0100000-0000-4000-8000-000000000007","amount":4900},{"cycle_member_id":"f0100000-0000-4000-8000-000000000006","amount":4900}]','Verified synthetic evidence QA010')$$,'canonical reconciliation retry accepts reordered identical rights');
select is((public.preview_bank_yield_distribution('f0100000-0000-4000-8000-000000000003','2026-12-05')->>'pool')::numeric,5900::numeric,'verified historical reconciliation retains exact remainder');
set local natillera.civil_today='2026-12-05';
select lives_ok($$select public.confirm_bank_yield_distribution('f0100000-0000-4000-8000-000000000003','2026-12-05','qa010-distribution',(select p->>'preview_hash' from qa010_preview))$$,'close distribution uses fixed rights');
select lives_ok($$select public.confirm_bank_yield_distribution('f0100000-0000-4000-8000-000000000003','2026-12-05','qa010-distribution',(select p->>'preview_hash' from qa010_preview))$$,'same distribution retry does not duplicate');
select is((select pool_amount from public.bank_yield_distributions where idempotency_key='qa010-distribution'),5900::numeric,'never distributes more than received minus confirmed');
select is((select count(*) from public.bank_yield_distributions where cycle_id='f0100000-0000-4000-8000-000000000003'),1::bigint,'only one distribution');
select is((select (snapshot->>'bank_yield_share')::numeric from public.member_settlements where idempotency_key='qa010-settle'),4900::numeric,'original settlement remains unchanged');
select is((select count(*) from (select operation_id from public.ledger_entries where cycle_id='f0100000-0000-4000-8000-000000000003' group by operation_id having sum(amount)<>0) s),0::bigint,'all operations balance');
select * from finish();
rollback;
