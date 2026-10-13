alter table public.savings_contributions
  drop constraint if exists savings_contributions_source_check;

alter table public.savings_contributions
  add constraint savings_contributions_source_check
  check (source in ('manual', 'legacy_prevalidation', 'legacy_migration_trial'));

create table public.migration_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cycle_id uuid not null,
  source_hash text not null check (length(trim(source_hash)) >= 8),
  transform_version text not null check (length(trim(transform_version)) > 0),
  source_manifest jsonb not null default '{}'::jsonb,
  inventory jsonb not null default '{}'::jsonb,
  conciliation jsonb not null default '[]'::jsonb,
  status text not null default 'staged' check (status in ('staged', 'blocked', 'trial_published', 'exported', 'restored')),
  dry_run_generated_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, source_hash, transform_version),
  unique (workspace_id, id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id)
);

create table public.migration_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  batch_id uuid not null,
  source_entity text not null,
  source_id text not null,
  target_type text not null,
  target_table text,
  target_id uuid,
  transform_rule text not null,
  source_ref text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null check (status in ('ready', 'staged_only', 'blocked', 'published', 'conflict')),
  created_at timestamptz not null default now(),
  unique (batch_id, source_entity, source_id, target_type),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, batch_id) references public.migration_batches(workspace_id, id) on delete cascade
);

create table public.migration_issues (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  batch_id uuid not null,
  stable_id text not null,
  category text not null check (category in ('blocking', 'requires_decision', 'descriptive')),
  code text not null,
  source_path text not null,
  reason text not null,
  effect text not null,
  status text not null default 'open' check (status in ('open', 'resolved', 'accepted_risk')),
  created_at timestamptz not null default now(),
  unique (batch_id, stable_id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, batch_id) references public.migration_batches(workspace_id, id) on delete cascade
);

create table public.migration_provenance_records (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  batch_id uuid not null,
  source_entity text not null,
  source_id text not null,
  source_ref text not null,
  source_hash text not null,
  raw_record jsonb not null,
  protected boolean not null default true,
  created_at timestamptz not null default now(),
  unique (batch_id, source_entity, source_id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, batch_id) references public.migration_batches(workspace_id, id) on delete cascade
);

create table public.migration_exports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  batch_id uuid,
  export_hash text not null check (length(trim(export_hash)) >= 8),
  format text not null check (format = 'natillera-manager.abcd.v1'),
  inventory jsonb not null default '{}'::jsonb,
  comparison jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, export_hash),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, batch_id) references public.migration_batches(workspace_id, id)
);

alter table public.migration_batches enable row level security;
alter table public.migration_mappings enable row level security;
alter table public.migration_issues enable row level security;
alter table public.migration_provenance_records enable row level security;
alter table public.migration_exports enable row level security;

create trigger migration_batches_touch_updated_at
before update on public.migration_batches
for each row execute function public.touch_updated_at();

create policy "workspace admins read migration batches" on public.migration_batches
  for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

create policy "workspace admins read migration mappings" on public.migration_mappings
  for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

create policy "workspace admins read migration issues" on public.migration_issues
  for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

create policy "workspace admins read migration provenance" on public.migration_provenance_records
  for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

create policy "workspace admins read migration exports" on public.migration_exports
  for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

grant select on public.migration_batches, public.migration_mappings, public.migration_issues,
  public.migration_provenance_records, public.migration_exports to authenticated;

revoke insert, update, delete on public.migration_batches, public.migration_mappings,
  public.migration_issues, public.migration_provenance_records, public.migration_exports
  from anon, authenticated;

create or replace function public.migration_batch_has_blockers(p_batch_id uuid)
returns boolean
language sql
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.migration_issues mi
    where mi.batch_id = p_batch_id
      and mi.category = 'blocking'
      and mi.status = 'open'
  );
$$;

revoke execute on function public.migration_batch_has_blockers(uuid) from public, anon;
grant execute on function public.migration_batch_has_blockers(uuid) to authenticated;

