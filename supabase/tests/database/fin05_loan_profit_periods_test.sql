begin;

create extension if not exists pgtap;
select plan(22);

-- FIN-05: utilidad de prestamos por periodos, 12 % EA financiado con la utilidad, multa al administrador.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('09500000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fin05-admin@example.test', '', now(), now(), now());
insert into public.workspaces (id, name) values ('19500000-0000-0000-0000-000000000001', 'Workspace FIN05 '||txid_current());
insert into public.workspace_users (workspace_id, user_id, role) values ('19500000-0000-0000-0000-000000000001', '09500000-0000-0000-0000-000000000001', 'admin');
insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status, settlement_rules_version)
values ('29500000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', 2026, 'Ciclo FIN05', '2026-01-01', '2026-12-05', 'active', 'fin03-2026');
insert into public.members (id, workspace_id, display_name)
values
  ('39500000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', 'Annie Sintetica'),
  ('39500000-0000-0000-0000-000000000002', '19500000-0000-0000-0000-000000000001', 'Bruno Sintetico'),
  ('39500000-0000-0000-0000-000000000003', '19500000-0000-0000-0000-000000000001', 'Carlos Sintetico'),
  ('39500000-0000-0000-0000-000000000004', '19500000-0000-0000-0000-000000000001', 'Daniela Sintetica');
insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_polla, participates_in_loan_profit)
values
  ('49500000-0000-0000-0000-000000000001', '19500000-0000-0000-0000-000000000001', '29500000-0000-0000-0000-000000000001', '39500000-0000-0000-0000-000000000001', 100000, true, true),
  ('49500000-0000-0000-0000-000000000002', '19500000-0000-0000-0000-000000000001', '29500000-0000-0000-0000-000000000001', '39500000-0000-0000-0000-000000000002', 100000, true, true),
  ('49500000-0000-0000-0000-000000000003', '19500000-0000-0000-0000-000000000001', '29500000-0000-0000-0000-000000000001', '39500000-0000-0000-0000-000000000003', 1000000, false, false),
  ('49500000-0000-0000-0000-000000000004', '19500000-0000-0000-0000-000000000001', '29500000-0000-0000-0000-000000000001', '39500000-0000-0000-0000-000000000004', 100000, true, true);

set local role authenticated;
set local request.jwt.claim.sub = '09500000-0000-0000-0000-000000000001';

select public.register_savings_contribution('49500000-0000-0000-0000-000000000001', 'fin05-s1', 100000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.register_savings_contribution('49500000-0000-0000-0000-000000000002', 'fin05-s2', 100000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.register_savings_contribution('49500000-0000-0000-0000-000000000003', 'fin05-s3', 1000000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.register_savings_contribution('49500000-0000-0000-0000-000000000004', 'fin05-s4', 100000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');

do $$
declare
  loan_id uuid;
begin
  select id into loan_id from public.create_loan_contract('29500000-0000-0000-0000-000000000001', 'fin05-loan', null, 'Deudor FIN05', null, 1000000, 'fixed_interest', 'MONTHLY_FIXED', 0.10, 12, '2026-08-01');
  perform public.confirm_loan_disbursement(loan_id, 'fin05-disb', '2026-08-01');
  -- Septiembre: $100.000 de intereses -> $10.000 administrador, $90.000 fondo.
  perform public.record_loan_payment(loan_id, 'fin05-pay-sep', '2026-09-01', 100000, 0, 100000, 'regular');
end $$;

select is(
  (select -sum(le.amount) from public.ledger_entries le join public.financial_operations fo on fo.id = le.operation_id
   where fo.cycle_id = '29500000-0000-0000-0000-000000000001' and fo.operation_type = 'loan_payment' and le.account = 'admin_payable'),
  10000::numeric, 'el administrador recibe el 10 % de los intereses cobrados'
);

-- Annie se retira el 15 de septiembre: su utilidad queda congelada sobre lo cobrado hasta ese dia.
create temporary table fin05_annie as select public.preview_member_settlement('49500000-0000-0000-0000-000000000001', '2026-09-15', 0, 0, 0) as p;
select is((select (p->>'loan_profit_gross')::numeric from fin05_annie), 7762.38::numeric,
  'Annie: (90.000 - 12 % EA devengado al 1 sep) / 3');
select is((select (p->>'loan_profit_ea_charge')::numeric from fin05_annie), 1548.98::numeric,
  'FIN-06: Annie cubre su tercio del 12 % EA devengado del 1 al 15 sep');
select is((select (p->>'loan_profit_frozen')::numeric from fin05_annie), 6213.40::numeric, 'utilidad congelada de Annie');
select lives_ok(
  $$ select public.confirm_member_settlement(p_cycle_member_id => '49500000-0000-0000-0000-000000000001', p_idempotency_key => 'fin05-settle-annie', p_cut_date => '2026-09-15', p_annual_admin_fee => 0, p_penalty_amount => 0, p_other_discounts => 0, p_preview_hash => (select p->>'preview_hash' from fin05_annie)) $$,
  'confirma la liquidacion de Annie'
);
select is(
  (select -sum(le.amount) from public.ledger_entries le join public.financial_operations fo on fo.id = le.operation_id
   where fo.cycle_id = '29500000-0000-0000-0000-000000000001' and fo.operation_type = 'admin_penalty_recognized' and le.account = 'admin_payable'),
  50000::numeric, 'la multa de $50.000 es del administrador'
);

-- Octubre: otros $100.000 de intereses. Annie ya no participa.
do $$
begin
  perform public.record_loan_payment((select id from public.loan_contracts where external_borrower_name = 'Deudor FIN05'), 'fin05-pay-oct', '2026-10-15', 100000, 0, 100000, 'regular');
end $$;

create temporary table fin05_preview as select public.preview_loan_profit_periods('29500000-0000-0000-0000-000000000001', '2026-12-05') as p;
select is((select (p->>'fund_total')::numeric from fin05_preview), 180000::numeric, 'fondo de socios: 90 % de $200.000');
select ok((select (p->>'ea_obligation')::numeric from fin05_preview) between 98645 and 98647, '12 % EA de Carlos por 303 dias');
select is(
  (select round((p->>'collective_total')::numeric + (p->>'ea_obligation')::numeric, 2) from fin05_preview),
  180000::numeric, 'primero 12 % EA, el resto a los socios de polla, sin crear dinero'
);
select is((select (p->>'shortfall')::numeric from fin05_preview), 0::numeric, 'no hay faltante para el 12 % EA');
select is((select (p->>'ea_after_last_collection')::numeric from fin05_preview), 17260.00::numeric, 'FIN-06: el 12 % EA no se cobra dos veces (lo cubierto por Annie no se reserva otra vez)');
select is((select (p->>'collective_total')::numeric from fin05_preview), 81354.20::numeric, 'utilidad colectiva total');
select is(
  (select (b->>'amount')::numeric from fin05_preview, jsonb_array_elements(p->'beneficiaries') b where b->>'display_name' = 'Annie Sintetica'),
  (select (p->>'loan_profit_frozen')::numeric from fin05_annie),
  'Annie recibe exactamente su derecho congelado, sin intereses de octubre'
);
select is(
  (select count(*) from fin05_preview, jsonb_array_elements(p->'beneficiaries') b where b->>'display_name' = 'Carlos Sintetico'),
  0::bigint, 'Carlos (12 % EA) no participa de la utilidad colectiva'
);

set local natillera.civil_today = '2026-11-20';
select throws_ok(
  $$ select public.confirm_loan_profit_periods('29500000-0000-0000-0000-000000000001', '2026-12-05', 'fin05-early', (select p->>'preview_hash' from fin05_preview)) $$,
  null, null, 'no se confirma antes del cierre'
);
set local natillera.civil_today = '2026-12-05';
select lives_ok(
  $$ select public.confirm_loan_profit_periods('29500000-0000-0000-0000-000000000001', '2026-12-05', 'fin05-confirm', (select p->>'preview_hash' from fin05_preview)) $$,
  'confirma el reparto por periodos al cierre'
);
select throws_ok(
  $$ select public.pay_loan_profit_periods((select id from public.loan_profit_period_distributions where idempotency_key = 'fin05-confirm'), 'fin05-pay', '2026-12-05', 'cash', null, 'pago ficticio') $$,
  'P0001', null, 'rechaza el pago sin liquidez en efectivo'
);
select is((select count(*) from public.loan_profit_period_allocations where paid_operation_id is not null), 0::bigint,
  'el intento sin liquidez no deja pagos parciales');
-- El desembolso salio de efectivo y los ahorros tienen ubicacion pendiente.
-- Fondeo sintetico documentado: no altera la utilidad ni las asignaciones.
select public.create_bank_account('29500000-0000-0000-0000-000000000001', 'Banco FIN05', 'Banco TEST', null);
select public.record_bank_external_financing('29500000-0000-0000-0000-000000000001', (select id from public.bank_accounts where display_name = 'Banco FIN05'), 'fin05-funding', '2026-12-05', 1000000, 'financiacion sintetica para pagar utilidad');
select public.record_internal_liquidity_transfer('29500000-0000-0000-0000-000000000001', 'fin05-cash-funding', '2026-12-05', 'bank', (select id from public.bank_accounts where display_name = 'Banco FIN05'), 'cash', null, 1000000, 'traslado ficticio para pagos');
select lives_ok(
  $$ select public.pay_loan_profit_periods((select id from public.loan_profit_period_distributions where idempotency_key = 'fin05-confirm'), 'fin05-pay', '2026-12-05', 'cash', null, 'pago ficticio') $$,
  'paga la utilidad, incluida la de Annie'
);
select is(
  (select count(*) from public.financial_operations where cycle_id = '29500000-0000-0000-0000-000000000001' and operation_type = 'loan_profit_period_paid'),
  3::bigint, 'FIN-07: un pago trazable por cada beneficiario (Annie, Bruno, Daniela)'
);
select is((select status from public.loan_profit_period_distributions where idempotency_key = 'fin05-confirm'), 'paid', 'el reparto queda pagado cuando todos recibieron');

reset role;
select throws_ok(
  $$ insert into public.loan_profit_distributions (workspace_id, cycle_id, idempotency_key, cut_date, preview_hash, policy_version, snapshot, distributable_amount, payment_amount, created_by)
     values ('19500000-0000-0000-0000-000000000001', '29500000-0000-0000-0000-000000000001', 'fin05-old-path', '2026-12-05', 'x', 'old', '{}'::jsonb, 0, 0, '09500000-0000-0000-0000-000000000001') $$,
  null, null, 'el reparto antiguo sin periodos queda bloqueado'
);

select * from finish();
rollback;
