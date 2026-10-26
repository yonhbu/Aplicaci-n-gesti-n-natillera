begin;

create extension if not exists pgtap;
select plan(10);

-- FIN-07: el administrador cubre el faltante del 12 % EA; orden de cierre; confirmacion unica.
insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('09700000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'fin07-admin@example.test', '', now(), now(), now());
insert into public.workspaces (id, name) values ('19700000-0000-0000-0000-000000000001', 'Workspace FIN07');
insert into public.workspace_users (workspace_id, user_id, role) values ('19700000-0000-0000-0000-000000000001', '09700000-0000-0000-0000-000000000001', 'admin');
insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status, settlement_rules_version)
values ('29700000-0000-0000-0000-000000000001', '19700000-0000-0000-0000-000000000001', 2026, 'Ciclo FIN07', '2026-01-01', '2026-12-05', 'active', 'fin03-2026');
insert into public.members (id, workspace_id, display_name)
values
  ('39700000-0000-0000-0000-000000000001', '19700000-0000-0000-0000-000000000001', 'Ana Sintetica'),
  ('39700000-0000-0000-0000-000000000002', '19700000-0000-0000-0000-000000000001', 'Beto Sintetico'),
  ('39700000-0000-0000-0000-000000000003', '19700000-0000-0000-0000-000000000001', 'Carla Sintetica');
insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota, participates_in_polla, participates_in_loan_profit)
values
  ('49700000-0000-0000-0000-000000000001', '19700000-0000-0000-0000-000000000001', '29700000-0000-0000-0000-000000000001', '39700000-0000-0000-0000-000000000001', 100000, true, true),
  ('49700000-0000-0000-0000-000000000002', '19700000-0000-0000-0000-000000000001', '29700000-0000-0000-0000-000000000001', '39700000-0000-0000-0000-000000000002', 100000, true, true),
  ('49700000-0000-0000-0000-000000000003', '19700000-0000-0000-0000-000000000001', '29700000-0000-0000-0000-000000000001', '39700000-0000-0000-0000-000000000003', 500000, false, false);

set local role authenticated;
set local request.jwt.claim.sub = '09700000-0000-0000-0000-000000000001';

select public.register_savings_contribution('49700000-0000-0000-0000-000000000001', 'fin07-s1', 100000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.register_savings_contribution('49700000-0000-0000-0000-000000000002', 'fin07-s2', 100000, '2026-02-05', 2026, 2, 'bank_transfer', 'manual');
select public.register_savings_contribution('49700000-0000-0000-0000-000000000003', 'fin07-s3', 500000, '2026-11-01', 2026, 11, 'bank_transfer', 'manual');

-- Fondo del administrador: $5.000 de comision de polla + 10 % de intereses.
select public.create_polla_activity('29700000-0000-0000-0000-000000000001', 2026, 11, 'Polla noviembre FIN07');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla noviembre FIN07'), '49700000-0000-0000-0000-000000000001', 'fin07-p1', 10000, '2026-11-02');
select public.register_polla_contribution((select id from public.polla_activities where name = 'Polla noviembre FIN07'), '49700000-0000-0000-0000-000000000002', 'fin07-p2', 10000, '2026-11-02');
select public.award_polla_prize_to_capital((select id from public.polla_activities where name = 'Polla noviembre FIN07'), '49700000-0000-0000-0000-000000000001', 'fin07-award', 20000, '2026-11-03');

do $$
declare
  loan_id uuid;
begin
  select id into loan_id from public.create_loan_contract('29700000-0000-0000-0000-000000000001', 'fin07-loan', null, 'Deudor FIN07', null, 10000, 'fixed_interest', 'MONTHLY_FIXED', 0.10, 12, '2026-11-01');
  perform public.confirm_loan_disbursement(loan_id, 'fin07-disb', '2026-11-01');
  perform public.record_loan_payment(loan_id, 'fin07-pay', '2026-11-15', 1000, 0, 1000, 'regular');
end $$;

create temporary table fin07_preview as select public.preview_loan_profit_periods('29700000-0000-0000-0000-000000000001', '2026-12-05') as p;
select ok((select (p->>'shortfall')::numeric from fin07_preview) > 0, 'el 12 % EA de Carla supera el fondo de socios');
select is((select (p->>'admin_cover')::numeric from fin07_preview), (select (p->>'shortfall')::numeric from fin07_preview), 'el administrador cubre todo el faltante con su fondo');
select is((select (p->>'remaining_shortfall')::numeric from fin07_preview), 0::numeric, 'no queda faltante');
select is((select (p->>'confirmation_allowed')::boolean from fin07_preview), true, 'el reparto se puede confirmar');

set local natillera.civil_today = '2026-12-05';
create temporary table fin07_carla as select public.preview_member_settlement('49700000-0000-0000-0000-000000000003', '2026-12-05', 0, 0, 0) as p;
select throws_ok(
  $$ select public.confirm_member_settlement(p_cycle_member_id => '49700000-0000-0000-0000-000000000003', p_idempotency_key => 'fin07-settle-early', p_cut_date => '2026-12-05', p_annual_admin_fee => 0, p_penalty_amount => 0, p_other_discounts => 0, p_preview_hash => (select p->>'preview_hash' from fin07_carla)) $$,
  null, null, 'la liquidacion final no se confirma antes del reparto obligatorio'
);
select lives_ok(
  $$ select public.confirm_loan_profit_periods('29700000-0000-0000-0000-000000000001', '2026-12-05', 'fin07-confirm', (select p->>'preview_hash' from fin07_preview)) $$,
  'confirma el reparto con cobertura del administrador'
);
select is(
  (select sum(le.amount) from public.ledger_entries le join public.financial_operations fo on fo.id = le.operation_id
   where fo.operation_type = 'loan_profit_period_confirmed' and fo.cycle_id = '29700000-0000-0000-0000-000000000001' and le.account = 'admin_payable'),
  (select (p->>'admin_cover')::numeric from fin07_preview), 'la cobertura sale del fondo del administrador'
);
select lives_ok(
  $$ select public.confirm_loan_profit_periods('29700000-0000-0000-0000-000000000001', '2026-12-05', 'fin07-confirm', (select p->>'preview_hash' from fin07_preview)) $$,
  'reintento con la misma clave no falla'
);
select is((select count(*) from public.loan_profit_period_distributions where cycle_id = '29700000-0000-0000-0000-000000000001'), 1::bigint, 'no se duplica el reparto');
select throws_ok(
  $$ select public.confirm_loan_profit_periods('29700000-0000-0000-0000-000000000001', '2026-12-05', 'fin07-confirm-2', (select p->>'preview_hash' from fin07_preview)) $$,
  null, null, 'un segundo reparto con otra clave se rechaza'
);

select * from finish();
rollback;
