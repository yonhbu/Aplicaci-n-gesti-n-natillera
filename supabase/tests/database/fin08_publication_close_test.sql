begin;

create extension if not exists pgtap;
select plan(17);

-- FIN-08 / FIN-08.1: liquidez por ubicacion, correcciones coordinadas, trazabilidad y reloj de pruebas.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('09800000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fin08-admin@example.test', '', now(), now(), now());
insert into public.workspaces (id, name) values ('19800000-0000-0000-0000-000000000001', 'Workspace FIN08');
insert into public.workspace_users (workspace_id, user_id, role) values ('19800000-0000-0000-0000-000000000001', '09800000-0000-0000-0000-000000000001', 'admin');
insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status, settlement_rules_version)
values ('29800000-0000-0000-0000-000000000001', '19800000-0000-0000-0000-000000000001', 2026, 'Ciclo FIN08', '2026-01-01', '2026-12-05', 'active', 'fin03-2026');
insert into public.members (id, workspace_id, display_name)
values ('39800000-0000-0000-0000-000000000001', '19800000-0000-0000-0000-000000000001', 'Ana Sintetica'), ('39800000-0000-0000-0000-000000000002', '19800000-0000-0000-0000-000000000001', 'Beto Sintetico');
insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_polla, participates_in_loan_profit)
values
  ('49800000-0000-0000-0000-000000000001', '19800000-0000-0000-0000-000000000001', '29800000-0000-0000-0000-000000000001', '39800000-0000-0000-0000-000000000001', 100000, true, true),
  ('49800000-0000-0000-0000-000000000002', '19800000-0000-0000-0000-000000000001', '29800000-0000-0000-0000-000000000001', '39800000-0000-0000-0000-000000000002', 100000, true, true);

-- Reloj de pruebas solo en servidor.
insert into public.fin_test_clock (id, civil_today) values (1, '2026-12-05');
set local natillera.test_clock_enabled = 'on';

set local role authenticated;
set local request.jwt.claim.sub = '09800000-0000-0000-0000-000000000001';

select throws_ok($$ select * from public.fin_test_clock $$, null, null, 'el navegador no puede leer ni cambiar el reloj de pruebas');
select is(public.fin_civil_today(), '2026-12-05'::date, 'el servidor usa el reloj de pruebas en TEST');

select public.create_bank_account('29800000-0000-0000-0000-000000000001', 'Pibank FIN08', 'Pibank', '****0008');
select public.register_savings_contribution('49800000-0000-0000-0000-000000000001', 'fin08-s1', 500000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.register_savings_contribution('49800000-0000-0000-0000-000000000002', 'fin08-s2', 500000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.record_bank_interest_received('29800000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Pibank FIN08'), 'fin08-int', '2026-10-31', 20000, 0, 0, 'rendimiento ficticio');

do $$
declare
  loan_id uuid;
begin
  select id into loan_id from public.create_loan_contract('29800000-0000-0000-0000-000000000001', 'fin08-loan', null, 'Deudor FIN08', null, 500000, 'fixed_interest', 'MONTHLY_FIXED', 0.20, 12, '2026-09-01');
  perform public.confirm_loan_disbursement(loan_id, 'fin08-disb', '2026-09-01');
  perform public.record_loan_payment(loan_id, 'fin08-pay', '2026-10-01', 100000, 0, 100000, 'regular');
end $$;

-- Correccion coordinada de utilidad de prestamos.
create temporary table fin08_lp as select public.preview_loan_profit_periods('29800000-0000-0000-0000-000000000001', '2026-12-05') as p;
select lives_ok($$ select public.confirm_loan_profit_periods('29800000-0000-0000-0000-000000000001', '2026-12-05', 'fin08-lp-1', (select p->>'preview_hash' from fin08_lp)) $$, 'confirma el reparto de utilidad');
select lives_ok($$ select public.reverse_loan_profit_periods((select id from public.loan_profit_period_distributions where idempotency_key = 'fin08-lp-1'), 'fin08-lp-rev', 'interes mal registrado') $$, 'deshace un reparto no pagado');
select lives_ok($$ select public.reverse_loan_profit_periods((select id from public.loan_profit_period_distributions where idempotency_key = 'fin08-lp-1'), 'fin08-lp-rev-2', 'reintento') $$, 'reintentar el reverso no falla');
select is((select count(*) from public.financial_operations where cycle_id = '29800000-0000-0000-0000-000000000001' and operation_type = 'loan_profit_period_reversed'), 1::bigint, 'el reverso no duplica asientos');
select is(
  (select coalesce(sum(le.amount), 0) from public.ledger_entries le join public.financial_operations fo on fo.id = le.operation_id
   where fo.cycle_id = '29800000-0000-0000-0000-000000000001' and fo.operation_type in ('loan_profit_period_confirmed', 'loan_profit_period_reversed') and le.account = 'member_loan_profit_fund'),
  0::numeric, 'el fondo de socios vuelve a su saldo original'
);
create temporary table fin08_lp2 as select public.preview_loan_profit_periods('29800000-0000-0000-0000-000000000001', '2026-12-05') as p;
select is((select (p->>'unverified_fund_sources')::numeric from fin08_lp2), 0::numeric, 'el reverso trazado restaura el fondo sin crear ingreso sin verificar');
select lives_ok($$ select public.confirm_loan_profit_periods('29800000-0000-0000-0000-000000000001', '2026-12-05', 'fin08-lp-2', (select p->>'preview_hash' from fin08_lp2)) $$, 'despues de corregir se puede repartir otra vez');

-- Liquidez por cuenta.
select throws_ok(
  $$ select public.pay_loan_profit_allocation((select a.id from public.loan_profit_period_allocations a join public.loan_profit_period_distributions d on d.id = a.distribution_id where d.idempotency_key = 'fin08-lp-2' and a.cycle_member_id = '49800000-0000-0000-0000-000000000001'), 'fin08-pay-a-1', '2026-12-05', 'bank', (select id from public.bank_accounts where display_name = 'Pibank FIN08'), 'pago ficticio Ana') $$,
  'P0001', 'No hay dinero suficiente en esa cuenta para pagar 45000.00 a este socio.', 'no paga si la cuenta elegida no tiene saldo suficiente'
);
select public.record_bank_opening('29800000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Pibank FIN08'), 'fin08-open', '2026-12-01', 200000, 'apertura ficticia');
select lives_ok(
  $$ select public.pay_loan_profit_allocation((select a.id from public.loan_profit_period_allocations a join public.loan_profit_period_distributions d on d.id = a.distribution_id where d.idempotency_key = 'fin08-lp-2' and a.cycle_member_id = '49800000-0000-0000-0000-000000000001'), 'fin08-pay-a-2', '2026-12-05', 'bank', (select id from public.bank_accounts where display_name = 'Pibank FIN08'), 'pago ficticio Ana') $$,
  'paga cuando la cuenta tiene saldo'
);
select is((select count(*) from public.loan_profit_period_allocations a join public.loan_profit_period_distributions d on d.id = a.distribution_id where d.idempotency_key = 'fin08-lp-2' and a.paid_operation_id is null and a.amount > 0), 1::bigint, 'el otro socio sigue pendiente');
select throws_ok($$ select public.reverse_loan_profit_periods((select id from public.loan_profit_period_distributions where idempotency_key = 'fin08-lp-2'), 'fin08-lp-rev-3', 'tarde') $$, null, null, 'no se deshace un reparto con pagos');

-- Reverso Pibank conserva la trazabilidad.
create temporary table fin08_by as select public.preview_bank_yield_distribution('29800000-0000-0000-0000-000000000001', '2026-12-05') as p;
select public.confirm_bank_yield_distribution('29800000-0000-0000-0000-000000000001', '2026-12-05', 'fin08-by-1', (select p->>'preview_hash' from fin08_by));
select lives_ok($$ select public.reverse_bank_yield_distribution((select id from public.bank_yield_distributions where idempotency_key = 'fin08-by-1'), 'fin08-by-rev', 'abono mal registrado') $$, 'deshace el reparto Pibank no liquidado');
select is((select count(*) from public.member_capital_credits where source_type = 'bank_yield' and cycle_id = '29800000-0000-0000-0000-000000000001' and reversed_at is not null), 2::bigint, 'los abonos individuales se conservan marcados como revertidos');
select is((public.preview_member_settlement('49800000-0000-0000-0000-000000000001', '2026-12-05', 0, 0, 0)->>'bank_yield_fund')::numeric, 0::numeric, 'un abono revertido no cuenta en la liquidacion');

-- El tipo de operacion por si solo no demuestra un reverso valido.
reset role;
select public.create_b_operation(
  '19800000-0000-0000-0000-000000000001', '29800000-0000-0000-0000-000000000001',
  'fin08-unlinked-reversal', 'loan_profit_period_reversed', '2026-12-05',
  'loan_profit_period_distributions', (select id from public.loan_profit_period_distributions where idempotency_key = 'fin08-lp-1'),
  '{}'::jsonb, '[{"account":"member_loan_profit_fund","amount":-1},{"account":"utility_distribution_payable","amount":1}]'::jsonb
);
set local role authenticated;
select is((public.preview_loan_profit_periods('29800000-0000-0000-0000-000000000001', '2026-12-05')->>'unverified_fund_sources')::numeric, 1::numeric,
  'un credito de reverso sin enlace sigue marcado como no verificado');

select * from finish();
rollback;
