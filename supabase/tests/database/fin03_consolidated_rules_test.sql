begin;

create extension if not exists pgtap;
select plan(38);

-- Escenarios A (Daniela), B (Carlos), C (Annie), D (premio), E (Pibank), F (administracion).
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('09300000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fin03-admin@example.test', '', now(), now(), now());
insert into public.workspaces (id, name) values ('19300000-0000-0000-0000-000000000001', 'Workspace FIN03');
insert into public.workspace_users (workspace_id, user_id, role) values ('19300000-0000-0000-0000-000000000001', '09300000-0000-0000-0000-000000000001', 'admin');
insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status, settlement_rules_version)
values ('29300000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000001', 2026, 'Ciclo FIN03', '2026-01-01', '2026-12-05', 'active', 'fin03-2026');
insert into public.members (id, workspace_id, display_name)
values
  ('39300000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000001', 'Annie Sintetica'),
  ('39300000-0000-0000-0000-000000000002', '19300000-0000-0000-0000-000000000001', 'Bruno Sintetico'),
  ('39300000-0000-0000-0000-000000000003', '19300000-0000-0000-0000-000000000001', 'Carlos Sintetico'),
  ('39300000-0000-0000-0000-000000000004', '19300000-0000-0000-0000-000000000001', 'Daniela Sintetica');
insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_polla, participates_in_loan_profit)
values
  ('49300000-0000-0000-0000-000000000001', '19300000-0000-0000-0000-000000000001', '29300000-0000-0000-0000-000000000001', '39300000-0000-0000-0000-000000000001', 100000, true, true),
  ('49300000-0000-0000-0000-000000000002', '19300000-0000-0000-0000-000000000001', '29300000-0000-0000-0000-000000000001', '39300000-0000-0000-0000-000000000002', 100000, true, true),
  ('49300000-0000-0000-0000-000000000003', '19300000-0000-0000-0000-000000000001', '29300000-0000-0000-0000-000000000001', '39300000-0000-0000-0000-000000000003', 100000, false, false),
  ('49300000-0000-0000-0000-000000000004', '19300000-0000-0000-0000-000000000001', '29300000-0000-0000-0000-000000000001', '39300000-0000-0000-0000-000000000004', 100000, true, true);

select is((select economic_mode from public.cycle_members where id = '49300000-0000-0000-0000-000000000003'), 'fixed_yield', 'Carlos queda en modalidad B (12 % EA)');
select is((select economic_mode from public.cycle_members where id = '49300000-0000-0000-0000-000000000004'), 'collective', 'Daniela queda en modalidad A');

set local role authenticated;
set local request.jwt.claim.sub = '09300000-0000-0000-0000-000000000001';

select public.create_bank_account('29300000-0000-0000-0000-000000000001', 'Pibank FIN03', 'Pibank', '****0003');
select public.register_savings_contribution('49300000-0000-0000-0000-000000000001', 'fin03-s1', 100000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.register_savings_contribution('49300000-0000-0000-0000-000000000002', 'fin03-s2', 100000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.register_savings_contribution('49300000-0000-0000-0000-000000000003', 'fin03-s3', 100000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.register_savings_contribution('49300000-0000-0000-0000-000000000004', 'fin03-s4', 100000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');

-- Polla de agosto: Annie y Daniela pagan completo; Bruno paga parcial.
select public.create_polla_activity('29300000-0000-0000-0000-000000000001', 2026, 8, 'Polla agosto FIN03');
select public.create_polla_activity('29300000-0000-0000-0000-000000000001', 2026, 11, 'Polla noviembre FIN03');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla agosto FIN03'), '49300000-0000-0000-0000-000000000001', 'fin03-p-a', 10000, '2026-08-03');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla agosto FIN03'), '49300000-0000-0000-0000-000000000004', 'fin03-p-d', 10000, '2026-08-03');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla agosto FIN03'), '49300000-0000-0000-0000-000000000002', 'fin03-p-b', 5000, '2026-08-03');

select throws_ok(
  $$ select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla agosto FIN03'), '49300000-0000-0000-0000-000000000004', 'fin03-p-d2', 1, '2026-08-04') $$,
  null, null, 'no se puede pagar mas de $10.000 por actividad'
);
select throws_ok(
  $$ select public.award_polla_prize_to_capital((select id from public.polla_activities where name = 'Polla agosto FIN03'), '49300000-0000-0000-0000-000000000002', 'fin03-award-b', 25000, '2026-09-01') $$,
  null, null, 'un aporte parcial no habilita ganar'
);

-- Pibank agosto: 90.000 entre Annie, Bruno y Daniela (Carlos excluido).
select public.record_bank_interest_received('29300000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Pibank FIN03'), 'fin03-int-ago', '2026-08-31', 90000, 0, 0, 'rendimiento ficticio agosto');

-- Annie se retira el 15 de septiembre.
create temporary table fin03_annie as select public.preview_member_settlement('49300000-0000-0000-0000-000000000001', '2026-09-15', 0, 0, 0) as p;
select is((select (p->>'recognized_yield')::numeric from fin03_annie), 30000::numeric, 'Annie recibe su parte Pibank hasta el retiro, sin 12 % EA');
select is((select (p->>'annual_admin_fee')::numeric from fin03_annie), 20000::numeric, 'Annie paga administracion $$20.000');
select is((select (p->>'penalty')::numeric from fin03_annie), 50000::numeric, 'Annie paga multa $$50.000 por retiro anticipado');
select is((select (p->>'net')::numeric from fin03_annie), 60000::numeric, 'Annie: 100.000 + 30.000 - 20.000 - 50.000');
select lives_ok(
  $$ select public.confirm_member_settlement(p_cycle_member_id => '49300000-0000-0000-0000-000000000001', p_idempotency_key => 'fin03-settle-annie', p_cut_date => '2026-09-15', p_annual_admin_fee => 0, p_penalty_amount => 0, p_other_discounts => 0, p_preview_hash => (select p->>'preview_hash' from fin03_annie)) $$,
  'confirma la liquidacion de Annie'
);
select is(
  (select -sum(le.amount) from public.ledger_entries le join public.financial_operations fo on fo.id = le.operation_id where fo.operation_type = 'admin_fee_recognized' and le.account = 'admin_payable' and fo.cycle_id = '29300000-0000-0000-0000-000000000001'),
  20000::numeric, 'la administracion de Annie pasa al fondo del administrador'
);
select is((public.preview_member_settlement('49300000-0000-0000-0000-000000000001', '2026-12-05', 0, 0, 0)->>'annual_admin_fee')::numeric, 0::numeric, 'la administracion se cobra una sola vez');

-- Derechos de polla que sobreviven al retiro.
select throws_ok(
  $$ select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla noviembre FIN03'), '49300000-0000-0000-0000-000000000001', 'fin03-p-a-nov', 10000, '2026-11-03') $$,
  null, null, 'Annie no puede pagar pollas nuevas despues de retirarse'
);
select lives_ok(
  $$ select public.award_polla_prize_to_capital((select id from public.polla_activities where name = 'Polla agosto FIN03'), '49300000-0000-0000-0000-000000000001', 'fin03-award-a', 50000, '2026-10-01') $$,
  'Annie gana la polla de agosto que pago antes de retirarse'
);
select is((select status from public.polla_prizes where idempotency_key = 'fin03-award-a'), 'pending_payment', 'el premio de una retirada no se acredita a un ahorro ya liquidado');
select is((select count(*) from public.member_capital_credits where cycle_member_id = '49300000-0000-0000-0000-000000000001' and source_type = 'polla_prize'), 0::bigint, 'sin abono al capital liquidado');
select lives_ok(
  $$ select public.pay_polla_prize((select id from public.polla_prizes where idempotency_key = 'fin03-award-a'), 'fin03-pay-a', '2026-10-02', 'bank', (select id from public.bank_accounts where display_name = 'Pibank FIN03')) $$,
  'el premio de Annie se entrega como pago'
);
select throws_ok(
  $$ select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla agosto FIN03'), '49300000-0000-0000-0000-000000000002', 'fin03-p-b2', 5000, '2026-10-03') $$,
  null, null, 'una polla ya jugada no recibe mas aportes'
);

-- Pibank octubre y noviembre: solo Bruno y Daniela. Noviembre no divide exacto.
select public.record_bank_interest_received('29300000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Pibank FIN03'), 'fin03-int-oct', '2026-10-31', 60000, 0, 0, 'rendimiento ficticio octubre');
select public.record_bank_interest_received('29300000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Pibank FIN03'), 'fin03-int-nov', '2026-11-30', 1.01, 0, 0, 'rendimiento ficticio noviembre');

select ok(
  ((public.preview_member_settlement('49300000-0000-0000-0000-000000000003', '2026-12-05', 0, 0, 0))->>'recognized_yield')::numeric between 9860 and 9870,
  'Carlos recibe 12 % EA por 303 dias sobre su aporte del 5 de febrero'
);

create temporary table fin03_yield as select public.preview_bank_yield_distribution('29300000-0000-0000-0000-000000000001', '2026-12-05') as p;
select is((select (p->>'recognized_in_withdrawals')::numeric from fin03_yield), 30000::numeric, 'la parte de Annie ya se reconocio en su retiro');
select is((select (p->>'pool')::numeric from fin03_yield), 120001.01::numeric, 'bolsa al cierre: lo recibido menos lo ya reconocido a Annie');
select is((select (p->>'beneficiary_count')::int from fin03_yield), 2, 'beneficiarios al cierre: Bruno y Daniela');
-- FIN-04: no se confirma antes del cierre ni con otro corte.
set local natillera.civil_today = '2026-11-20';
select throws_ok(
  $$ select public.confirm_bank_yield_distribution('29300000-0000-0000-0000-000000000001', '2026-12-05', 'fin04-early', (select p->>'preview_hash' from fin03_yield)) $$,
  null, null, 'el reparto Pibank no se confirma antes del 5 de diciembre'
);
set local natillera.civil_today = '2026-12-05';
select throws_ok(
  $$ select public.confirm_bank_yield_distribution('29300000-0000-0000-0000-000000000001', '2026-11-30', 'fin04-cut', (select p->>'preview_hash' from fin03_yield)) $$,
  null, null, 'el corte del reparto debe ser la fecha de cierre'
);
select lives_ok(
  $$ select public.confirm_bank_yield_distribution('29300000-0000-0000-0000-000000000001', '2026-12-05', 'fin03-yield', (select p->>'preview_hash' from fin03_yield)) $$,
  'confirma el reparto Pibank al cierre'
);
select is((select sum(amount) from public.member_capital_credits where source_type = 'bank_yield'), 120001.01::numeric, 'el reparto conserva el total exacto, sin sobrante al administrador');
select is((select count(*) from public.member_capital_credits where source_type = 'bank_yield' and cycle_member_id in ('49300000-0000-0000-0000-000000000001', '49300000-0000-0000-0000-000000000003')), 0::bigint, 'ni Annie ni Carlos reciben del reparto al cierre');
select is((public.preview_member_settlement('49300000-0000-0000-0000-000000000004', '2026-12-05', 0, 0, 0)->>'penalty')::numeric, 0::numeric, 'Daniela al cierre: sin multa');

-- FIN-04: el fondo Pibank va en cuenta propia y no es capital de ahorro.
select is(
  (select -sum(le.amount) from public.ledger_entries le join public.financial_operations fo on fo.id = le.operation_id
   where fo.operation_type = 'bank_yield_distributed' and fo.cycle_id = '29300000-0000-0000-0000-000000000001' and le.account = 'member_bank_yield_payable'),
  120001.01::numeric, 'el reparto acredita member_bank_yield_payable'
);
select is(
  (select count(*) from public.ledger_entries le join public.financial_operations fo on fo.id = le.operation_id
   where fo.operation_type = 'bank_yield_distributed' and fo.cycle_id = '29300000-0000-0000-0000-000000000001' and le.account = 'savings_liability'),
  0::bigint, 'el reparto no toca el ahorro'
);
select is((public.preview_member_settlement('49300000-0000-0000-0000-000000000004', '2026-12-05', 0, 0, 0)->>'capital')::numeric, 100000::numeric, 'el capital de Daniela no incluye su fondo Pibank');
select ok((public.preview_member_settlement('49300000-0000-0000-0000-000000000004', '2026-12-05', 0, 0, 0)->>'bank_yield_fund')::numeric between 60000.50 and 60000.51, 'Daniela recibe su fondo Pibank aparte en la liquidacion');

-- FIN-04: el camino antiguo de asignar premios tambien valida la polla completa.
select public.create_polla_activity('29300000-0000-0000-0000-000000000001', 2026, 9, 'Polla septiembre FIN03');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla septiembre FIN03'), '49300000-0000-0000-0000-000000000002', 'fin04-p-b', 5000, '2026-09-03');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla septiembre FIN03'), '49300000-0000-0000-0000-000000000004', 'fin04-p-d', 10000, '2026-09-03');
select throws_ok(
  $$ select public.award_polla_prize((select id from public.polla_activities where name = 'Polla septiembre FIN03'), '49300000-0000-0000-0000-000000000002', 'fin04-award-b', 20000, '2026-09-20') $$,
  null, null, 'award_polla_prize directo tampoco premia un aporte parcial'
);
select public.award_polla_prize((select id from public.polla_activities where name = 'Polla septiembre FIN03'), '49300000-0000-0000-0000-000000000004', 'fin04-award-d', 20000, '2026-09-20');
select throws_ok(
  $$ select public.award_polla_prize((select id from public.polla_activities where name = 'Polla septiembre FIN03'), '49300000-0000-0000-0000-000000000004', 'fin04-award-d2', 20000, '2026-09-21') $$,
  null, null, 'una polla no tiene dos premios'
);

-- FIN-04: premio historico sin verificar fuera de la liquidacion y bloqueado.
reset role;
update public.polla_prizes set legacy_id = 'FIN04-HIST', legacy_payment_status = 'historical_payment_unverified' where idempotency_key = 'fin04-award-d';
set local role authenticated;
set local request.jwt.claim.sub = '09300000-0000-0000-0000-000000000001';
select is((public.preview_member_settlement('49300000-0000-0000-0000-000000000004', '2026-12-05', 0, 0, 0)->>'pending_net_prizes')::numeric, 0::numeric, 'premio sin verificar no entra en la liquidacion');
select is((public.preview_member_settlement('49300000-0000-0000-0000-000000000004', '2026-12-05', 0, 0, 0)->>'unverified_prizes_excluded')::int, 1, 'la liquidacion informa el premio excluido');
reset role;
select throws_ok(
  $$ update public.polla_prizes set status = 'settled' where idempotency_key = 'fin04-award-d' $$,
  null, null, 'ningun camino cambia el estado de un premio sin verificar'
);

-- FIN-04: modalidades coherentes y sin cambios despues del primer abono.
update public.cycle_members set participates_in_loan_profit = true where id = '49300000-0000-0000-0000-000000000003';
select is((select participates_in_loan_profit from public.cycle_members where id = '49300000-0000-0000-0000-000000000003'), false, 'un ahorrador de 12 % EA no queda en utilidad de prestamos');
select throws_ok(
  $$ update public.cycle_members set economic_mode = 'fixed_yield' where id = '49300000-0000-0000-0000-000000000004' $$,
  null, null, 'la modalidad no cambia despues del primer abono Pibank'
);

select * from finish();
rollback;
