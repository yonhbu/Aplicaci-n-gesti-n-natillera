begin;

create extension if not exists pgtap;
select plan(24);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('00000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'admin@example.test', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'outsider@example.test', '', now(), now(), now()),
  ('00000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'other@example.test', '', now(), now(), now());

insert into public.workspaces (id, name)
values
  ('10000000-0000-0000-0000-000000000001', 'Workspace A'),
  ('10000000-0000-0000-0000-000000000002', 'Workspace B');

insert into public.workspace_users (workspace_id, user_id, role)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin'),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000003', 'admin');

insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 2026, 'Ciclo A', '2026-01-01', '2026-12-15'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 2026, 'Ciclo B', '2026-01-01', '2026-12-15');

insert into public.members (id, workspace_id, display_name)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Persona A'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Persona B');

insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota)
values
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 100000),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 100000);

truncate table public.audit_events;

set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select is((select count(*) from public.workspaces), 1::bigint, 'admin ve solo su workspace');
select is((select count(*) from public.members), 1::bigint, 'admin ve solo sus socios');

select throws_ok(
  $$ insert into public.members (workspace_id, display_name) values ('10000000-0000-0000-0000-000000000001', 'Nueva Persona') $$,
  '42501',
  null,
  'no hay insert directo de socios'
);

select throws_ok(
  $$ insert into public.cycle_members (workspace_id, cycle_id, member_id, monthly_quota) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 100000) $$,
  '42501',
  null,
  'no hay insert directo de participaciones'
);

select lives_ok(
  $$ select public.save_cycle_member('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', null, null, 'Nueva Persona', null, 100000, 1, 12, false, true) $$,
  'RPC crea socio y participacion de forma transaccional'
);

select lives_ok(
  $$ select public.register_savings_contribution('40000000-0000-0000-0000-000000000001', 'idem-0001', 100000, '2026-09-23', 2026, 10, 'bank_transfer', 'manual') $$,
  'RPC registra aporte autorizado'
);

select is((select count(*) from public.savings_contributions), 1::bigint, 'aporte registrado una vez');
select is((select count(*) from public.audit_events where event_type = 'savings_contribution.created'), 1::bigint, 'auditoria del aporte creada en la misma operacion');

select lives_ok(
  $$ select public.register_savings_contribution('40000000-0000-0000-0000-000000000001', 'idem-0001', 100000, '2026-09-23', 2026, 10, 'bank_transfer', 'manual') $$,
  'RPC devuelve aporte existente con mismo contenido'
);

select is((select count(*) from public.savings_contributions), 1::bigint, 'reintento idempotente no duplica aporte');
select is((select count(*) from public.audit_events where event_type = 'savings_contribution.created'), 1::bigint, 'reintento idempotente no duplica auditoria');

select throws_ok(
  $$ select public.register_savings_contribution('40000000-0000-0000-0000-000000000001', 'idem-0001', 200000, '2026-09-23', 2026, 10, 'bank_transfer', 'manual') $$,
  null,
  'La clave de idempotencia ya existe con otro contenido.',
  'misma clave con distinto contenido se rechaza'
);

select throws_ok(
  $$ insert into public.savings_contributions (workspace_id, cycle_id, member_id, cycle_member_id, idempotency_key, amount, effective_date, applied_year, applied_month, method, actor_user_id)
     values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'direct-001', 100000, '2026-01-05', 2026, 1, 'cash', '00000000-0000-0000-0000-000000000001') $$,
  '42501',
  null,
  'no hay insert directo de aportes'
);

select throws_ok(
  $$ select public.register_savings_contribution('40000000-0000-0000-0000-000000000001', 'idem-year', 100000, '2026-09-23', 2027, 10, 'bank_transfer', 'manual') $$,
  null,
  'El ano aplicado no corresponde al ciclo.',
  'rechaza ano aplicado fuera del ciclo'
);

reset role;
select throws_ok(
  $$ update public.cycle_members set member_id = '30000000-0000-0000-0000-000000000002' where id = '40000000-0000-0000-0000-000000000001' $$,
  null,
  'No se puede cambiar la identidad de una participacion del ciclo.',
  'identidad de participacion protegida'
);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

reset role;
update public.cycle_members
set participation_start_month = 3
where id = '40000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000001';

select throws_ok(
  $$ select public.register_savings_contribution('40000000-0000-0000-0000-000000000002', 'idem-range', 100000, '2026-01-05', 2026, 1, 'bank_transfer', 'manual') $$,
  null,
  'No tiene permiso sobre este workspace.',
  'usuario A no escribe aporte en workspace B'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.register_savings_contribution('40000000-0000-0000-0000-000000000002', 'idem-range', 100000, '2026-01-05', 2026, 1, 'bank_transfer', 'manual') $$,
  null,
  'El mes aplicado esta fuera del rango de participacion del socio.',
  'rechaza mes fuera del rango de participacion'
);

reset role;
update public.cycles set status = 'closed' where id = '20000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.register_savings_contribution('40000000-0000-0000-0000-000000000002', 'idem-closed', 100000, '2026-03-05', 2026, 3, 'bank_transfer', 'manual') $$,
  null,
  'El ciclo no esta activo.',
  'rechaza ciclo cerrado'
);

reset role;
update public.cycles set status = 'active' where id = '20000000-0000-0000-0000-000000000002';
update public.cycle_members
set savings_status = 'withdrawn', participates_in_savings = false
where id = '40000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.register_savings_contribution('40000000-0000-0000-0000-000000000002', 'idem-withdrawn', 100000, '2026-03-05', 2026, 3, 'bank_transfer', 'manual') $$,
  null,
  'El socio no esta habilitado para aportes de ahorro en este ciclo.',
  'rechaza socio retirado o sin participacion en ahorro'
);

reset role;
update public.cycle_members
set savings_status = 'active', participates_in_savings = true
where id = '40000000-0000-0000-0000-000000000002';
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';

select throws_ok(
  $$ select public.register_savings_contribution('40000000-0000-0000-0000-000000000002', 'idem-scale', 100.001, '2026-03-05', 2026, 3, 'bank_transfer', 'manual') $$,
  null,
  'El aporte debe ser finito, positivo y con maximo dos decimales.',
  'rechaza escala excesiva antes de redondear'
);

select throws_ok(
  $$ select public.register_savings_contribution('40000000-0000-0000-0000-000000000002', 'idem-nan', 'NaN'::numeric, '2026-03-05', 2026, 3, 'bank_transfer', 'manual') $$,
  null,
  'El aporte debe ser finito, positivo y con maximo dos decimales.',
  'rechaza NaN'
);

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';
select is((select count(*) from public.workspaces), 0::bigint, 'usuario sin membresia no lee workspaces');

set local request.jwt.claim.sub = '00000000-0000-0000-0000-000000000003';
select is((select count(*) from public.workspaces), 1::bigint, 'usuario B solo lee su workspace');

set local role anon;
set local request.jwt.claim.sub = '';
select is((select count(*) from public.workspaces), 0::bigint, 'anonimo no lee workspaces');

select * from finish();
rollback;
