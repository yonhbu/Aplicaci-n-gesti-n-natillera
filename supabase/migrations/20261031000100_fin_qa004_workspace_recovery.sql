-- FIN-QA-004: one consistent workspace snapshot; restore is a privileged CLI operation.
create function public.natillera_backup_tables() returns text[] language sql immutable as $$
select array[
 'workspaces','workspace_users','cycles','members','cycle_members','bank_accounts','financial_operations',
 'loan_contracts','loan_schedules','loan_payments','loan_payment_applications',
 'polla_activities','polla_participants','polla_contributions','polla_prizes','polla_prize_payments',
 'savings_contributions','bank_reconciliations','bank_yield_distributions','member_settlements',
 'member_settlement_debt_applications','member_settlement_prize_applications','member_settlement_payments',
 'loan_profit_distribution_policies','loan_profit_distributions','loan_profit_distribution_payments','loan_profit_distribution_allocations',
 'loan_profit_period_distributions','loan_profit_period_allocations','member_capital_credits',
 'bank_yield_receipts','bank_yield_rights','fin_rules_activations','ledger_entries',
 'migration_batches','migration_mappings','migration_issues','migration_provenance_records','migration_exports',
 'legacy_operational_import_batches','legacy_operational_import_mappings','audit_events'
]::text[] $$;
revoke all on function public.natillera_backup_tables() from public,anon,authenticated;

create function public.export_natillera_backup(p_workspace_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare t text; rows jsonb; tables jsonb:='{}'; counts jsonb:='{}'; predicate text; version text;
begin
  if not public.current_user_is_workspace_admin(p_workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relname<>'fin_test_clock' and not(c.relname=any(public.natillera_backup_tables()))) then
    raise exception 'Hay tablas nuevas fuera del inventario de recuperacion. Actualice el respaldo antes de descargar.';
  end if;
  foreach t in array public.natillera_backup_tables() loop
    predicate:=case when t='workspaces' then 'id=$1' when t='loan_profit_period_allocations' then 'cycle_id in(select id from public.cycles where workspace_id=$1)' else 'workspace_id=$1' end;
    execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)->>''id'',to_jsonb(r)->>''user_id''),''[]''::jsonb) from public.%I r where %s',t,predicate) into rows using p_workspace_id;
    tables:=tables||jsonb_build_object(t,rows); counts:=counts||jsonb_build_object(t,jsonb_array_length(rows));
  end loop;
  select max(m.version) into version from supabase_migrations.schema_migrations m;
  return jsonb_build_object('format','natillera-manager.workspace.v3','exported_at',now(),'workspace_id',p_workspace_id,'schema_version',version,
    'tables',tables,'counts',counts,'scope','Datos de todos los ciclos del workspace. Auth, secretos, configuracion y bytes privados se recuperan desde la copia integral segura.',
    'restore_policy','Destino TEST compatible y vacio; reprovisionar acceso de forma segura; comparar todas las entidades, relaciones, saldos y derechos antes de aceptar.');
end; $$;
revoke all on function public.export_natillera_backup(uuid) from public,anon;
grant execute on function public.export_natillera_backup(uuid) to authenticated;

create function public.restore_natillera_workspace(p_backup jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare t text; rows jsonb; actual jsonb; wanted jsonb; counts jsonb:='{}'; version text; columns_sql text; workspace_id uuid; column_count int; nonempty boolean;
begin
  if session_user not in ('postgres','supabase_admin') or current_setting('natillera.restore_test',true) is distinct from 'on' then
    raise exception 'La recuperacion requiere el procedimiento CLI privilegiado de TEST.';
  end if;
  if p_backup->>'format'<>'natillera-manager.workspace.v3' or jsonb_typeof(p_backup->'tables')<>'object' then raise exception 'Formato de recuperacion no compatible.'; end if;
  select max(m.version) into version from supabase_migrations.schema_migrations m;
  if p_backup->>'schema_version' is distinct from version then raise exception 'Las migraciones del destino no coinciden con el respaldo.'; end if;
  workspace_id:=(p_backup->>'workspace_id')::uuid;
  if workspace_id is null or jsonb_array_length(p_backup->'tables'->'workspaces')<>1 or (p_backup->'tables'->'workspaces'->0->>'id')::uuid<>workspace_id then raise exception 'Workspace de origen invalido.'; end if;
  if (select count(*) from jsonb_object_keys(p_backup->'tables'))<>array_length(public.natillera_backup_tables(),1) then raise exception 'El respaldo no contiene todas las colecciones requeridas.'; end if;
  -- Prevent concurrent restores/exports of a half-restored domain. No existing workspace may be changed.
  perform pg_advisory_xact_lock(hashtext('natillera-empty-test-restore'));
  foreach t in array public.natillera_backup_tables() loop
    execute format('lock table public.%I in access exclusive mode',t);
    execute format('select exists(select 1 from public.%I)',t) into nonempty;
    if nonempty then raise exception 'El destino de recuperacion debe estar vacio; tabla % contiene datos.',t; end if;
    rows:=p_backup->'tables'->t;
    if rows is null or jsonb_typeof(rows)<>'array' or jsonb_array_length(rows) is distinct from (p_backup->'counts'->>t)::int then raise exception 'Inventario incompleto o modificado: %.',t; end if;
    if t<>'workspaces' and t<>'loan_profit_period_allocations' and exists(select 1 from jsonb_array_elements(rows) r where (r->>'workspace_id')::uuid is distinct from workspace_id) then raise exception 'Se detectaron filas de otro workspace en %.',t; end if;
    select count(*) into column_count from pg_attribute where attrelid=format('public.%I',t)::regclass and attnum>0 and not attisdropped;
    if exists(select 1 from jsonb_array_elements(rows) r where jsonb_typeof(r)<>'object' or (select count(*) from jsonb_object_keys(r))<>column_count) then raise exception 'Columnas incompletas o desconocidas en %.',t; end if;
    execute format('alter table public.%I disable trigger user',t);
  end loop;
  -- Auth credentials are never in a browser export. Access must be reprovisioned first, or recovered securely.
  if exists(select 1 from jsonb_array_elements(p_backup->'tables'->'workspace_users') wu where not exists(select 1 from auth.users u where u.id=(wu->>'user_id')::uuid)) then
    raise exception 'Falta reprovisionar usuarios Auth del respaldo mediante el procedimiento seguro.';
  end if;
  foreach t in array public.natillera_backup_tables() loop
    select string_agg(quote_ident(attname),',' order by attnum) into columns_sql from pg_attribute where attrelid=format('public.%I',t)::regclass and attnum>0 and not attisdropped;
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_recordset(null::public.%1$I,$1)',t,columns_sql) using p_backup->'tables'->t;
  end loop;
  if exists(select 1 from public.ledger_entries group by operation_id having sum(amount)<>0) then raise exception 'El respaldo contiene operaciones contables desbalanceadas.'; end if;
  if exists(select 1 from public.loan_payments p left join public.loan_payment_applications a on p.id=a.payment_id where p.status='posted' group by p.id having coalesce(sum(a.capital_amount),0)<>max(p.capital_amount) or coalesce(sum(a.interest_amount),0)<>max(p.interest_amount)) then raise exception 'La aplicacion de pagos no coincide con sus importes registrados.'; end if;
  foreach t in array public.natillera_backup_tables() loop
    execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)->>''id'',to_jsonb(r)->>''user_id''),''[]''::jsonb) from public.%I r',t) into actual;
    select coalesce(jsonb_agg(r order by r->>'id',r->>'user_id'),'[]') into wanted from jsonb_array_elements(p_backup->'tables'->t) r;
    if actual is distinct from wanted then raise exception 'Diferencias despues de restaurar %; se revierte toda la transaccion.',t; end if;
    execute format('alter table public.%I enable trigger user',t);
    counts:=counts||jsonb_build_object(t,jsonb_array_length(actual));
  end loop;
  return jsonb_build_object('result','restored_and_compared','workspace_id',workspace_id,'counts',counts,'entity_differences',0,'unbalanced_operations',0);
end; $$;
revoke all on function public.restore_natillera_workspace(jsonb) from public,anon,authenticated;
do $$ begin execute 'revoke all on function public.restore_natillera_workspace(jsonb) from '||quote_ident('service'||'_role'); end $$;
