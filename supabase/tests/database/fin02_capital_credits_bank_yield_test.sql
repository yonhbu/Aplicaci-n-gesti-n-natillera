begin;

create extension if not exists pgtap;
select plan(18);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('08000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fin02-admin@example.test', '', now(), now(), now());
insert into public.workspaces (id, name) values ('18000000-0000-0000-0000-000000000001', 'Workspace FIN02');
insert into public.workspace_users (workspace_id, user_id, role) values ('18000000-0000-0000-0000-000000000001', '08000000-0000-0000-0000-000000000001', 'admin');
insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status)
values ('28000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001', 2026, 'Ciclo FIN02', '2026-01-01', '2026-12-15', 'active');

-- 3 socios juegan polla, 1 solo ahorra.
insert into public.members (id, workspace_id, display_name)
values
  ('38000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001', 'Polla Uno'),
  ('38000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000001', 'Polla Dos'),
  ('38000000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-000000000001', 'Polla Tres'),
  ('38000000-0000-0000-0000-000000000004', '18000000-0000-0000-0000-000000000001', 'Solo Ahorro');
insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_polla)
values
  ('48000000-0000-0000-0000-000000000001', '18000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', '38000000-0000-0000-0000-000000000001', 100000, true),
  ('48000000-0000-0000-0000-000000000002', '18000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', '38000000-0000-0000-0000-000000000002', 100000, true),
  ('48000000-0000-0000-0000-000000000003', '18000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', '38000000-0000-0000-0000-000000000003', 100000, true),
  ('48000000-0000-0000-0000-000000000004', '18000000-0000-0000-0000-000000000001', '28000000-0000-0000-0000-000000000001', '38000000-0000-0000-0000-000000000004', 100000, false);

-- FIN-04: el reparto Pibank exige reglas activadas y la fecha de cierre.
update public.cycles set settlement_rules_version = 'fin03-2026' where id = '28000000-0000-0000-0000-000000000001';
set local natillera.civil_today = '2026-12-15';
set local role authenticated;
set local request.jwt.claim.sub = '08000000-0000-0000-0000-000000000001';

select public.create_bank_account('28000000-0000-0000-0000-000000000001', 'Banco FIN02', 'Banco', '****0002');
select public.register_savings_contribution('48000000-0000-0000-0000-000000000004', 'fin02-save-4', 1000000, '2026-01-05', 2026, 1, 'bank_transfer', 'manual');
select public.create_polla_activity('28000000-0000-0000-0000-000000000001', 2026, 3, 'Polla FIN02');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla FIN02'), '48000000-0000-0000-0000-000000000001', 'fin02-p1', 10000, '2026-03-05');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla FIN02'), '48000000-0000-0000-0000-000000000002', 'fin02-p2', 10000, '2026-03-05');

-- 1. Premio de 50.000: 45.000 al capital del ganador y 5.000 al administrador, sin tocar caja.
create temporary table fin02_cash_before as
  select coalesce(sum(amount), 0) as total from public.ledger_entries where cycle_id = '28000000-0000-0000-0000-000000000001' and account = 'cash';
select lives_ok(
  $$ select public.award_polla_prize_to_capital((select id from public.polla_activities where name = 'Polla FIN02'), '48000000-0000-0000-0000-000000000001', 'fin02-award-1', 50000, '2026-03-06') $$,
  'asigna premio y lo acredita al capital'
);
select is((select amount from public.member_capital_credits where source_type = 'polla_prize' and cycle_member_id = '48000000-0000-0000-0000-000000000001'), 45000::numeric, 'ganador recibe 45000 en capital');
select is((select admin_commission from public.polla_prizes where idempotency_key = 'fin02-award-1'), 5000::numeric, 'administrador recibe 5000');
select is((select coalesce(sum(amount), 0) from public.ledger_entries where cycle_id = '28000000-0000-0000-0000-000000000001' and account = 'cash'), (select total from fin02_cash_before), 'acreditar el premio no cambia la caja');
select is((select status from public.polla_prizes where idempotency_key = 'fin02-award-1'), 'settled', 'premio queda acreditado');

-- 2. Reintento no duplica y el efectivo queda bloqueado.
select lives_ok(
  $$ select public.award_polla_prize_to_capital((select id from public.polla_activities where name = 'Polla FIN02'), '48000000-0000-0000-0000-000000000001', 'fin02-award-1', 50000, '2026-03-06') $$,
  'reintento con la misma clave no falla'
);
select is((select count(*) from public.member_capital_credits where source_type = 'polla_prize'), 1::bigint, 'reintento no duplica el abono');
select throws_ok(
  $$ select public.pay_polla_prize((select id from public.polla_prizes where idempotency_key = 'fin02-award-1'), 'fin02-cash', '2026-03-07') $$,
  null, null, 'pago en efectivo de premios deshabilitado'
);

-- 3. Liquidacion: quien juega polla no recibe 12 % EA y su capital incluye el premio.
select is(((public.preview_member_settlement('48000000-0000-0000-0000-000000000001', '2026-12-15', 0, 0, 0))->>'capital')::numeric, 45000::numeric, 'capital incluye premio acreditado');
select is(((public.preview_member_settlement('48000000-0000-0000-0000-000000000001', '2026-12-15', 0, 0, 0))->>'recognized_yield')::numeric, 0::numeric, 'jugador de polla sin 12 % EA');
select ok(((public.preview_member_settlement('48000000-0000-0000-0000-000000000004', '2026-12-15', 0, 0, 0))->>'recognized_yield')::numeric > 0, 'ahorrador sin polla recibe 12 % EA');

-- 4. Rendimiento bancario: neto recibido menos reserva del 12 % EA, en partes iguales entre los 3 de polla.
select public.record_bank_interest_received('28000000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco FIN02'), 'fin02-int-1', '2026-12-01', 300000, 0, 0, 'interes ficticio');
create temporary table fin02_preview as
  select public.preview_bank_yield_distribution('28000000-0000-0000-0000-000000000001', '2026-12-15') as p;
select is((select (p->>'pool')::numeric from fin02_preview), 300000::numeric, 'FIN-03: sin reserva del 12 % EA, la bolsa es todo el neto recibido');
select is((select (p->>'beneficiary_count')::int from fin02_preview), 3, 'solo los 3 socios activos de polla');
select lives_ok(
  $$ select public.confirm_bank_yield_distribution('28000000-0000-0000-0000-000000000001', '2026-12-15', 'fin02-yield-1', (select p->>'preview_hash' from fin02_preview)) $$,
  'confirma el reparto'
);
select is((select count(*) from public.member_capital_credits where source_type = 'bank_yield' and cycle_member_id = '48000000-0000-0000-0000-000000000004'), 0::bigint, 'socio sin polla recibe 0 del reparto');
select is(
  (select sum(amount) from public.member_capital_credits where source_type = 'bank_yield'),
  (select (p->>'pool')::numeric from fin02_preview),
  'FIN-03: el reparto suma exacto la bolsa, sin sobrante al administrador'
);

-- FIN-06: la liquidacion no vuelve a reconocer el premio acreditado.
select is(
  (public.preview_member_settlement('48000000-0000-0000-0000-000000000001', '2026-12-15', 0, 0, 0)->>'pending_net_prizes')::numeric,
  0::numeric,
  'premio acreditado no aparece como premio pendiente en la liquidacion'
);
select is(
  (select count(*) from jsonb_array_elements(public.preview_member_settlement('48000000-0000-0000-0000-000000000001', '2026-12-15', 0, 0, 0)->'credit_items') x where x->>'source_type' = 'polla_prize'),
  1::bigint,
  'el premio cuenta una sola vez en el capital'
);

select * from finish();
rollback;
