begin;

create extension if not exists pgtap;
select plan(30);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('02000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'b2-admin@example.test', '', now(), now(), now()),
  ('02000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'b2-outsider@example.test', '', now(), now(), now());

insert into public.workspaces (id, name)
values
  ('12000000-0000-0000-0000-000000000001', 'Workspace B2 Test'),
  ('12000000-0000-0000-0000-000000000002', 'Workspace B2 Other');

insert into public.workspace_users (workspace_id, user_id, role)
values ('12000000-0000-0000-0000-000000000001', '02000000-0000-0000-0000-000000000001', 'admin');

insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status)
values
  ('22000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 2026, 'Ciclo B2', '2026-01-01', '2026-12-15', 'active'),
  ('22000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000001', 2027, 'Ciclo B2 Futuro', '2027-01-01', '2027-12-15', 'active'),
  ('22000000-0000-0000-0000-000000000003', '12000000-0000-0000-0000-000000000001', 2028, 'Ciclo Cerrado', '2028-01-01', '2028-12-15', 'closed');

insert into public.members (id, workspace_id, display_name)
values
  ('32000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', 'Socio B2'),
  ('32000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000001', 'Socio B2 Dos'),
  ('32000000-0000-0000-0000-000000000003', '12000000-0000-0000-0000-000000000001', 'Socio B2 Futuro');

insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_loan_profit)
values
  ('42000000-0000-0000-0000-000000000001', '12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000001', 100000, true),
  ('42000000-0000-0000-0000-000000000002', '12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', '32000000-0000-0000-0000-000000000002', 100000, true),
  ('42000000-0000-0000-0000-000000000003', '12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000002', '32000000-0000-0000-0000-000000000003', 100000, true);

set local role authenticated;
set local request.jwt.claim.sub = '02000000-0000-0000-0000-000000000001';

select lives_ok(
  $$ select public.register_savings_contribution('42000000-0000-0000-0000-000000000001', 'save-ledger-001', 1000000, '2026-09-23', 2026, 10, 'bank_transfer', 'manual') $$,
  'aporte nuevo se registra con ledger'
);

select is(
  (select coalesce(sum(amount), 0)::numeric from public.ledger_entries where account = 'cash' and operation_id in (select id from public.financial_operations where idempotency_key = 'savings-link-' || (select id::text from public.savings_contributions where idempotency_key = 'save-ledger-001'))),
  1000000::numeric,
  'aporte nuevo aumenta caja una vez'
);

select is(
  (select count(*) from public.financial_operations where idempotency_key = 'savings-link-' || (select id::text from public.savings_contributions where idempotency_key = 'save-ledger-001')),
  1::bigint,
  'enlace de ahorro existe exactamente una vez'
);

select lives_ok(
  $$ select public.register_savings_contribution('42000000-0000-0000-0000-000000000001', 'save-ledger-001', 1000000, '2026-09-23', 2026, 10, 'bank_transfer', 'manual') $$,
  'reintento aporte conserva idempotencia'
);

select is(
  (select count(*) from public.financial_operations where idempotency_key = 'savings-link-' || (select id::text from public.savings_contributions where idempotency_key = 'save-ledger-001')),
  1::bigint,
  'reintento no duplica caja de ahorro'
);

select lives_ok(
  $$ select public.create_loan_contract('22000000-0000-0000-0000-000000000001', 'loan-amortized-001', '32000000-0000-0000-0000-000000000001', null, null, 500000, 'amortized', 'MONTHLY_FIXED', 0.05, 3, '2026-09-06') $$,
  'crea contrato amortizado'
);

select results_eq(
  $$ select interest_due::numeric from public.loan_schedules where loan_id = (select id from public.loan_contracts where idempotency_key = 'loan-amortized-001') order by installment_number $$,
  $$ values (25000::numeric), (17069.79::numeric), (8743.06::numeric) $$,
  'cronograma amortizado calcula interes sobre saldo'
);

select results_eq(
  $$ select principal_due::numeric from public.loan_schedules where loan_id = (select id from public.loan_contracts where idempotency_key = 'loan-amortized-001') order by installment_number $$,
  $$ values (158604.28::numeric), (166534.49::numeric), (174861.23::numeric) $$,
  'cronograma amortizado ajusta capital final'
);

select lives_ok(
  $$ select public.create_loan_contract('22000000-0000-0000-0000-000000000001', 'loan-ea-001', '32000000-0000-0000-0000-000000000001', null, null, 500000, 'interest_only', 'EA', 0.24, 1, '2026-09-06') $$,
  'crea contrato EA'
);

select is(
  (select interest_due from public.loan_schedules where loan_id = (select id from public.loan_contracts where idempotency_key = 'loan-ea-001') and installment_number = 1),
  8918.81::numeric,
  'cronograma persistido usa EA ACT/365F'
);

select throws_ok(
  $$ select public.record_loan_payment((select id from public.loan_contracts where idempotency_key = 'loan-amortized-001'), 'draft-pay-001', '2026-10-06', 1000, 1000, 0, 'regular') $$,
  null,
  null,
  'no se cobra prestamo en borrador'
);

select lives_ok(
  $$ select public.confirm_loan_disbursement((select id from public.loan_contracts where idempotency_key = 'loan-amortized-001'), 'loan-amortized-disburse-001', '2026-09-06') $$,
  'desembolsa prestamo amortizado'
);

select throws_ok(
  $$ select public.record_loan_payment((select id from public.loan_contracts where idempotency_key = 'loan-amortized-001'), 'overpay-001', '2026-10-06', 600000, 600000, 0, 'regular') $$,
  null,
  null,
  'rechaza capital mayor al saldo'
);

select lives_ok(
  $$ select public.record_loan_payment((select id from public.loan_contracts where idempotency_key = 'loan-amortized-001'), 'regular-capital-001', '2026-10-06', 25000, 10000, 15000, 'regular') $$,
  'pago regular puede incluir capital'
);

select is(
  (select kind from public.loan_payments where idempotency_key = 'regular-capital-001'),
  'regular',
  'capital positivo no convierte automaticamente a prepago'
);

select throws_ok(
  $$ select public.record_loan_payment((select id from public.loan_contracts where idempotency_key = 'loan-amortized-001'), 'regular-capital-001', '2026-10-06', 25001, 10000, 15001, 'regular') $$,
  null,
  null,
  'misma clave de cobro con otro contenido se rechaza'
);

select throws_ok(
  $$ select public.create_loan_contract('22000000-0000-0000-0000-000000000003', 'closed-cycle-loan', '32000000-0000-0000-0000-000000000001', null, null, 500000, 'fixed_interest', 'MONTHLY_FIXED', 0.05, 1, '2028-09-06') $$,
  null,
  null,
  'no crea prestamos en ciclo cerrado'
);

select lives_ok(
  $$ select public.create_loan_contract('22000000-0000-0000-0000-000000000001', 'prepago-sin-previo', '32000000-0000-0000-0000-000000000001', null, null, 500000, 'fixed_interest', 'MONTHLY_FIXED', 0.05, 1, '2026-09-06') $$,
  'crea fixture prepago sin cobro previo'
);
select lives_ok(
  $$ select public.confirm_loan_disbursement((select id from public.loan_contracts where idempotency_key = 'prepago-sin-previo'), 'prepago-sin-previo-disb', '2026-09-06') $$,
  'desembolsa fixture prepago sin cobro previo'
);
select is(
  ((select public.quote_loan_prepayment((select id from public.loan_contracts where idempotency_key = 'prepago-sin-previo'), '2026-10-06'))->>'total_due')::numeric,
  525000::numeric,
  'cotizacion prepago sin interes previo es 525000'
);

select lives_ok(
  $$ select public.create_loan_contract('22000000-0000-0000-0000-000000000001', 'prepago-con-previo', '32000000-0000-0000-0000-000000000001', null, null, 500000, 'fixed_interest', 'MONTHLY_FIXED', 0.05, 1, '2026-09-06') $$,
  'crea fixture prepago con cobro previo'
);
select lives_ok(
  $$ select public.confirm_loan_disbursement((select id from public.loan_contracts where idempotency_key = 'prepago-con-previo'), 'prepago-con-previo-disb', '2026-09-06') $$,
  'desembolsa fixture prepago con cobro previo'
);
select lives_ok(
  $$ select public.record_loan_payment((select id from public.loan_contracts where idempotency_key = 'prepago-con-previo'), 'prepago-interes-previo', '2026-10-01', 25000, 0, 25000, 'regular') $$,
  'registra cobro previo real para prepago'
);
select is(
  ((select public.quote_loan_prepayment((select id from public.loan_contracts where idempotency_key = 'prepago-con-previo'), '2026-10-06'))->>'total_due')::numeric,
  500000::numeric,
  'cotizacion prepago con interes previo es 500000'
);

select throws_ok(
  $$ insert into public.polla_activities (workspace_id, cycle_id, period_year, period_month, name)
     values ('12000000-0000-0000-0000-000000000001', '22000000-0000-0000-0000-000000000001', 2026, 10, 'Directa') $$,
  '42501',
  null,
  'actividad de polla no se inserta directo desde cliente'
);

select lives_ok(
  $$ select public.create_polla_activity('22000000-0000-0000-0000-000000000001', 2026, 10, 'Polla B2') $$,
  'crea actividad polla por RPC'
);

select throws_ok(
  $$ select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla B2'), '42000000-0000-0000-0000-000000000003', 'polla-cross-cycle', 10000, '2026-10-06') $$,
  null,
  null,
  'rechaza participante de otro ciclo'
);

select lives_ok(
  $$ select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla B2'), '42000000-0000-0000-0000-000000000001', 'polla-idem-001', 10000, '2026-10-06') $$,
  'registra aporte polla'
);

select throws_ok(
  $$ select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla B2'), '42000000-0000-0000-0000-000000000002', 'polla-idem-001', 10000, '2026-10-06') $$,
  null,
  null,
  'misma clave de polla con participante distinto se rechaza'
);

select is(
  (select count(*) from public.polla_participants where activity_id = (select id from public.polla_activities where name = 'Polla B2') and cycle_member_id = '42000000-0000-0000-0000-000000000002'),
  0::bigint,
  'reintento rechazado no inserta derecho nuevo'
);

select * from finish();
rollback;
