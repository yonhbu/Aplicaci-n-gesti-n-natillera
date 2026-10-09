begin;

create extension if not exists pgtap;
select plan(40);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('03000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'c-admin@example.test', '', now(), now(), now()),
  ('03000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'c-other@example.test', '', now(), now(), now());

insert into public.workspaces (id, name)
values
  ('13000000-0000-0000-0000-000000000001', 'Workspace C Test'),
  ('13000000-0000-0000-0000-000000000002', 'Workspace C Utility');

insert into public.workspace_users (workspace_id, user_id, role)
values
  ('13000000-0000-0000-0000-000000000001', '03000000-0000-0000-0000-000000000001', 'admin'),
  ('13000000-0000-0000-0000-000000000002', '03000000-0000-0000-0000-000000000001', 'admin');

insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status)
values
  ('23000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 2026, 'Ciclo C', '2026-01-01', '2026-12-15', 'active'),
  ('23000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000002', 2026, 'Ciclo C Utility', '2026-01-01', '2026-12-15', 'active');

insert into public.members (id, workspace_id, display_name, legacy_id)
values
  ('33000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', 'Annie ficticia C', 'C-ANNIE'),
  ('33000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001', 'Edna ficticia C', 'C-EDNA'),
  ('33000000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000001', 'P013 previo ficticio C', 'C-P013-PREV');

insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_polla, participates_in_loan_profit)
values
  ('43000000-0000-0000-0000-000000000001', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000001', 100000, true, true),
  ('43000000-0000-0000-0000-000000000002', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000002', 100000, true, true),
  ('43000000-0000-0000-0000-000000000003', '13000000-0000-0000-0000-000000000001', '23000000-0000-0000-0000-000000000001', '33000000-0000-0000-0000-000000000003', 100000, false, true);

set local role anon;
select throws_ok(
  $$ select public.create_bank_account('23000000-0000-0000-0000-000000000001', 'Banco anon', null, null) $$,
  null,
  null,
  'anon no puede crear cuenta bancaria'
);

set local role authenticated;
set local request.jwt.claim.sub = '03000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.create_bank_account('23000000-0000-0000-0000-000000000001', 'Banco ficticio C', 'Banco TEST', '****1234') $$,
  'crea cuenta bancaria descriptiva sin credenciales'
);

select lives_ok(
  $$ select public.record_bank_opening('23000000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco ficticio C'), 'bank-open-c-001', '2026-10-01', 1000000, 'apertura ficticia verificada') $$,
  'registra apertura bancaria con contrapartida no utilitaria'
);

select lives_ok(
  $$ select public.record_bank_interest_received('23000000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco ficticio C'), 'bank-interest-c-001', '2026-10-02', 10000, 0, 0, 'extracto ficticio') $$,
  'interes bancario real aumenta banco y resultado una vez'
);

select lives_ok(
  $$ select public.record_bank_fee('23000000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco ficticio C'), 'bank-fee-c-001', '2026-10-03', 1000, 'comision ficticia') $$,
  'comision bancaria reduce banco'
);

select lives_ok(
  $$ select public.record_internal_liquidity_transfer('23000000-0000-0000-0000-000000000001', 'bank-transfer-c-001', '2026-10-04', 'bank', (select id from public.bank_accounts where display_name = 'Banco ficticio C'), 'cash', null, 100000, 'retiro caja ficticio') $$,
  'traslado interno cambia ubicacion sin cambiar liquidez total'
);

select is(public.cash_available_at('23000000-0000-0000-0000-000000000001', '2026-10-06', 'bank', (select id from public.bank_accounts where display_name = 'Banco ficticio C')), 909000::numeric, 'banco reconstruido queda en 909000');
select is(public.cash_available_at('23000000-0000-0000-0000-000000000001', '2026-10-06', 'cash', null), 100000::numeric, 'efectivo reconstruido queda en 100000');
select is(
  (select round(coalesce(sum(amount), 0), 2) from public.ledger_entries where cycle_id = '23000000-0000-0000-0000-000000000001' and account = 'cash'),
  1009000::numeric,
  'liquidez total no duplica banco y efectivo'
);

select lives_ok(
  $$ select public.create_bank_reconciliation('23000000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco ficticio C'), 1000000, '2026-10-01', 908500, '2026-10-06', 'saldo externo ficticio') $$,
  'conciliacion registra diferencia sin crear movimiento'
);

select is((select difference_amount from public.bank_reconciliations where reference = 'saldo externo ficticio'), -500::numeric, 'saldo externo 908500 reporta diferencia -500');
select is((select count(*) from public.financial_operations where operation_type = 'bank_interest_received'), 1::bigint, 'conciliar no duplica ingresos bancarios');

do $$
declare
  d date;
  i integer := 1;
begin
  foreach d in array array['2026-01-05'::date, '2026-02-05', '2026-03-01', '2026-04-01', '2026-05-05', '2026-06-05', '2026-07-03', '2026-08-04', '2026-09-05', '2026-09-23']
  loop
    perform public.register_savings_contribution('43000000-0000-0000-0000-000000000001', 'annie-save-c-' || i, 100000, d, 2026, case when i = 10 then 10 else i end, 'bank_transfer', 'manual');
    perform public.register_savings_contribution('43000000-0000-0000-0000-000000000002', 'edna-save-c-' || i, 100000, d, 2026, case when i = 10 then 10 else i end, 'bank_transfer', 'manual');
    i := i + 1;
  end loop;
end $$;

select is(((public.preview_member_settlement('43000000-0000-0000-0000-000000000001', '2026-10-06', 20000, 50000, 0))->>'capital')::numeric, 1000000::numeric, 'Annie capital elegible 1000000');
select is(((public.preview_member_settlement('43000000-0000-0000-0000-000000000001', '2026-10-06', 20000, 50000, 0))->>'recognized_yield')::numeric, 44894.88::numeric, 'Annie rendimiento a centavos 44894.88');
select is(((public.preview_member_settlement('43000000-0000-0000-0000-000000000001', '2026-10-06', 20000, 50000, 0))->>'net')::numeric, 974894.88::numeric, 'Annie neto a centavos esperado');
select is(((public.preview_member_settlement('43000000-0000-0000-0000-000000000001', '2026-10-06', 20000, 50000, 0))->>'transfer_amount')::numeric, 974895::numeric, 'Annie transferencia redondeada');

select lives_ok(
  $$ select public.confirm_member_settlement('43000000-0000-0000-0000-000000000001', 'settle-annie-c-001', '2026-10-06', 20000, 50000, 0, public.preview_member_settlement('43000000-0000-0000-0000-000000000001', '2026-10-06', 20000, 50000, 0)->>'preview_hash') $$,
  'confirma liquidacion Annie por RPC'
);
select is((select savings_status from public.cycle_members where id = '43000000-0000-0000-0000-000000000001'), 'withdrawn', 'retiro no elimina socio pero cambia participacion de ahorro');
select is(public.cash_available_at('23000000-0000-0000-0000-000000000001', '2026-10-06', 'bank', (select id from public.bank_accounts where display_name = 'Banco ficticio C')), 909000::numeric, 'confirmar liquidacion no baja caja');
select throws_ok(
  $$ select public.confirm_member_settlement('43000000-0000-0000-0000-000000000001', 'settle-annie-c-stale', '2026-10-06', 20000, 50000, 0, 'hash-obsoleto') $$,
  null,
  null,
  'confirmacion con preview obsoleta se rechaza'
);

do $$
declare
  activity_id uuid;
  loan_id uuid;
begin
  for i in 5..7 loop
    select id into activity_id from public.create_polla_activity('23000000-0000-0000-0000-000000000001', 2026, i, 'Polla Edna C ' || i);
    perform public.register_polla_contribution(activity_id, '43000000-0000-0000-0000-000000000002', 'edna-polla-contrib-c-' || i, 50000, make_date(2026, i, 5));
    perform public.award_polla_prize(activity_id, '43000000-0000-0000-0000-000000000002', 'edna-prize-c-' || i, 50000, make_date(2026, i, 6));
  end loop;

  select id into loan_id from public.create_loan_contract('23000000-0000-0000-0000-000000000001', 'edna-p005-c', '33000000-0000-0000-0000-000000000002', null, null, 549506, 'fixed_interest', 'MONTHLY_FIXED', 0, 1, '2026-09-06');
  perform public.confirm_loan_disbursement(loan_id, 'edna-p005-disb-c', '2026-09-06');

  select id into loan_id from public.create_loan_contract('23000000-0000-0000-0000-000000000001', 'edna-p013-c', '33000000-0000-0000-0000-000000000002', null, null, 500000, 'fixed_interest', 'MONTHLY_FIXED', 0.05, 1, '2026-09-06');
  perform public.set_loan_settlement_agreement(loan_id, 'P013_FIRST_MONTH');
  perform public.confirm_loan_disbursement(loan_id, 'edna-p013-disb-c', '2026-09-06');
end $$;

select is(((public.preview_member_settlement('43000000-0000-0000-0000-000000000002', '2026-10-06', 20000, 50000, 0))->>'pending_net_prizes')::numeric, 135000::numeric, 'Edna tiene tres premios netos pendientes por 135000');
select is(((public.preview_member_settlement('43000000-0000-0000-0000-000000000002', '2026-10-06', 20000, 50000, 0))->>'debts')::numeric, 1074506::numeric, 'Edna deudas compensables incluyen P005, P013 e interes acordado');
select is(((public.preview_member_settlement('43000000-0000-0000-0000-000000000002', '2026-10-06', 20000, 50000, 0))->>'net')::numeric, 35388.88::numeric, 'Edna neto a centavos esperado');

select lives_ok(
  $$ select public.confirm_member_settlement('43000000-0000-0000-0000-000000000002', 'settle-edna-c-001', '2026-10-06', 20000, 50000, 0, public.preview_member_settlement('43000000-0000-0000-0000-000000000002', '2026-10-06', 20000, 50000, 0)->>'preview_hash') $$,
  'confirma liquidacion Edna con compensaciones'
);
select is((select count(*) from public.polla_prizes where winner_cycle_member_id = '43000000-0000-0000-0000-000000000002' and status = 'settled'), 3::bigint, 'premios usados en liquidacion no quedan pagables por polla');
select is((select round(sum(principal_amount + interest_amount), 2) from public.member_settlement_debt_applications where settlement_id = (select id from public.member_settlements where idempotency_key = 'settle-edna-c-001')), 1074506::numeric, 'compensacion de deudas queda trazable sin entrada de caja');
select throws_ok(
  $$ select public.pay_polla_prize((select id from public.polla_prizes where winner_cycle_member_id = '43000000-0000-0000-0000-000000000002' limit 1), 'pay-settled-prize-c', '2026-10-06') $$,
  null,
  null,
  'premio liquidado no se paga dos veces desde polla'
);

select lives_ok(
  $$ select public.record_bank_external_financing('23000000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco ficticio C'), 'bank-finance-settlements-c', '2026-10-07', 2000000, 'financiacion sintetica ficticia para pagos C') $$,
  'agrega financiacion sintetica suficiente para pagos de fixture'
);
select lives_ok(
  $$ select public.pay_member_settlement((select id from public.member_settlements where idempotency_key = 'settle-annie-c-001'), 'pay-annie-c-001', '2026-10-08', 'bank', (select id from public.bank_accounts where display_name = 'Banco ficticio C'), 'transferencia Annie ficticia') $$,
  'paga liquidacion Annie'
);
select lives_ok(
  $$ select public.pay_member_settlement((select id from public.member_settlements where idempotency_key = 'settle-edna-c-001'), 'pay-edna-c-001', '2026-10-08', 'bank', (select id from public.bank_accounts where display_name = 'Banco ficticio C'), 'transferencia Edna ficticia') $$,
  'paga liquidacion Edna'
);
select is((select sum(amount) from public.member_settlement_payments), 1010284::numeric, 'transferencias conjuntas suman 1010284');
select is((select round(sum(amount), 2) from public.ledger_entries where account = 'common_expense' and operation_id in (select operation_id from public.member_settlement_payments)), 0.24::numeric, 'redondeo de pagos queda explicito por 0.24');

do $$
declare
  loan_id uuid;
begin
  select id into loan_id from public.create_loan_contract('23000000-0000-0000-0000-000000000001', 'p013-prev-c', '33000000-0000-0000-0000-000000000003', null, null, 500000, 'fixed_interest', 'MONTHLY_FIXED', 0.05, 1, '2026-09-06');
  perform public.set_loan_settlement_agreement(loan_id, 'P013_FIRST_MONTH');
  perform public.confirm_loan_disbursement(loan_id, 'p013-prev-disb-c', '2026-09-06');
  perform public.record_loan_payment(loan_id, 'p013-prev-interest-c', '2026-10-01', 25000, 0, 25000, 'regular');
end $$;
select is(((public.preview_member_settlement('43000000-0000-0000-0000-000000000003', '2026-10-06', 0, 0, 0))->>'p013_first_month_interest')::numeric, 0::numeric, 'P013 con primer mes ya cobrado no vuelve a descontar interes');

reset role;
insert into public.members (workspace_id, display_name, legacy_id)
select '13000000-0000-0000-0000-000000000002', 'Elegible utilidad C ' || i, 'UTIL-C-' || i
from generate_series(1, 9) as i;
insert into public.members (workspace_id, display_name, legacy_id)
values ('13000000-0000-0000-0000-000000000002', 'Excluido utilidad C', 'UTIL-C-X');
insert into public.cycle_members (workspace_id, cycle_id, member_id, monthly_quota, participates_in_loan_profit)
select m.workspace_id, '23000000-0000-0000-0000-000000000002', m.id, 100000, m.legacy_id <> 'UTIL-C-X'
from public.members m
where m.workspace_id = '13000000-0000-0000-0000-000000000002';

set local role authenticated;
set local request.jwt.claim.sub = '03000000-0000-0000-0000-000000000001';

do $$
declare
  borrower uuid;
  loan_id uuid;
begin
  select member_id into borrower from public.cycle_members where cycle_id = '23000000-0000-0000-0000-000000000002' limit 1;
  select id into loan_id from public.create_loan_contract('23000000-0000-0000-0000-000000000002', 'utility-loan-c', borrower, null, null, 100000, 'fixed_interest', 'MONTHLY_FIXED', 1, 1, '2026-09-01');
  perform public.confirm_loan_disbursement(loan_id, 'utility-loan-disb-c', '2026-09-01');
  perform public.record_loan_payment(loan_id, 'utility-interest-c', '2026-10-01', 200000, 100000, 100000, 'regular');
  perform public.record_manual_cash_movement('23000000-0000-0000-0000-000000000002', 'utility-expense-c', '2026-10-02', 70000, 'expense', 'costo ficticio para liquidez 30000');
end $$;

select lives_ok(
  $$ select public.create_loan_profit_distribution_policy('23000000-0000-0000-0000-000000000002', 'TEST-C', 'politica ficticia aprobada para pruebas C') $$,
  'registra politica aprobada de reparto TEST-C'
);

select is(((public.preview_loan_profit_distribution('23000000-0000-0000-0000-000000000002', '2026-10-06', 'TEST-C', 10000, 20000, 15000))->>'distributable')::numeric, 45000::numeric, 'utilidad distribuible es 45000 sin segundo 10%');
select is(((public.preview_loan_profit_distribution('23000000-0000-0000-0000-000000000002', '2026-10-06', 'TEST-C', 10000, 20000, 15000))->>'per_member')::numeric, 5000::numeric, 'nueve elegibles reciben 5000 cada uno');
select is(((public.preview_loan_profit_distribution('23000000-0000-0000-0000-000000000002', '2026-10-06', 'TEST-C', 10000, 20000, 15000))->>'liquidity_deficit')::numeric, 15000::numeric, 'deficit de liquidez visible por 15000');
select lives_ok(
  $$ select public.confirm_loan_profit_distribution('23000000-0000-0000-0000-000000000002', 'utility-dist-c-001', '2026-10-06', 'TEST-C', 10000, 20000, 15000, public.preview_loan_profit_distribution('23000000-0000-0000-0000-000000000002', '2026-10-06', 'TEST-C', 10000, 20000, 15000)->>'preview_hash') $$,
  'confirma reparto de utilidad con snapshot'
);
select is((select count(*) from public.loan_profit_distributions where policy_version = 'TEST-C'), 1::bigint, 'reparto confirmado no se duplica');
select throws_ok(
  $$ select public.pay_loan_profit_distribution((select id from public.loan_profit_distributions where policy_version = 'TEST-C'), 'utility-pay-c-001', '2026-10-06', 'cash', null, 'pago utilidad ficticio') $$,
  null,
  null,
  'pago de reparto se rechaza por liquidez insuficiente'
);

select * from finish();
rollback;
