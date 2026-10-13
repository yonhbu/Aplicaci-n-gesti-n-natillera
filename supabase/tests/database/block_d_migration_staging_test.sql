begin;

create extension if not exists pgtap;
select plan(14);

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
values
  ('05000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'migration-admin@example.test', '', now(), now(), now()),
  ('05000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'migration-outsider@example.test', '', now(), now(), now());

insert into public.workspaces (id, name)
values
  ('15000000-0000-0000-0000-000000000001', 'Workspace D Aislado'),
  ('15000000-0000-0000-0000-000000000002', 'Workspace D Ajeno');

insert into public.workspace_users (workspace_id, user_id, role)
values
  ('15000000-0000-0000-0000-000000000001', '05000000-0000-0000-0000-000000000001', 'admin'),
  ('15000000-0000-0000-0000-000000000002', '05000000-0000-0000-0000-000000000002', 'admin');

insert into public.cycles (id, workspace_id, year, name, starts_on, closes_on, status)
values
  ('25000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 2026, 'Migracion D', '2026-01-01', '2026-12-15', 'active'),
  ('25000000-0000-0000-0000-000000000002', '15000000-0000-0000-0000-000000000002', 2026, 'Migracion D Ajena', '2026-01-01', '2026-12-15', 'active');

select lives_ok(
  $$
    insert into public.migration_batches (
      id, workspace_id, cycle_id, source_hash, transform_version, source_manifest, inventory, conciliation, dry_run_generated_at
    ) values (
      '65000000-0000-0000-0000-000000000001',
      '15000000-0000-0000-0000-000000000001',
      '25000000-0000-0000-0000-000000000001',
      'sha256-fixture-d-00000001',
      'D-test',
      '{"sources":["fixture.json"]}',
      '{"members":2}',
      '[]',
      now()
    )
  $$,
  'staging permite lote D con hash y destino explicito'
);

select lives_ok(
  $$
    insert into public.migration_mappings (
      workspace_id, cycle_id, batch_id, source_entity, source_id, target_type, target_table,
      transform_rule, source_ref, payload, status
    ) values (
      '15000000-0000-0000-0000-000000000001',
      '25000000-0000-0000-0000-000000000001',
      '65000000-0000-0000-0000-000000000001',
      'socios',
      'S001',
      'member',
      'cycle_members',
      'D.member.identity-by-legacy-id',
      'json:socios.0',
      '{"legacyId":"S001"}',
      'ready'
    )
  $$,
  'staging conserva mapeo por entidad/ID origen'
);

select lives_ok(
  $$
    insert into public.migration_issues (
      workspace_id, cycle_id, batch_id, stable_id, category, code, source_path, reason, effect
    ) values (
      '15000000-0000-0000-0000-000000000001',
      '25000000-0000-0000-0000-000000000001',
      '65000000-0000-0000-0000-000000000001',
      'PAYMENT_MARK_1',
      'requires_decision',
      'PAYMENT_MARK_WITHOUT_FACTS',
      'pagos.P001#1',
      'pagado=true no prueba fecha ni aplicacion',
      'no se publica cobro'
    )
  $$,
  'staging conserva incidencias de decision'
);

select is(
  public.migration_batch_has_blockers('65000000-0000-0000-0000-000000000001'),
  false,
  'lote sin bloqueantes abiertos puede avanzar a ensayo parcial'
);

select lives_ok(
  $$
    insert into public.migration_issues (
      workspace_id, cycle_id, batch_id, stable_id, category, code, source_path, reason, effect
    ) values (
      '15000000-0000-0000-0000-000000000001',
      '25000000-0000-0000-0000-000000000001',
      '65000000-0000-0000-0000-000000000001',
      'BLOCK_SOURCE_JSON_MISSING',
      'blocking',
      'SOURCE_JSON_MISSING',
      'json',
      'falta JSON vigente',
      'no publicar dependencias financieras'
    )
  $$,
  'staging clasifica bloqueantes'
);

select is(
  public.migration_batch_has_blockers('65000000-0000-0000-0000-000000000001'),
  true,
  'lote con bloqueante abierto se reporta bloqueado'
);

select throws_ok(
  $$
    insert into public.migration_batches (
      workspace_id, cycle_id, source_hash, transform_version, dry_run_generated_at
    ) values (
      '15000000-0000-0000-0000-000000000001',
      '25000000-0000-0000-0000-000000000001',
      'short',
      'D-test',
      now()
    )
  $$,
  null,
  null,
  'rechaza hash insuficiente'
);

select throws_ok(
  $$
    insert into public.migration_mappings (
      workspace_id, cycle_id, batch_id, source_entity, source_id, target_type,
      transform_rule, source_ref, payload, status
    ) values (
      '15000000-0000-0000-0000-000000000001',
      '25000000-0000-0000-0000-000000000001',
      '65000000-0000-0000-0000-000000000001',
      'socios',
      'S002',
      'member',
      'D.member.identity-by-legacy-id',
      'json:socios.1',
      '{}',
      'done'
    )
  $$,
  null,
  null,
  'rechaza estado de mapeo fuera del vocabulario'
);

insert into public.members (id, workspace_id, display_name, legacy_id)
values ('35000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', 'Socio D', 'D-S001');

insert into public.cycle_members (id, workspace_id, cycle_id, member_id, monthly_quota)
values ('45000000-0000-0000-0000-000000000001', '15000000-0000-0000-0000-000000000001', '25000000-0000-0000-0000-000000000001', '35000000-0000-0000-0000-000000000001', 100000);

set local role authenticated;
set local request.jwt.claim.sub = '05000000-0000-0000-0000-000000000001';

select lives_ok(
  $$
    select public.register_savings_contribution('45000000-0000-0000-0000-000000000001', 'd-migration-save-001', 100000, '2026-09-23', 2026, 10, 'bank_transfer', 'legacy_migration_trial');
  $$,
  'fuente legacy_migration_trial queda permitida para ensayo'
);

select is(
  (select round(sum(amount), 2) from public.ledger_entries where cycle_id = '25000000-0000-0000-0000-000000000001'),
  0::numeric,
  'aporte migrado por ensayo conserva ledger balanceado'
);

select is(
  (select count(*)::integer from public.migration_batches),
  1,
  'no se crea lote extra por pruebas fallidas'
);

set local request.jwt.claim.sub = '05000000-0000-0000-0000-000000000002';

select is(
  (select count(*)::integer from public.migration_batches),
  0,
  'RLS oculta lotes D a usuario de otro workspace'
);

select is(
  (select count(*)::integer from public.migration_mappings),
  0,
  'RLS oculta mapeos D a usuario de otro workspace'
);

select is(
  (select count(*)::integer from public.migration_issues),
  0,
  'RLS oculta incidencias D a usuario de otro workspace'
);

select * from finish();
rollback;
