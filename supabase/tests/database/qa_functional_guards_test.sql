begin;
create extension if not exists pgtap;
select plan(8);

insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
values('d0150000-0000-4000-8000-000000000001','authenticated','authenticated','qa-guards@example.test','',now(),now(),now());
insert into public.workspaces(id,name) values('d0150000-0000-4000-8000-000000000002','QA guard fixture');
insert into public.workspace_users(workspace_id,user_id,role) values('d0150000-0000-4000-8000-000000000002','d0150000-0000-4000-8000-000000000001','admin');
insert into public.cycles(id,workspace_id,year,name,starts_on,closes_on,status,settlement_rules_version) values
('d0150000-0000-4000-8000-000000000003','d0150000-0000-4000-8000-000000000002',2026,'FIN03 QA','2026-01-01','2026-12-05','active','fin03-2026'),
('d0150000-0000-4000-8000-000000000004','d0150000-0000-4000-8000-000000000002',2025,'Historical QA','2025-01-01','2025-12-05','active',null);
insert into public.members(id,workspace_id,display_name) values
('d0150000-0000-4000-8000-000000000005','d0150000-0000-4000-8000-000000000002','Fixed QA'),
('d0150000-0000-4000-8000-000000000006','d0150000-0000-4000-8000-000000000002','Collective QA');
insert into public.cycle_members(id,workspace_id,cycle_id,member_id,monthly_quota,participates_in_polla,participates_in_loan_profit) values
('d0150000-0000-4000-8000-000000000007','d0150000-0000-4000-8000-000000000002','d0150000-0000-4000-8000-000000000003','d0150000-0000-4000-8000-000000000005',100000,false,false),
('d0150000-0000-4000-8000-000000000008','d0150000-0000-4000-8000-000000000002','d0150000-0000-4000-8000-000000000003','d0150000-0000-4000-8000-000000000006',100000,true,true),
('d0150000-0000-4000-8000-000000000009','d0150000-0000-4000-8000-000000000002','d0150000-0000-4000-8000-000000000004','d0150000-0000-4000-8000-000000000005',100000,false,false);
set local role authenticated;
set local request.jwt.claim.sub='d0150000-0000-4000-8000-000000000001';
select public.create_polla_activity('d0150000-0000-4000-8000-000000000003',2026,10,'QA FIN03 polla');
select public.create_polla_activity('d0150000-0000-4000-8000-000000000004',2025,10,'QA historical polla');

select throws_ok(
  $$select public.register_polla_contribution((select id from public.polla_activities where name='QA FIN03 polla'),'d0150000-0000-4000-8000-000000000007','qa-fixed-reject',10000,'2026-10-05')$$,
  'P0001','Este socio solo ahorra al 12 % EA y no participa en polla.','QA-001: FIN03 rejects fixed-yield contributions');
select is((select count(*) from public.polla_contributions where idempotency_key='qa-fixed-reject'),0::bigint,'rejected contribution creates no domain row');
select is((select count(*) from public.financial_operations where cycle_id='d0150000-0000-4000-8000-000000000003'),0::bigint,'rejected contribution creates no ledger operation');
select lives_ok(
  $$select public.register_polla_contribution((select id from public.polla_activities where name='QA FIN03 polla'),'d0150000-0000-4000-8000-000000000008','qa-collective-allow',10000,'2026-10-05')$$,
  'collective contributions remain allowed');
select lives_ok(
  $$select public.register_polla_contribution((select id from public.polla_activities where name='QA historical polla'),'d0150000-0000-4000-8000-000000000009','qa-historical-allow',10000,'2025-10-05')$$,
  'historical cycles keep their existing policy');
select lives_ok($$select public.preview_bank_yield_distribution('d0150000-0000-4000-8000-000000000003','2026-12-05')$$,'bank preview still executes');
select lives_ok($$select public.preview_loan_profit_periods('d0150000-0000-4000-8000-000000000003','2026-12-05')$$,'profit preview still executes');
select is((select count(*) from (select operation_id from public.ledger_entries where workspace_id='d0150000-0000-4000-8000-000000000002' group by operation_id having sum(amount)<>0) x),0::bigint,'all fixture operations balance');
select * from finish();
rollback;
