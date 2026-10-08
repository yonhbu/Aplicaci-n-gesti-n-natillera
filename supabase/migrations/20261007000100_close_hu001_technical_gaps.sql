alter table public.cycles
  add constraint cycles_finite_dates_check
  check (
    starts_on not in ('infinity'::date, '-infinity'::date)
    and closes_on not in ('infinity'::date, '-infinity'::date)
  );

alter table public.savings_contributions
  add constraint savings_contributions_finite_effective_date_check
  check (effective_date not in ('infinity'::date, '-infinity'::date));

grant execute on function public.current_user_is_workspace_admin(uuid) to authenticated;

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

  if p_effective_date is null or p_effective_date in ('infinity'::date, '-infinity'::date) then
    raise exception 'La fecha efectiva debe ser una fecha finita.';
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

  if p_amount is null or p_amount::text = 'NaN' or p_amount <= 0 or p_amount <> round(p_amount, 2) then
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

revoke execute on function public.register_savings_contribution(uuid, text, numeric, date, integer, integer, text, text) from public, anon;
grant execute on function public.register_savings_contribution(uuid, text, numeric, date, integer, integer, text, text) to authenticated;
