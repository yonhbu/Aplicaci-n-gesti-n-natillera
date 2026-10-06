create extension if not exists "pgcrypto";

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.workspace_users (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  year integer not null check (year between 2000 and 2100),
  name text not null,
  starts_on date not null,
  closes_on date not null,
  status text not null default 'active' check (status in ('active', 'closed', 'archived')),
  created_at timestamptz not null default now(),
  unique (workspace_id, year),
  unique (workspace_id, id),
  check (starts_on <= closes_on)
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  legacy_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create unique index members_workspace_legacy_id_idx
  on public.members(workspace_id, legacy_id)
  where legacy_id is not null;

create table public.cycle_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  member_id uuid not null,
  monthly_quota numeric(18,2) not null check (monthly_quota > 0),
  participation_start_month integer not null default 1 check (participation_start_month between 1 and 12),
  participation_end_month integer not null default 12 check (participation_end_month between 1 and 12),
  savings_status text not null default 'active' check (savings_status in ('active', 'withdrawn', 'inactive')),
  participates_in_savings boolean not null default true,
  participates_in_polla boolean not null default false,
  participates_in_loan_profit boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cycle_id, member_id),
  unique (workspace_id, id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id) on delete cascade,
  foreign key (workspace_id, member_id) references public.members(workspace_id, id) on delete cascade,
  check (participation_start_month <= participation_end_month)
);

create table public.savings_contributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  member_id uuid not null,
  cycle_member_id uuid not null,
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  amount numeric(18,2) not null check (amount > 0),
  effective_date date not null,
  applied_year integer not null check (applied_year between 2000 and 2100),
  applied_month integer not null check (applied_month between 1 and 12),
  method text not null check (method in ('cash', 'bank_transfer', 'bank_deposit', 'other')),
  source text not null default 'manual' check (source in ('manual', 'legacy_prevalidation')),
  actor_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, member_id) references public.members(workspace_id, id),
  foreign key (workspace_id, cycle_member_id) references public.cycle_members(workspace_id, id)
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  event_type text not null,
  entity_table text not null,
  entity_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger members_touch_updated_at
before update on public.members
for each row execute function public.touch_updated_at();

create trigger cycle_members_touch_updated_at
before update on public.cycle_members
for each row execute function public.touch_updated_at();

create or replace function public.prevent_retroactive_cycle_member_changes()
returns trigger
language plpgsql
as $$
begin
  if exists (
    select 1
    from public.savings_contributions sc
    where sc.workspace_id = old.workspace_id
      and sc.cycle_member_id = old.id
  ) and (
    old.monthly_quota is distinct from new.monthly_quota
    or old.participation_start_month is distinct from new.participation_start_month
    or old.participation_end_month is distinct from new.participation_end_month
  ) then
    raise exception 'No se puede cambiar retroactivamente cuota o rango con aportes existentes.';
  end if;
  return new;
end;
$$;

create trigger cycle_members_prevent_retroactive_changes
before update on public.cycle_members
for each row execute function public.prevent_retroactive_cycle_member_changes();

create or replace function public.audit_savings_contribution_insert()
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
    new.workspace_id,
    new.actor_user_id,
    'savings_contribution.created',
    'savings_contributions',
    new.id,
    jsonb_build_object(
      'cycle_id', new.cycle_id,
      'member_id', new.member_id,
      'cycle_member_id', new.cycle_member_id,
      'amount', new.amount,
      'effective_date', new.effective_date,
      'applied_year', new.applied_year,
      'applied_month', new.applied_month,
      'method', new.method,
      'source', new.source,
      'idempotency_key', new.idempotency_key
    )
  );
  return new;
end;
$$;

create trigger savings_contributions_audit_insert
after insert on public.savings_contributions
for each row execute function public.audit_savings_contribution_insert();

create or replace function public.current_user_is_workspace_admin(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_users wu
    where wu.workspace_id = target_workspace_id
      and wu.user_id = auth.uid()
      and wu.role = 'admin'
  );
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
  existing public.savings_contributions%rowtype;
  created public.savings_contributions%rowtype;
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

  if not public.current_user_is_workspace_admin(target.workspace_id) then
    raise exception 'No tiene permiso sobre este workspace.';
  end if;

  if p_amount <= 0 then
    raise exception 'El aporte debe ser mayor que cero.';
  end if;

  if p_applied_month < 1 or p_applied_month > 12 then
    raise exception 'El mes aplicado debe estar entre 1 y 12.';
  end if;

  select *
  into existing
  from public.savings_contributions sc
  where sc.workspace_id = target.workspace_id
    and sc.idempotency_key = trim(p_idempotency_key);

  if existing.id is not null then
    if existing.cycle_member_id = p_cycle_member_id
      and existing.amount = p_amount
      and existing.effective_date = p_effective_date
      and existing.applied_year = p_applied_year
      and existing.applied_month = p_applied_month
      and existing.method = p_method
      and existing.source = coalesce(p_source, 'manual')
    then
      return existing;
    end if;
    raise exception 'La clave de idempotencia ya existe con otro contenido.';
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
    trim(p_idempotency_key),
    p_amount,
    p_effective_date,
    p_applied_year,
    p_applied_month,
    p_method,
    coalesce(p_source, 'manual'),
    actor
  )
  returning * into created;

  return created;
end;
$$;

alter table public.workspaces enable row level security;
alter table public.workspace_users enable row level security;
alter table public.cycles enable row level security;
alter table public.members enable row level security;
alter table public.cycle_members enable row level security;
alter table public.savings_contributions enable row level security;
alter table public.audit_events enable row level security;

create policy "workspace users can read own memberships"
on public.workspace_users for select
to authenticated
using (user_id = auth.uid());

create policy "workspace members can read workspaces"
on public.workspaces for select
to authenticated
using (public.current_user_is_workspace_admin(id));

create policy "workspace members can read cycles"
on public.cycles for select
to authenticated
using (public.current_user_is_workspace_admin(workspace_id));

create policy "workspace admins manage members"
on public.members for all
to authenticated
using (public.current_user_is_workspace_admin(workspace_id))
with check (public.current_user_is_workspace_admin(workspace_id));

create policy "workspace admins manage cycle members"
on public.cycle_members for all
to authenticated
using (public.current_user_is_workspace_admin(workspace_id))
with check (public.current_user_is_workspace_admin(workspace_id));

create policy "workspace members read savings contributions"
on public.savings_contributions for select
to authenticated
using (public.current_user_is_workspace_admin(workspace_id));

create policy "workspace members read audit events"
on public.audit_events for select
to authenticated
using (public.current_user_is_workspace_admin(workspace_id));

grant usage on schema public to anon, authenticated;
grant select on public.workspaces, public.workspace_users, public.cycles, public.members, public.cycle_members, public.savings_contributions, public.audit_events to authenticated;
grant insert, update on public.members, public.cycle_members to authenticated;
grant execute on function public.register_savings_contribution(uuid, text, numeric, date, integer, integer, text, text) to authenticated;

revoke insert, update, delete on public.savings_contributions from anon, authenticated;
revoke insert, update, delete on public.audit_events from anon, authenticated;
revoke all on function public.audit_savings_contribution_insert() from anon, authenticated;
