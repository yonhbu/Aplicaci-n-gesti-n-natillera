begin;

create extension if not exists pgtap;
select plan(9);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('09000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fin01-admin@example.test', '', now(), now(), now());

insert into public.workspaces (id, name)
values ('19000000-0000-0000-0000-000000000001', 'Workspace FIN01');

insert into public.workspace_users (workspace_id, user_id, role)
values ('19000000-0000-0000-0000-000000000001', '09000000-0000-0000-0000-000000000001', 'admin');

insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status)
values ('29000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 2026, 'Ciclo FIN01', '2026-01-01', '2026-12-15', 'active');

insert into public.members (id, workspace_id, display_name)
values
  ('39000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', 'Socio FIN01 Uno'),
  ('39000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000001', 'Socio FIN01 Dos');

insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_polla)
values
  ('49000000-0000-0000-0000-000000000001', '19000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000001', 100000, true),
  ('49000000-0000-0000-0000-000000000002', '19000000-0000-0000-0000-000000000001', '29000000-0000-0000-0000-000000000001', '39000000-0000-0000-0000-000000000002', 100000, true);

set local role authenticated;
set local request.jwt.claim.sub = '09000000-0000-0000-0000-000000000001';

select public.create_polla_activity('29000000-0000-0000-0000-000000000001', 2026, 10, 'Polla FIN01 A');
select public.create_polla_activity('29000000-0000-0000-0000-000000000001', 2026, 10, 'Polla FIN01 B');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla FIN01 A'), '49000000-0000-0000-0000-000000000001', 'fin01-a-1', 30000, '2026-10-06');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla FIN01 A'), '49000000-0000-0000-0000-000000000002', 'fin01-a-2', 30000, '2026-10-06');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla FIN01 B'), '49000000-0000-0000-0000-000000000001', 'fin01-b-1', 30000, '2026-10-06');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla FIN01 B'), '49000000-0000-0000-0000-000000000002', 'fin01-b-2', 30000, '2026-10-06');
select public.award_polla_prize((select id from public.polla_activities where name = 'Polla FIN01 A'), '49000000-0000-0000-0000-000000000001', 'fin01-award-a', 40000, '2026-10-06');
select public.award_polla_prize((select id from public.polla_activities where name = 'Polla FIN01 B'), '49000000-0000-0000-0000-000000000002', 'fin01-award-b', 40000, '2026-10-06');

select is(
  (select legacy_payment_status from public.polla_prizes where idempotency_key = 'fin01-award-a'),
  'pending_payment',
  'premio creado en la app no queda como historico sin verificar'
);

select lives_ok(
  $$ select public.pay_polla_prize((select id from public.polla_prizes where idempotency_key = 'fin01-award-a'), 'fin01-pay-a', '2026-10-07') $$,
  'premio creado en la app se puede pagar'
);

reset role;
update public.polla_prizes
set legacy_id = 'FIN01-LEGACY-B', legacy_payment_status = 'historical_payment_unverified'
where idempotency_key = 'fin01-award-b';
set local role authenticated;
set local request.jwt.claim.sub = '09000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ select public.pay_polla_prize((select id from public.polla_prizes where legacy_id = 'FIN01-LEGACY-B'), 'fin01-pay-b-blocked', '2026-10-07') $$,
  null,
  null,
  'premio historico sin verificar no se puede pagar'
);

select is(
  (select count(*) from public.polla_prize_payments where idempotency_key = 'fin01-pay-b-blocked'),
  0::bigint,
  'el intento bloqueado no crea pago'
);

select throws_ok(
  $$ select public.confirm_legacy_polla_prize_unpaid((select id from public.polla_prizes where legacy_id = 'FIN01-LEGACY-B'), '   ') $$,
  null,
  null,
  'la verificacion exige una nota'
);

select lives_ok(
  $$ select public.confirm_legacy_polla_prize_unpaid((select id from public.polla_prizes where legacy_id = 'FIN01-LEGACY-B'), 'Revisado extracto: no se pago') $$,
  'administrador confirma que el premio historico no se pago'
);

select is(
  (select legacy_verified_by from public.polla_prizes where legacy_id = 'FIN01-LEGACY-B'),
  '09000000-0000-0000-0000-000000000001'::uuid,
  'queda registrado quien verifico'
);

select lives_ok(
  $$ select public.pay_polla_prize((select id from public.polla_prizes where legacy_id = 'FIN01-LEGACY-B'), 'fin01-pay-b', '2026-10-07') $$,
  'premio verificado como no pagado se puede pagar'
);

select throws_ok(
  $$ select public.confirm_legacy_polla_prize_unpaid((select id from public.polla_prizes where legacy_id = 'FIN01-LEGACY-B'), 'otra vez') $$,
  null,
  null,
  'premio ya pagado no se puede volver a verificar'
);

select * from finish();
rollback;
