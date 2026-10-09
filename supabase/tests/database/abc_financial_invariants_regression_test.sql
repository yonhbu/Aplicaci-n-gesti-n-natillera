begin;

create extension if not exists pgtap;
select plan(27);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('04000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'abc-admin@example.test', '', now(), now(), now());

insert into public.workspaces (id, name)
values ('14000000-0000-0000-0000-000000000001', 'Workspace ABC Regression');

insert into public.workspace_users (workspace_id, user_id, role)
values ('14000000-0000-0000-0000-000000000001', '04000000-0000-0000-0000-000000000001', 'admin');

insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status)
values ('24000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 2026, 'Ciclo ABC Regression', '2026-01-01', '2026-12-15', 'active');

insert into public.members (id, workspace_id, display_name, legacy_id)
values
  ('34000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', 'Hash Null', 'ABC-HASH'),
  ('34000000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-000000000001', 'Corte Prestamo', 'ABC-CORTE'),
  ('34000000-0000-0000-0000-000000000003', '14000000-0000-0000-0000-000000000001', 'Idempotente Pago', 'ABC-IDEM'),
  ('34000000-0000-0000-0000-000000000004', '14000000-0000-0000-0000-000000000001', 'Elegible Uno', 'ABC-U1'),
  ('34000000-0000-0000-0000-000000000005', '14000000-0000-0000-0000-000000000001', 'Elegible Dos', 'ABC-U2'),
  ('34000000-0000-0000-0000-000000000006', '14000000-0000-0000-0000-000000000001', 'Elegible Tres', 'ABC-U3');

insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_polla, participates_in_loan_profit)
values
  ('44000000-0000-0000-0000-000000000001', '14000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000001', 100000, true, false),
  ('44000000-0000-0000-0000-000000000002', '14000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000002', 100000, true, false),
  ('44000000-0000-0000-0000-000000000003', '14000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000003', 100000, true, false),
  ('44000000-0000-0000-0000-000000000004', '14000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000004', 100000, true, true),
  ('44000000-0000-0000-0000-000000000005', '14000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000005', 100000, true, true),
  ('44000000-0000-0000-0000-000000000006', '14000000-0000-0000-0000-000000000001', '24000000-0000-0000-0000-000000000001', '34000000-0000-0000-0000-000000000006', 100000, true, true);

set local role authenticated;
set local request.jwt.claim.sub = '04000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.create_bank_account('24000000-0000-0000-0000-000000000001', 'Banco ABC', 'Banco TEST', '****9999') $$,
  'crea banco para regresiones ABC'
);

select lives_ok(
  $$ select public.record_bank_opening('24000000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco ABC'), 'abc-bank-open-001', '2026-10-01', 200, 'apertura unica fixture') $$,
  'registra apertura bancaria unica'
);

select throws_ok(
  $$ select public.record_bank_opening('24000000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco ABC'), 'abc-bank-open-002', '2026-10-02', 1, 'segunda apertura invalida') $$,
  null,
  null,
  'rechaza segunda apertura con otra clave'
);

select lives_ok(
  $$ select public.register_savings_contribution('44000000-0000-0000-0000-000000000001', 'abc-save-hash-001', 100, '2026-09-01', 2026, 9, 'cash', 'manual') $$,
  'fixture ahorro para hash nulo'
);

select throws_ok(
  $$ select public.confirm_member_settlement('44000000-0000-0000-0000-000000000001', 'abc-settle-null-hash', '2026-10-06', 0, 0, 0, null) $$,
  null,
  null,
  'rechaza confirmar liquidacion con hash null'
);

do $$
declare
  loan_id uuid;
begin
  select id into loan_id
  from public.create_loan_contract('24000000-0000-0000-0000-000000000001', 'abc-loan-cutoff', '34000000-0000-0000-0000-000000000002', null, null, 500, 'fixed_interest', 'MONTHLY_FIXED', 0, 1, '2026-10-01');
  perform public.confirm_loan_disbursement(loan_id, 'abc-loan-cutoff-disb', '2026-10-01');
  perform public.record_loan_payment(loan_id, 'abc-loan-cutoff-pay-late', '2026-10-10', 100, 100, 0, 'regular');
end $$;

select is(
  ((public.preview_member_settlement('44000000-0000-0000-0000-000000000002', '2026-10-06', 0, 0, 0))->>'principal_debt')::numeric,
  500::numeric,
  'deuda al corte no resta cobros posteriores'
);

select throws_ok(
  $$ select public.confirm_member_settlement('44000000-0000-0000-0000-000000000002', 'abc-settle-retro-conflict', '2026-10-06', 0, 0, 0, public.preview_member_settlement('44000000-0000-0000-0000-000000000002', '2026-10-06', 0, 0, 0)->>'preview_hash') $$,
  null,
  null,
  'confirmacion retroactiva con cobros posteriores se rechaza'
);

select lives_ok(
  $$ select public.register_savings_contribution('44000000-0000-0000-0000-000000000003', 'abc-save-idem-001', 100, '2026-09-01', 2026, 9, 'cash', 'manual') $$,
  'fixture ahorro idempotencia liquidacion'
);

select lives_ok(
  $$ select public.confirm_member_settlement('44000000-0000-0000-0000-000000000003', 'abc-settle-idem', '2026-10-06', 0, 0, 0, public.preview_member_settlement('44000000-0000-0000-0000-000000000003', '2026-10-06', 0, 0, 0)->>'preview_hash') $$,
  'confirma liquidacion idempotente'
);

select lives_ok(
  $$ select public.confirm_member_settlement('44000000-0000-0000-0000-000000000003', 'abc-settle-idem', '2026-10-06', 0, 0, 0, (select preview_hash from public.member_settlements where idempotency_key = 'abc-settle-idem')) $$,
  'reintento de confirmacion devuelve liquidacion aunque socio ya no este activo'
);

select lives_ok(
  $$ select public.pay_member_settlement((select id from public.member_settlements where idempotency_key = 'abc-settle-idem'), 'abc-pay-settle-idem', '2026-10-07', 'bank', (select id from public.bank_accounts where display_name = 'Banco ABC'), 'ref-original') $$,
  'paga liquidacion para prueba de idempotencia'
);

select throws_ok(
  $$ select public.pay_member_settlement((select id from public.member_settlements where idempotency_key = 'abc-settle-idem'), 'abc-pay-settle-idem', '2026-10-07', 'bank', (select id from public.bank_accounts where display_name = 'Banco ABC'), 'ref-cambiada') $$,
  null,
  null,
  'reintento de pago con referencia distinta se rechaza'
);

select lives_ok(
  $$ select public.reverse_financial_operation((select operation_id from public.member_settlement_payments where idempotency_key = 'abc-pay-settle-idem'), 'abc-rev-settle-pay', '2026-10-08', 'reversa pago liquidacion fixture') $$,
  'reversa pago de liquidacion'
);

select is((select status from public.member_settlements where idempotency_key = 'abc-settle-idem'), 'confirmed', 'reverso de pago reabre liquidacion');
select is((select status from public.member_settlement_payments where idempotency_key = 'abc-pay-settle-idem'), 'reversed', 'pago de liquidacion queda marcado reversado');

select throws_ok(
  $$ select public.reverse_financial_operation((select disbursed_operation_id from public.loan_contracts where idempotency_key = 'abc-loan-cutoff'), 'abc-rev-loan-with-payment', '2026-10-11', 'intento reverso con cobro') $$,
  null,
  null,
  'rechaza reverso de desembolso con cobros dependientes'
);

do $$
declare
  loan_id uuid;
begin
  select id into loan_id
  from public.create_loan_contract('24000000-0000-0000-0000-000000000001', 'abc-loan-fund-cents', '34000000-0000-0000-0000-000000000004', null, null, 1, 'fixed_interest', 'MONTHLY_FIXED', 0, 1, '2026-10-01');
  perform public.confirm_loan_disbursement(loan_id, 'abc-loan-fund-cents-disb', '2026-10-01');
  perform public.record_loan_payment(loan_id, 'abc-loan-fund-cents-pay', '2026-10-02', 0.02, 0, 0.02, 'regular');
end $$;

select lives_ok(
  $$ select public.create_loan_profit_distribution_policy('24000000-0000-0000-0000-000000000001', 'ABC-APPROVED', 'politica aprobada para regresion') $$,
  'crea politica aprobada para reparto'
);

select is(((public.preview_loan_profit_distribution('24000000-0000-0000-0000-000000000001', '2026-10-06', 'ABC-APPROVED', 0, 0, 0))->>'rounding_residual')::numeric, 0.02::numeric, 'centavos residuales no quedan negativos');
select is(((public.preview_loan_profit_distribution('24000000-0000-0000-0000-000000000001', '2026-10-06', 'ABC-APPROVED', 0, 0, 0))->>'per_member')::numeric, 0::numeric, 'fondo 0.02 entre tres no promete 0.03');

select throws_ok(
  $$ select public.confirm_loan_profit_distribution('24000000-0000-0000-0000-000000000001', 'abc-dist-any-policy', '2026-10-06', 'ANY-POLICY', 0, 0, 0, public.preview_loan_profit_distribution('24000000-0000-0000-0000-000000000001', '2026-10-06', 'ANY-POLICY', 0, 0, 0)->>'preview_hash') $$,
  null,
  null,
  'rechaza politica de reparto no aprobada'
);

select lives_ok(
  $$ select public.record_bank_external_financing('24000000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco ABC'), 'abc-bank-fund-more', '2026-10-03', 20, 'financiacion para pago utilidad') $$,
  'agrega liquidez para pagos de utilidad'
);

do $$
declare
  loan_id uuid;
begin
  select id into loan_id
  from public.create_loan_contract('24000000-0000-0000-0000-000000000001', 'abc-loan-fund-pay', '34000000-0000-0000-0000-000000000005', null, null, 1, 'fixed_interest', 'MONTHLY_FIXED', 0, 1, '2026-10-01');
  perform public.confirm_loan_disbursement(loan_id, 'abc-loan-fund-pay-disb', '2026-10-01');
  perform public.record_loan_payment(loan_id, 'abc-loan-fund-pay-pay', '2026-10-02', 2.98, 0, 2.98, 'regular');
end $$;

select lives_ok(
  $$ select public.confirm_loan_profit_distribution('24000000-0000-0000-0000-000000000001', 'abc-dist-approved', '2026-10-06', 'ABC-APPROVED', 0, 0, 0, public.preview_loan_profit_distribution('24000000-0000-0000-0000-000000000001', '2026-10-06', 'ABC-APPROVED', 0, 0, 0)->>'preview_hash') $$,
  'confirma reparto con politica aprobada'
);

select lives_ok(
  $$ select public.confirm_loan_profit_distribution('24000000-0000-0000-0000-000000000001', 'abc-dist-approved', '2026-10-06', 'ABC-APPROVED', 0, 0, 0, (select preview_hash from public.loan_profit_distributions where idempotency_key = 'abc-dist-approved')) $$,
  'reintento de confirmacion de reparto devuelve el mismo registro'
);

select lives_ok(
  $$ select public.pay_loan_profit_distribution((select id from public.loan_profit_distributions where idempotency_key = 'abc-dist-approved'), 'abc-pay-dist-approved', '2026-10-07', 'bank', (select id from public.bank_accounts where display_name = 'Banco ABC'), 'pago utilidad original') $$,
  'paga reparto aprobado'
);

select lives_ok(
  $$ select public.pay_loan_profit_distribution((select id from public.loan_profit_distributions where idempotency_key = 'abc-dist-approved'), 'abc-pay-dist-approved', '2026-10-07', 'bank', (select id from public.bank_accounts where display_name = 'Banco ABC'), 'pago utilidad original') $$,
  'reintento de pago de reparto devuelve el mismo pago'
);

select lives_ok(
  $$ select public.record_internal_liquidity_transfer('24000000-0000-0000-0000-000000000001', 'abc-transfer-all', '2026-10-08', 'bank', (select id from public.bank_accounts where display_name = 'Banco ABC'), 'cash', null, public.cash_available_at('24000000-0000-0000-0000-000000000001', '2026-10-08', 'bank', (select id from public.bank_accounts where display_name = 'Banco ABC')), 'traslado total') $$,
  'traslada todo el saldo bancario disponible'
);

select lives_ok(
  $$ select public.record_internal_liquidity_transfer('24000000-0000-0000-0000-000000000001', 'abc-transfer-all', '2026-10-08', 'bank', (select id from public.bank_accounts where display_name = 'Banco ABC'), 'cash', null, (select (payload->>'amount')::numeric from public.financial_operations where idempotency_key = 'abc-transfer-all'), 'traslado total') $$,
  'reintento del traslado total devuelve operacion previa sin error de saldo'
);

select * from finish();
rollback;
