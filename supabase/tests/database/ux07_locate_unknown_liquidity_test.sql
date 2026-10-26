begin;

create extension if not exists pgtap;
select plan(6);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values ('07000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'ux07-admin@example.test', '', now(), now(), now());

insert into public.workspaces (id, name) values ('17000000-0000-0000-0000-000000000001', 'Workspace UX07');
insert into public.workspace_users (workspace_id, user_id, role)
values ('17000000-0000-0000-0000-000000000001', '07000000-0000-0000-0000-000000000001', 'admin');
insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status)
values ('27000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 2026, 'Ciclo UX07', '2026-01-01', '2026-12-15', 'active');
insert into public.members (id, workspace_id, display_name)
values ('37000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', 'Socio UX07');
insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota)
values ('47000000-0000-0000-0000-000000000001', '17000000-0000-0000-0000-000000000001', '27000000-0000-0000-0000-000000000001', '37000000-0000-0000-0000-000000000001', 100000);

set local role authenticated;
set local request.jwt.claim.sub = '07000000-0000-0000-0000-000000000001';

select public.register_savings_contribution('47000000-0000-0000-0000-000000000001', 'ux07-save-001', 300000, '2026-09-05', 2026, 9, 'bank_transfer', 'manual');
select public.create_bank_account('27000000-0000-0000-0000-000000000001', 'Pibank UX07', 'Pibank', '****0007');

select is(
  (select coalesce(sum(amount), 0) from public.ledger_entries where cycle_id = '27000000-0000-0000-0000-000000000001' and account = 'cash' and liquidity_location = 'unknown'),
  300000::numeric,
  'el aporte deja dinero sin ubicar'
);

select throws_ok(
  $$ select public.locate_unknown_liquidity('27000000-0000-0000-0000-000000000001', 'ux07-locate-too-much', '2026-10-01', 'bank', (select id from public.bank_accounts where display_name = 'Pibank UX07'), 400000, 'exceso') $$,
  null,
  null,
  'no se puede ubicar mas de lo que hay sin ubicar'
);

select throws_ok(
  $$ select public.locate_unknown_liquidity('27000000-0000-0000-0000-000000000001', 'ux07-locate-bad', '2026-10-01', 'bank', null, 1000, 'sin cuenta') $$,
  null,
  null,
  'ubicar en banco exige cuenta'
);

select lives_ok(
  $$ select public.locate_unknown_liquidity('27000000-0000-0000-0000-000000000001', 'ux07-locate-001', '2026-10-01', 'bank', (select id from public.bank_accounts where display_name = 'Pibank UX07'), 250000, 'saldo del excel') $$,
  'ubica parte del dinero en el banco'
);

select is(
  public.cash_available_at('27000000-0000-0000-0000-000000000001', '2026-10-01', 'bank', (select id from public.bank_accounts where display_name = 'Pibank UX07')),
  250000::numeric,
  'el banco recibe lo ubicado'
);

select is(
  (select coalesce(sum(amount), 0) from public.ledger_entries where cycle_id = '27000000-0000-0000-0000-000000000001' and account = 'cash'),
  300000::numeric,
  'ubicar no cambia la caja total'
);

select * from finish();
rollback;
