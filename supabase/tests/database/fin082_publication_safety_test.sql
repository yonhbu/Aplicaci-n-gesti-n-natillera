begin;

create extension if not exists pgtap;
select plan(12);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('08200000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fin082-admin@example.test', '', now(), now(), now());
insert into public.workspaces (id, name) values ('18200000-0000-0000-0000-000000000001', 'Workspace FIN082');
insert into public.workspace_users (workspace_id, user_id, role)
values ('18200000-0000-0000-0000-000000000001', '08200000-0000-0000-0000-000000000001', 'admin');
insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status, settlement_rules_version)
values ('28200000-0000-0000-0000-000000000001', '18200000-0000-0000-0000-000000000001', 2026, 'Ciclo FIN082', '2026-01-01', '2026-12-05', 'active', 'fin03-2026');
insert into public.members (id, workspace_id, display_name)
values ('38200000-0000-0000-0000-000000000001', '18200000-0000-0000-0000-000000000001', 'Socia sintetica FIN082');
insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_polla, participates_in_loan_profit)
values ('48200000-0000-0000-0000-000000000001', '18200000-0000-0000-0000-000000000001', '28200000-0000-0000-0000-000000000001', '38200000-0000-0000-0000-000000000001', 100000, true, true);

insert into public.fin_test_clock (id, civil_today) values (1, (now() at time zone 'America/Bogota')::date + 42);
set local role authenticated;
set local request.jwt.claim.sub = '08200000-0000-0000-0000-000000000001';

select ok(not has_table_privilege('authenticator', 'public.fin_test_clock', 'SELECT'), 'el rol de API no puede leer el reloj');
select is(public.fin_civil_today(), (now() at time zone 'America/Bogota')::date, 'una fila de reloj no activa el override por si sola');
set local natillera.test_clock_enabled = 'on';
select is(public.fin_civil_today(), (now() at time zone 'America/Bogota')::date + 42, 'una sesion SQL de prueba puede activar el reloj');
set local natillera.civil_today = '2026-04-02';

select public.create_bank_account('28200000-0000-0000-0000-000000000001', 'Banco A FIN082', 'TEST', '****0821');
select public.create_bank_account('28200000-0000-0000-0000-000000000001', 'Banco B FIN082', 'TEST', '****0822');
select public.register_savings_contribution('48200000-0000-0000-0000-000000000001', 'fin082-savings', 100000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.create_polla_activity('28200000-0000-0000-0000-000000000001', 2026, 2, 'Polla FIN082');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla FIN082'), '48200000-0000-0000-0000-000000000001', 'fin082-contribution', 10000, '2026-02-10');

create temporary table fin082_preview as
select public.preview_member_settlement('48200000-0000-0000-0000-000000000001', '2026-03-15', 0, 0, 0) as p;
select public.confirm_member_settlement(
  p_cycle_member_id => '48200000-0000-0000-0000-000000000001',
  p_idempotency_key => 'fin082-settlement',
  p_cut_date => '2026-03-15',
  p_annual_admin_fee => 0,
  p_penalty_amount => 0,
  p_other_discounts => 0,
  p_preview_hash => (select p->>'preview_hash' from fin082_preview)
);
select public.award_polla_prize_to_capital(
  (select id from public.polla_activities where name = 'Polla FIN082'),
  '48200000-0000-0000-0000-000000000001', 'fin082-prize-award', 40000, '2026-04-01'
);
select public.record_bank_opening('28200000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco A FIN082'), 'fin082-bank-opening', '2026-04-01', 100000, 'apertura sintetica');

select throws_ok(
  $sql$ select public.pay_polla_prize((select id from public.polla_prizes where idempotency_key = 'fin082-prize-award'), 'fin082-prize-payment', '2026-04-03', 'bank', (select id from public.bank_accounts where display_name = 'Banco A FIN082')) $sql$,
  'P0001', 'La entrega no puede registrarse con fecha futura.', 'rechaza una entrega futura'
);
select is((select count(*) from public.polla_prize_payments where idempotency_key = 'fin082-prize-payment'), 0::bigint, 'el rechazo no crea pago');
select lives_ok(
  $sql$ select public.pay_polla_prize((select id from public.polla_prizes where idempotency_key = 'fin082-prize-award'), 'fin082-prize-payment', '2026-04-02', 'bank', (select id from public.bank_accounts where display_name = 'Banco A FIN082')) $sql$,
  'entrega desde el banco con fecha civil valida'
);
select is(
  (select (public.pay_polla_prize((select id from public.polla_prizes where idempotency_key = 'fin082-prize-award'), 'fin082-prize-payment', '2026-04-02', 'bank', (select id from public.bank_accounts where display_name = 'Banco A FIN082'))).id),
  (select id from public.polla_prize_payments where idempotency_key = 'fin082-prize-payment'),
  'el reintento identico devuelve el mismo pago'
);
select throws_ok(
  $sql$ select public.pay_polla_prize((select id from public.polla_prizes where idempotency_key = 'fin082-prize-award'), 'fin082-prize-payment', '2026-04-02', 'bank', (select id from public.bank_accounts where display_name = 'Banco B FIN082')) $sql$,
  'P0001', 'La clave de idempotencia del pago de premio ya existe con otro contenido.', 'la misma clave no cambia de cuenta'
);
select throws_ok(
  $sql$ select public.pay_polla_prize((select id from public.polla_prizes where idempotency_key = 'fin082-prize-award'), 'fin082-prize-payment', '2026-04-02', 'cash', null) $sql$,
  'P0001', 'La clave de idempotencia del pago de premio ya existe con otro contenido.', 'la misma clave no cambia de banco a efectivo'
);
select throws_ok(
  $sql$ select public.pay_polla_prize((select id from public.polla_prizes where idempotency_key = 'fin082-prize-award'), 'fin082-prize-payment', '2026-04-01', 'bank', (select id from public.bank_accounts where display_name = 'Banco A FIN082')) $sql$,
  'P0001', 'La clave de idempotencia del pago de premio ya existe con otro contenido.', 'la misma clave no cambia la fecha'
);
select is((select count(*) from public.polla_prize_payments where idempotency_key = 'fin082-prize-payment'), 1::bigint, 'solo existe un pago');
select is(
  (select op.payload->>'liquidity_location' from public.polla_prize_payments pp join public.financial_operations op on op.id = pp.operation_id where pp.idempotency_key = 'fin082-prize-payment'),
  'bank', 'la ubicacion original queda en la operacion'
);

select * from finish();
rollback;
