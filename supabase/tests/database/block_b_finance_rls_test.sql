begin;

create extension if not exists pgtap;
select plan(17);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('01000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'b-admin@example.test', '', now(), now(), now()),
  ('01000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b-outsider@example.test', '', now(), now(), now());

insert into public.workspaces (id, name)
values ('11000000-0000-0000-0000-000000000001', 'Workspace B Test');

insert into public.workspace_users (workspace_id, user_id, role)
values ('11000000-0000-0000-0000-000000000001', '01000000-0000-0000-0000-000000000001', 'admin');

insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on)
values ('21000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 2026, 'Ciclo B', '2026-01-01', '2026-12-15');

insert into public.members (id, workspace_id, display_name)
values
  ('31000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', 'Socio B'),
  ('31000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', 'Socio Excluido');

insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_loan_profit)
values
  ('41000000-0000-0000-0000-000000000001', '11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000001', 100000, true),
  ('41000000-0000-0000-0000-000000000002', '11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', '31000000-0000-0000-0000-000000000002', 100000, false);

set local role authenticated;
set local request.jwt.claim.sub = '01000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ insert into public.financial_operations (workspace_id, cycle_id, idempotency_key, operation_type, effective_date, actor_user_id)
     values ('11000000-0000-0000-0000-000000000001', '21000000-0000-0000-0000-000000000001', 'direct-finance', 'manual_income', '2026-01-01', '01000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'no hay insert directo de operaciones financieras'
);

select lives_ok(
  $$ select public.create_loan_contract('21000000-0000-0000-0000-000000000001', 'loan-create-001', '31000000-0000-0000-0000-000000000001', null, null, 500000, 'fixed_interest', 'MONTHLY_FIXED', 0.05, 1, '2026-09-06') $$,
  'crea contrato fijo'
);

select lives_ok(
  $$ select public.confirm_loan_disbursement((select id from public.loan_contracts where idempotency_key = 'loan-create-001'), 'loan-disburse-001', '2026-09-06') $$,
  'confirma desembolso'
);

select is(
  (select coalesce(sum(amount), 0)::numeric from public.ledger_entries where operation_id = (select disbursed_operation_id from public.loan_contracts where idempotency_key = 'loan-create-001')),
  0::numeric,
  'desembolso balanceado'
);

select lives_ok(
  $$ select public.record_loan_payment((select id from public.loan_contracts where idempotency_key = 'loan-create-001'), 'loan-pay-interest-001', '2026-10-06', 25000, 0, 25000, 'regular') $$,
  'registra cobro de interes'
);

select is(
  (select amount from public.ledger_entries where account = 'admin_payable' and operation_id = (select operation_id from public.loan_payments where idempotency_key = 'loan-pay-interest-001')),
  -2500::numeric,
  'interes genera administracion 10%'
);

select is(
  (select amount from public.ledger_entries where account = 'member_loan_profit_fund' and operation_id = (select operation_id from public.loan_payments where idempotency_key = 'loan-pay-interest-001')),
  -22500::numeric,
  'interes genera fondo socios 90%'
);

select lives_ok(
  $$ select public.record_loan_payment((select id from public.loan_contracts where idempotency_key = 'loan-create-001'), 'loan-pay-interest-001', '2026-10-06', 25000, 0, 25000, 'regular') $$,
  'reintento cobro no duplica'
);

select is((select count(*) from public.loan_payments where idempotency_key = 'loan-pay-interest-001'), 1::bigint, 'un solo cobro por clave');

select lives_ok(
  $$ select public.record_loan_payment((select id from public.loan_contracts where idempotency_key = 'loan-create-001'), 'loan-prepay-001', '2026-10-06', 500000, 500000, 0, 'prepayment') $$,
  'prepago extingue principal sin interes adicional'
);

select is((select status from public.loan_contracts where idempotency_key = 'loan-create-001'), 'paid', 'prestamo queda pagado');

select public.create_polla_activity('21000000-0000-0000-0000-000000000001', 2026, 10, 'Polla B');

select lives_ok(
  $$ select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla B'), '41000000-0000-0000-0000-000000000001', 'polla-contrib-001', 10000, '2026-10-06') $$,
  'aporte polla entra a bolsa separada'
);

select lives_ok(
  $$ select public.award_polla_prize((select id from public.polla_activities where name = 'Polla B'), '41000000-0000-0000-0000-000000000001', 'polla-prize-001', 40000, '2026-10-06') $$,
  'asigna premio con comision fija'
);

select is((select net_amount from public.polla_prizes where idempotency_key = 'polla-prize-001'), 35000::numeric, 'premio 40000 deja neto 35000');
select is((select admin_commission from public.polla_prizes where idempotency_key = 'polla-prize-001'), 5000::numeric, 'comision fija 5000');

select lives_ok(
  $$ select public.credit_polla_prize_to_capital((select id from public.polla_prizes where idempotency_key = 'polla-prize-001'), 'polla-credit-001', '2026-10-06') $$,
  'FIN-02: el premio se acredita al capital del ganador'
);

set local request.jwt.claim.sub = '01000000-0000-0000-0000-000000000002';
select is((select count(*) from public.loan_contracts), 0::bigint, 'usuario sin membresia no lee prestamos');

select * from finish();
rollback;
