alter table public.savings_contributions
  add constraint savings_contributions_amount_finite_scale_check
  check (amount::text <> 'NaN' and amount = round(amount, 2));

create or replace function public.prevent_cycle_member_identity_changes()
returns trigger
language plpgsql
as $$
begin
  if old.workspace_id is distinct from new.workspace_id
    or old.cycle_id is distinct from new.cycle_id
    or old.member_id is distinct from new.member_id then
    raise exception 'No se puede cambiar la identidad de una participacion del ciclo.';
  end if;
  return new;
end;
$$;

create trigger cycle_members_prevent_identity_changes
before update on public.cycle_members
for each row execute function public.prevent_cycle_member_identity_changes();

create or replace function public.prevent_member_workspace_change()
returns trigger
language plpgsql
as $$
begin
  if old.workspace_id is distinct from new.workspace_id then
    raise exception 'No se puede cambiar el workspace de un socio.';
  end if;
  return new;
end;
$$;

create trigger members_prevent_workspace_change
before update on public.members
for each row execute function public.prevent_member_workspace_change();

create or replace function public.audit_member_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    event_type,
    entity_table,
    entity_id,
    payload
  ) values (
    coalesce(new.workspace_id, old.workspace_id),
    auth.uid(),
    case when tg_op = 'INSERT' then 'member.created' else 'member.updated' end,
    'members',
    coalesce(new.id, old.id),
    jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.audit_cycle_member_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_events (
    workspace_id,
    actor_user_id,
    event_type,
    entity_table,
    entity_id,
    payload
  ) values (
    coalesce(new.workspace_id, old.workspace_id),
    auth.uid(),
    case when tg_op = 'INSERT' then 'cycle_member.created' else 'cycle_member.updated' end,
    'cycle_members',
    coalesce(new.id, old.id),
    jsonb_build_object('old', to_jsonb(old), 'new', to_jsonb(new))
  );
  return coalesce(new, old);
end;
$$;

create trigger members_audit_insert
after insert on public.members
for each row execute function public.audit_member_mutation();

create trigger members_audit_update
after update on public.members
for each row execute function public.audit_member_mutation();

create trigger cycle_members_audit_insert
after insert on public.cycle_members
for each row execute function public.audit_cycle_member_mutation();

create trigger cycle_members_audit_update
after update on public.cycle_members
for each row execute function public.audit_cycle_member_mutation();

create or replace function public.save_cycle_member(
  p_workspace_id uuid,
  p_cycle_id uuid,
  p_member_id uuid,
  p_cycle_member_id uuid,
  p_display_name text,
  p_legacy_id text,
  p_monthly_quota numeric,
  p_participation_start_month integer,
  p_participation_end_month integer,
  p_participates_in_polla boolean,
  p_participates_in_loan_profit boolean
)
returns public.cycle_members
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target_cycle public.cycles%rowtype;
  saved_member public.members%rowtype;
  saved_cycle_member public.cycle_members%rowtype;
begin
  if actor is null then
    raise exception 'Debe iniciar sesion.';
  end if;

  if not public.current_user_is_workspace_admin(p_workspace_id) then
    raise exception 'No tiene permiso sobre este workspace.';
  end if;

  select *
  into target_cycle
  from public.cycles c
  where c.id = p_cycle_id
    and c.workspace_id = p_workspace_id;

  if target_cycle.id is null then
    raise exception 'Ciclo no encontrado para el workspace.';
  end if;

  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'El nombre visible es obligatorio.';
  end if;

  if p_monthly_quota::text = 'NaN' or p_monthly_quota <= 0 or p_monthly_quota <> round(p_monthly_quota, 2) then
    raise exception 'La cuota debe ser finita, positiva y con maximo dos decimales.';
  end if;

  if p_participation_start_month < 1 or p_participation_start_month > 12
    or p_participation_end_month < 1 or p_participation_end_month > 12
    or p_participation_start_month > p_participation_end_month then
    raise exception 'El rango de participacion no es valido.';
  end if;

  if p_member_id is null then
    insert into public.members (workspace_id, display_name, legacy_id)
    values (p_workspace_id, trim(p_display_name), nullif(trim(coalesce(p_legacy_id, '')), ''))
    returning * into saved_member;

    insert into public.cycle_members (
      workspace_id,
      cycle_id,
      member_id,
      monthly_quota,
      participation_start_month,
      participation_end_month,
      participates_in_polla,
      participates_in_loan_profit
    ) values (
      p_workspace_id,
      p_cycle_id,
      saved_member.id,
      p_monthly_quota,
      p_participation_start_month,
      p_participation_end_month,
      coalesce(p_participates_in_polla, false),
      coalesce(p_participates_in_loan_profit, true)
    )
    returning * into saved_cycle_member;
  else
    update public.members
    set
      display_name = trim(p_display_name),
      legacy_id = nullif(trim(coalesce(p_legacy_id, '')), '')
    where id = p_member_id
      and workspace_id = p_workspace_id
    returning * into saved_member;

    if saved_member.id is null then
      raise exception 'Socio no encontrado para actualizar.';
    end if;

    update public.cycle_members
    set
      monthly_quota = p_monthly_quota,
      participation_start_month = p_participation_start_month,
      participation_end_month = p_participation_end_month,
      participates_in_polla = coalesce(p_participates_in_polla, false),
      participates_in_loan_profit = coalesce(p_participates_in_loan_profit, true)
    where id = p_cycle_member_id
      and workspace_id = p_workspace_id
      and cycle_id = p_cycle_id
      and member_id = p_member_id
    returning * into saved_cycle_member;

    if saved_cycle_member.id is null then
      raise exception 'Participacion del ciclo no encontrada para actualizar.';
    end if;
  end if;

  return saved_cycle_member;
end;
$$;

create or replace function public.register_savings_contribution(
  p_cycle_member_id uuid,
  p_idempotency_key text,
  p_amount numeric,
  p_effective_date date,
  p_applied_year integer,
  p_applied_month integer,
  p_method text,
  p_source text default 'manual'
)
returns public.savings_contributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target public.cycle_members%rowtype;
  target_cycle public.cycles%rowtype;
  existing public.savings_contributions%rowtype;
  created public.savings_contributions%rowtype;
  normalized_key text := trim(coalesce(p_idempotency_key, ''));
  normalized_source text := coalesce(p_source, 'manual');
begin
  if actor is null then
    raise exception 'Debe iniciar sesion.';
  end if;

  select *
  into target
  from public.cycle_members cm
  where cm.id = p_cycle_member_id;

  if target.id is null then
    raise exception 'Socio del ciclo no encontrado.';
  end if;

  select *
  into target_cycle
  from public.cycles c
  where c.id = target.cycle_id
    and c.workspace_id = target.workspace_id;

  if not public.current_user_is_workspace_admin(target.workspace_id) then
    raise exception 'No tiene permiso sobre este workspace.';
  end if;

  if target_cycle.status <> 'active' then
    raise exception 'El ciclo no esta activo.';
  end if;

  if target.savings_status <> 'active' or target.participates_in_savings is not true then
    raise exception 'El socio no esta habilitado para aportes de ahorro en este ciclo.';
  end if;

  if p_applied_year <> target_cycle.year then
    raise exception 'El ano aplicado no corresponde al ciclo.';
  end if;

  if p_applied_month < target.participation_start_month or p_applied_month > target.participation_end_month then
    raise exception 'El mes aplicado esta fuera del rango de participacion del socio.';
  end if;

  if normalized_key = '' or length(normalized_key) < 8 then
    raise exception 'La clave de idempotencia es obligatoria.';
  end if;

  if p_amount::text = 'NaN' or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'El aporte debe ser finito, positivo y con maximo dos decimales.';
  end if;

  if p_method not in ('cash', 'bank_transfer', 'bank_deposit', 'other') then
    raise exception 'Metodo de aporte invalido.';
  end if;

  if normalized_source not in ('manual', 'legacy_prevalidation') then
    raise exception 'Fuente de aporte invalida.';
  end if;

  insert into public.savings_contributions (
    workspace_id,
    cycle_id,
    member_id,
    cycle_member_id,
    idempotency_key,
    amount,
    effective_date,
    applied_year,
    applied_month,
    method,
    source,
    actor_user_id
  ) values (
    target.workspace_id,
    target.cycle_id,
    target.member_id,
    target.id,
    normalized_key,
    p_amount,
    p_effective_date,
    p_applied_year,
    p_applied_month,
    p_method,
    normalized_source,
    actor
  )
  on conflict (workspace_id, idempotency_key) do nothing
  returning * into created;

  if created.id is not null then
    return created;
  end if;

  select *
  into existing
  from public.savings_contributions sc
  where sc.workspace_id = target.workspace_id
    and sc.idempotency_key = normalized_key;

  if existing.id is not null
    and existing.cycle_member_id = p_cycle_member_id
    and existing.amount = p_amount
    and existing.effective_date = p_effective_date
    and existing.applied_year = p_applied_year
    and existing.applied_month = p_applied_month
    and existing.method = p_method
    and existing.source = normalized_source then
    return existing;
  end if;

  raise exception 'La clave de idempotencia ya existe con otro contenido.';
end;
$$;

revoke insert, update, delete on public.members, public.cycle_members from anon, authenticated;
revoke execute on function public.save_cycle_member(uuid, uuid, uuid, uuid, text, text, numeric, integer, integer, boolean, boolean) from public, anon;
revoke execute on function public.register_savings_contribution(uuid, text, numeric, date, integer, integer, text, text) from public, anon;
revoke execute on function public.current_user_is_workspace_admin(uuid) from public, anon;
grant execute on function public.save_cycle_member(uuid, uuid, uuid, uuid, text, text, numeric, integer, integer, boolean, boolean) to authenticated;
grant execute on function public.register_savings_contribution(uuid, text, numeric, date, integer, integer, text, text) to authenticated;
revoke all on function public.audit_member_mutation() from anon, authenticated;
revoke all on function public.audit_cycle_member_mutation() from anon, authenticated;
