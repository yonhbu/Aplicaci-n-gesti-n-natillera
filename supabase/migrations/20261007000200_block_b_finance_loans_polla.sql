create table public.financial_operations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  operation_type text not null check (operation_type in (
    'savings_contribution_linked',
    'loan_disbursement',
    'loan_payment',
    'loan_prepayment',
    'polla_contribution',
    'polla_prize_awarded',
    'polla_prize_paid',
    'manual_income',
    'manual_expense',
    'reversal'
  )),
  effective_date date not null check (effective_date not in ('infinity'::date, '-infinity'::date)),
  actor_user_id uuid not null references auth.users(id),
  reference_table text,
  reference_id uuid,
  rule_version text not null default 'B-2026-10-07',
  payload jsonb not null default '{}'::jsonb,
  reverses_operation_id uuid references public.financial_operations(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id)
);

create table public.ledger_entries (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.financial_operations(id) on delete restrict,
  workspace_id uuid not null,
  cycle_id uuid not null,
  account text not null check (account in (
    'cash',
    'loans_receivable',
    'savings_liability',
    'member_loan_profit_fund',
    'polla_pool',
    'prizes_payable',
    'admin_payable',
    'common_income',
    'common_expense'
  )),
  amount numeric(18,2) not null check (amount <> 0 and amount = round(amount, 2) and amount::text <> 'NaN'),
  member_id uuid,
  loan_id uuid,
  polla_activity_id uuid,
  prize_id uuid,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id)
);

create table public.loan_contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  borrower_member_id uuid,
  external_borrower_name text,
  referred_by_member_id uuid,
  principal numeric(18,2) not null check (principal > 0 and principal = round(principal, 2) and principal::text <> 'NaN'),
  method text not null check (method in ('amortized', 'fixed_interest', 'interest_only')),
  rate_unit text not null check (rate_unit in ('EA', 'MONTHLY_FIXED')),
  rate_value numeric(18,8) not null check (rate_value >= 0 and rate_value::text <> 'NaN'),
  term_months integer not null check (term_months > 0 and term_months <= 120),
  start_date date not null check (start_date not in ('infinity'::date, '-infinity'::date)),
  status text not null default 'draft' check (status in ('draft', 'active', 'paid', 'cancelled')),
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  disbursed_operation_id uuid references public.financial_operations(id),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, borrower_member_id) references public.members(workspace_id, id),
  foreign key (workspace_id, referred_by_member_id) references public.members(workspace_id, id),
  check (borrower_member_id is not null or length(trim(coalesce(external_borrower_name, ''))) > 0)
);

create table public.loan_schedules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  loan_id uuid not null,
  installment_number integer not null check (installment_number > 0),
  due_date date not null check (due_date not in ('infinity'::date, '-infinity'::date)),
  principal_due numeric(18,2) not null check (principal_due >= 0),
  interest_due numeric(18,2) not null check (interest_due >= 0),
  status text not null default 'projected' check (status in ('projected', 'paid', 'cancelled')),
  unique (loan_id, installment_number),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, loan_id) references public.loan_contracts(workspace_id, id)
);

create table public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  loan_id uuid not null,
  operation_id uuid not null references public.financial_operations(id),
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  payment_date date not null check (payment_date not in ('infinity'::date, '-infinity'::date)),
  amount numeric(18,2) not null check (amount > 0),
  capital_amount numeric(18,2) not null check (capital_amount >= 0),
  interest_amount numeric(18,2) not null check (interest_amount >= 0),
  kind text not null default 'regular' check (kind in ('regular', 'prepayment')),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, loan_id) references public.loan_contracts(workspace_id, id)
);

create table public.polla_activities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  period_year integer not null check (period_year between 2000 and 2100),
  period_month integer not null check (period_month between 1 and 12),
  name text not null check (length(trim(name)) > 0),
  status text not null default 'open' check (status in ('open', 'awarded', 'closed')),
  created_at timestamptz not null default now(),
  unique (workspace_id, cycle_id, period_year, period_month, name),
  unique (workspace_id, id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id)
);

create table public.polla_participants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  activity_id uuid not null,
  cycle_member_id uuid not null,
  created_at timestamptz not null default now(),
  unique (activity_id, cycle_member_id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, activity_id) references public.polla_activities(workspace_id, id),
  foreign key (workspace_id, cycle_member_id) references public.cycle_members(workspace_id, id)
);

create table public.polla_contributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  activity_id uuid not null,
  cycle_member_id uuid not null,
  operation_id uuid not null references public.financial_operations(id),
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  amount numeric(18,2) not null check (amount > 0),
  paid_date date not null check (paid_date not in ('infinity'::date, '-infinity'::date)),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, activity_id) references public.polla_activities(workspace_id, id),
  foreign key (workspace_id, cycle_member_id) references public.cycle_members(workspace_id, id)
);

create table public.polla_prizes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  activity_id uuid not null,
  winner_cycle_member_id uuid not null,
  award_operation_id uuid not null references public.financial_operations(id),
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  gross_amount numeric(18,2) not null check (gross_amount > 0),
  admin_commission numeric(18,2) not null check (admin_commission >= 0),
  net_amount numeric(18,2) not null check (net_amount >= 0),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'reversed')),
  awarded_at date not null check (awarded_at not in ('infinity'::date, '-infinity'::date)),
  created_at timestamptz not null default now(),
  paid_operation_id uuid references public.financial_operations(id),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, activity_id) references public.polla_activities(workspace_id, id),
  foreign key (workspace_id, winner_cycle_member_id) references public.cycle_members(workspace_id, id)
);

create table public.polla_prize_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  prize_id uuid not null,
  operation_id uuid not null references public.financial_operations(id),
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  amount numeric(18,2) not null check (amount > 0),
  paid_date date not null check (paid_date not in ('infinity'::date, '-infinity'::date)),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, prize_id) references public.polla_prizes(workspace_id, id)
);

alter table public.financial_operations enable row level security;
alter table public.ledger_entries enable row level security;
alter table public.loan_contracts enable row level security;
alter table public.loan_schedules enable row level security;
alter table public.loan_payments enable row level security;
alter table public.polla_activities enable row level security;
alter table public.polla_participants enable row level security;
alter table public.polla_contributions enable row level security;
alter table public.polla_prizes enable row level security;
alter table public.polla_prize_payments enable row level security;

create policy "workspace admins read financial operations" on public.financial_operations for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read ledger entries" on public.ledger_entries for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read loans" on public.loan_contracts for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read schedules" on public.loan_schedules for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read loan payments" on public.loan_payments for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins manage polla activities" on public.polla_activities for all to authenticated using (public.current_user_is_workspace_admin(workspace_id)) with check (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins manage polla participants" on public.polla_participants for all to authenticated using (public.current_user_is_workspace_admin(workspace_id)) with check (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read polla contributions" on public.polla_contributions for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read polla prizes" on public.polla_prizes for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read polla prize payments" on public.polla_prize_payments for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

grant select on public.financial_operations, public.ledger_entries, public.loan_contracts, public.loan_schedules, public.loan_payments, public.polla_contributions, public.polla_prizes, public.polla_prize_payments to authenticated;
grant select, insert, update on public.polla_activities, public.polla_participants to authenticated;

create or replace function public.assert_b_ledger_balanced(entries jsonb)
returns void
language plpgsql
as $$
declare
  total numeric;
begin
  select coalesce(sum((entry->>'amount')::numeric), 0)
  into total
  from jsonb_array_elements(entries) as entry;
  if total <> 0 then
    raise exception 'La operacion financiera no esta balanceada.';
  end if;
end;
$$;

create or replace function public.create_b_operation(
  p_workspace_id uuid,
  p_cycle_id uuid,
  p_idempotency_key text,
  p_operation_type text,
  p_effective_date date,
  p_reference_table text,
  p_reference_id uuid,
  p_payload jsonb,
  p_entries jsonb
)
returns public.financial_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  existing public.financial_operations%rowtype;
  created public.financial_operations%rowtype;
  entry jsonb;
begin
  if actor is null then
    raise exception 'Debe iniciar sesion.';
  end if;
  if not public.current_user_is_workspace_admin(p_workspace_id) then
    raise exception 'No tiene permiso sobre este workspace.';
  end if;
  if p_effective_date is null or p_effective_date in ('infinity'::date, '-infinity'::date) then
    raise exception 'La fecha efectiva debe ser finita.';
  end if;

  select * into existing
  from public.financial_operations
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key);

  if existing.id is not null then
    if existing.operation_type = p_operation_type
      and existing.effective_date = p_effective_date
      and existing.payload = coalesce(p_payload, '{}'::jsonb) then
      return existing;
    end if;
    raise exception 'La clave de idempotencia financiera ya existe con otro contenido.';
  end if;

  perform public.assert_b_ledger_balanced(p_entries);

  insert into public.financial_operations (
    workspace_id, cycle_id, idempotency_key, operation_type, effective_date,
    actor_user_id, reference_table, reference_id, payload
  ) values (
    p_workspace_id, p_cycle_id, trim(p_idempotency_key), p_operation_type, p_effective_date,
    actor, p_reference_table, p_reference_id, coalesce(p_payload, '{}'::jsonb)
  )
  returning * into created;

  for entry in select * from jsonb_array_elements(p_entries) loop
    if (entry->>'amount')::numeric = 0 then
      continue;
    end if;
    insert into public.ledger_entries (
      operation_id, workspace_id, cycle_id, account, amount, member_id, loan_id, polla_activity_id, prize_id
    ) values (
      created.id,
      p_workspace_id,
      p_cycle_id,
      entry->>'account',
      (entry->>'amount')::numeric,
      nullif(entry->>'member_id', '')::uuid,
      nullif(entry->>'loan_id', '')::uuid,
      nullif(entry->>'polla_activity_id', '')::uuid,
      nullif(entry->>'prize_id', '')::uuid
    );
  end loop;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_table, entity_id, payload)
  values (p_workspace_id, actor, 'financial_operation.created', 'financial_operations', created.id, created.payload);

  return created;
end;
$$;

create or replace function public.create_loan_contract(
  p_cycle_id uuid,
  p_idempotency_key text,
  p_borrower_member_id uuid,
  p_external_borrower_name text,
  p_referred_by_member_id uuid,
  p_principal numeric,
  p_method text,
  p_rate_unit text,
  p_rate_value numeric,
  p_term_months integer,
  p_start_date date
)
returns public.loan_contracts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target_cycle public.cycles%rowtype;
  existing public.loan_contracts%rowtype;
  created public.loan_contracts%rowtype;
  i integer;
  principal_due numeric(18,2);
  interest_due numeric(18,2);
begin
  if actor is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;

  select * into existing from public.loan_contracts
  where workspace_id = target_cycle.workspace_id and idempotency_key = trim(p_idempotency_key);
  if existing.id is not null then return existing; end if;

  insert into public.loan_contracts (
    workspace_id, cycle_id, borrower_member_id, external_borrower_name, referred_by_member_id,
    principal, method, rate_unit, rate_value, term_months, start_date, idempotency_key, created_by
  ) values (
    target_cycle.workspace_id, target_cycle.id, p_borrower_member_id, nullif(trim(coalesce(p_external_borrower_name, '')), ''),
    p_referred_by_member_id, p_principal, p_method, p_rate_unit, p_rate_value, p_term_months, p_start_date, trim(p_idempotency_key), actor
  ) returning * into created;

  for i in 1..p_term_months loop
    principal_due := case
      when p_method = 'interest_only' and i < p_term_months then 0
      when p_method = 'fixed_interest' then round(p_principal / p_term_months, 2)
      else round(p_principal / p_term_months, 2)
    end;
    if i = p_term_months then
      principal_due := p_principal - coalesce((select sum(ls.principal_due) from public.loan_schedules ls where ls.loan_id = created.id), 0);
    end if;
    interest_due := case
      when p_rate_unit = 'MONTHLY_FIXED' then round(p_principal * p_rate_value, 2)
      else 0
    end;
    insert into public.loan_schedules (workspace_id, cycle_id, loan_id, installment_number, due_date, principal_due, interest_due)
    values (created.workspace_id, created.cycle_id, created.id, i, (p_start_date + (i || ' month')::interval)::date, principal_due, interest_due);
  end loop;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_table, entity_id, payload)
  values (created.workspace_id, actor, 'loan_contract.created', 'loan_contracts', created.id, to_jsonb(created));

  return created;
end;
$$;

create or replace function public.confirm_loan_disbursement(p_loan_id uuid, p_idempotency_key text, p_disbursed_date date)
returns public.loan_contracts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  loan public.loan_contracts%rowtype;
  op public.financial_operations%rowtype;
begin
  select * into loan from public.loan_contracts where id = p_loan_id;
  if loan.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(loan.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if loan.status <> 'draft' and loan.disbursed_operation_id is not null then return loan; end if;

  op := public.create_b_operation(
    loan.workspace_id, loan.cycle_id, p_idempotency_key, 'loan_disbursement', p_disbursed_date,
    'loan_contracts', loan.id,
    jsonb_build_object('loan_id', loan.id, 'principal', loan.principal),
    jsonb_build_array(
      jsonb_build_object('account', 'loans_receivable', 'amount', loan.principal, 'loan_id', loan.id),
      jsonb_build_object('account', 'cash', 'amount', -loan.principal, 'loan_id', loan.id)
    )
  );

  update public.loan_contracts
  set status = 'active', disbursed_operation_id = op.id
  where id = loan.id
  returning * into loan;
  return loan;
end;
$$;

create or replace function public.record_loan_payment(
  p_loan_id uuid,
  p_idempotency_key text,
  p_payment_date date,
  p_amount numeric,
  p_capital_amount numeric,
  p_interest_amount numeric,
  p_kind text default 'regular'
)
returns public.loan_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  loan public.loan_contracts%rowtype;
  existing public.loan_payments%rowtype;
  op public.financial_operations%rowtype;
  created public.loan_payments%rowtype;
  admin numeric(18,2);
  fund numeric(18,2);
  outstanding numeric(18,2);
begin
  select * into loan from public.loan_contracts where id = p_loan_id;
  if loan.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(loan.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_amount <> p_capital_amount + p_interest_amount then raise exception 'El pago debe coincidir con capital mas interes.'; end if;
  if p_amount <= 0 or p_capital_amount < 0 or p_interest_amount < 0 then raise exception 'Importes de cobro invalidos.'; end if;

  select * into existing from public.loan_payments where workspace_id = loan.workspace_id and idempotency_key = trim(p_idempotency_key);
  if existing.id is not null then return existing; end if;

  admin := round(p_interest_amount * 0.10, 2);
  fund := p_interest_amount - admin;
  op := public.create_b_operation(
    loan.workspace_id, loan.cycle_id, p_idempotency_key, case when p_kind = 'prepayment' then 'loan_prepayment' else 'loan_payment' end, p_payment_date,
    'loan_contracts', loan.id,
    jsonb_build_object('loan_id', loan.id, 'amount', p_amount, 'capital', p_capital_amount, 'interest', p_interest_amount, 'admin', admin, 'member_fund', fund),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'amount', p_amount, 'loan_id', loan.id),
      jsonb_build_object('account', 'loans_receivable', 'amount', -p_capital_amount, 'loan_id', loan.id),
      jsonb_build_object('account', 'admin_payable', 'amount', -admin, 'loan_id', loan.id),
      jsonb_build_object('account', 'member_loan_profit_fund', 'amount', -fund, 'loan_id', loan.id)
    )
  );

  insert into public.loan_payments (
    workspace_id, cycle_id, loan_id, operation_id, idempotency_key, payment_date, amount, capital_amount, interest_amount, kind
  ) values (
    loan.workspace_id, loan.cycle_id, loan.id, op.id, trim(p_idempotency_key), p_payment_date, p_amount, p_capital_amount, p_interest_amount, p_kind
  ) returning * into created;

  select loan.principal - coalesce(sum(lp.capital_amount), 0)
  into outstanding
  from public.loan_payments lp
  where lp.loan_id = loan.id;

  if outstanding <= 0 then
    update public.loan_contracts set status = 'paid' where id = loan.id;
    update public.loan_schedules set status = 'cancelled' where loan_id = loan.id and status = 'projected';
  end if;

  return created;
end;
$$;

create or replace function public.register_polla_contribution(
  p_activity_id uuid,
  p_cycle_member_id uuid,
  p_idempotency_key text,
  p_amount numeric,
  p_paid_date date
)
returns public.polla_contributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  activity public.polla_activities%rowtype;
  existing public.polla_contributions%rowtype;
  op public.financial_operations%rowtype;
  created public.polla_contributions%rowtype;
begin
  select * into activity from public.polla_activities where id = p_activity_id;
  if activity.id is null then raise exception 'Actividad no encontrada.'; end if;
  if not public.current_user_is_workspace_admin(activity.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_amount <= 0 then raise exception 'El aporte de polla debe ser positivo.'; end if;

  insert into public.polla_participants (workspace_id, cycle_id, activity_id, cycle_member_id)
  values (activity.workspace_id, activity.cycle_id, activity.id, p_cycle_member_id)
  on conflict (activity_id, cycle_member_id) do nothing;

  select * into existing from public.polla_contributions where workspace_id = activity.workspace_id and idempotency_key = trim(p_idempotency_key);
  if existing.id is not null then return existing; end if;

  op := public.create_b_operation(
    activity.workspace_id, activity.cycle_id, p_idempotency_key, 'polla_contribution', p_paid_date,
    'polla_activities', activity.id,
    jsonb_build_object('activity_id', activity.id, 'cycle_member_id', p_cycle_member_id, 'amount', p_amount),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'amount', p_amount, 'polla_activity_id', activity.id),
      jsonb_build_object('account', 'polla_pool', 'amount', -p_amount, 'polla_activity_id', activity.id)
    )
  );

  insert into public.polla_contributions (workspace_id, cycle_id, activity_id, cycle_member_id, operation_id, idempotency_key, amount, paid_date)
  values (activity.workspace_id, activity.cycle_id, activity.id, p_cycle_member_id, op.id, trim(p_idempotency_key), p_amount, p_paid_date)
  returning * into created;
  return created;
end;
$$;

create or replace function public.award_polla_prize(
  p_activity_id uuid,
  p_winner_cycle_member_id uuid,
  p_idempotency_key text,
  p_gross_amount numeric,
  p_awarded_at date
)
returns public.polla_prizes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  activity public.polla_activities%rowtype;
  existing public.polla_prizes%rowtype;
  op public.financial_operations%rowtype;
  created public.polla_prizes%rowtype;
  commission numeric(18,2) := 5000;
  net numeric(18,2);
begin
  select * into activity from public.polla_activities where id = p_activity_id;
  if activity.id is null then raise exception 'Actividad no encontrada.'; end if;
  if not public.current_user_is_workspace_admin(activity.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_gross_amount < commission then raise exception 'Falta regla para premios menores que la comision fija.'; end if;
  if not exists (select 1 from public.polla_participants pp where pp.activity_id = activity.id and pp.cycle_member_id = p_winner_cycle_member_id) then
    raise exception 'El ganador no tiene derecho registrado en esta actividad.';
  end if;

  select * into existing from public.polla_prizes where workspace_id = activity.workspace_id and idempotency_key = trim(p_idempotency_key);
  if existing.id is not null then return existing; end if;

  net := p_gross_amount - commission;
  op := public.create_b_operation(
    activity.workspace_id, activity.cycle_id, p_idempotency_key, 'polla_prize_awarded', p_awarded_at,
    'polla_activities', activity.id,
    jsonb_build_object('activity_id', activity.id, 'winner_cycle_member_id', p_winner_cycle_member_id, 'gross', p_gross_amount, 'commission', commission, 'net', net),
    jsonb_build_array(
      jsonb_build_object('account', 'polla_pool', 'amount', p_gross_amount, 'polla_activity_id', activity.id),
      jsonb_build_object('account', 'admin_payable', 'amount', -commission, 'polla_activity_id', activity.id),
      jsonb_build_object('account', 'prizes_payable', 'amount', -net, 'polla_activity_id', activity.id)
    )
  );

  insert into public.polla_prizes (workspace_id, cycle_id, activity_id, winner_cycle_member_id, award_operation_id, idempotency_key, gross_amount, admin_commission, net_amount, awarded_at)
  values (activity.workspace_id, activity.cycle_id, activity.id, p_winner_cycle_member_id, op.id, trim(p_idempotency_key), p_gross_amount, commission, net, p_awarded_at)
  returning * into created;
  update public.polla_activities set status = 'awarded' where id = activity.id;
  return created;
end;
$$;

create or replace function public.pay_polla_prize(p_prize_id uuid, p_idempotency_key text, p_paid_date date)
returns public.polla_prize_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prize public.polla_prizes%rowtype;
  existing public.polla_prize_payments%rowtype;
  op public.financial_operations%rowtype;
  created public.polla_prize_payments%rowtype;
begin
  select * into prize from public.polla_prizes where id = p_prize_id;
  if prize.id is null then raise exception 'Premio no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(prize.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if prize.status = 'paid' then
    select * into existing from public.polla_prize_payments where prize_id = prize.id limit 1;
    return existing;
  end if;

  op := public.create_b_operation(
    prize.workspace_id, prize.cycle_id, p_idempotency_key, 'polla_prize_paid', p_paid_date,
    'polla_prizes', prize.id,
    jsonb_build_object('prize_id', prize.id, 'amount', prize.net_amount),
    jsonb_build_array(
      jsonb_build_object('account', 'prizes_payable', 'amount', prize.net_amount, 'prize_id', prize.id),
      jsonb_build_object('account', 'cash', 'amount', -prize.net_amount, 'prize_id', prize.id)
    )
  );

  insert into public.polla_prize_payments (workspace_id, cycle_id, prize_id, operation_id, idempotency_key, amount, paid_date)
  values (prize.workspace_id, prize.cycle_id, prize.id, op.id, trim(p_idempotency_key), prize.net_amount, p_paid_date)
  returning * into created;
  update public.polla_prizes set status = 'paid', paid_operation_id = op.id where id = prize.id;
  return created;
end;
$$;

create or replace function public.link_existing_savings_contribution_to_ledger(p_contribution_id uuid)
returns public.financial_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  contribution public.savings_contributions%rowtype;
begin
  select * into contribution from public.savings_contributions where id = p_contribution_id;
  if contribution.id is null then raise exception 'Aporte no encontrado.'; end if;
  return public.create_b_operation(
    contribution.workspace_id,
    contribution.cycle_id,
    'savings-link-' || contribution.id::text,
    'savings_contribution_linked',
    contribution.effective_date,
    'savings_contributions',
    contribution.id,
    jsonb_build_object('contribution_id', contribution.id, 'amount', contribution.amount),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'amount', contribution.amount, 'member_id', contribution.member_id),
      jsonb_build_object('account', 'savings_liability', 'amount', -contribution.amount, 'member_id', contribution.member_id)
    )
  );
end;
$$;

grant execute on function public.create_loan_contract(uuid, text, uuid, text, uuid, numeric, text, text, numeric, integer, date) to authenticated;
grant execute on function public.confirm_loan_disbursement(uuid, text, date) to authenticated;
grant execute on function public.record_loan_payment(uuid, text, date, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.register_polla_contribution(uuid, uuid, text, numeric, date) to authenticated;
grant execute on function public.award_polla_prize(uuid, uuid, text, numeric, date) to authenticated;
grant execute on function public.pay_polla_prize(uuid, text, date) to authenticated;
grant execute on function public.link_existing_savings_contribution_to_ledger(uuid) to authenticated;

revoke execute on function public.create_b_operation(uuid, uuid, text, text, date, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.assert_b_ledger_balanced(jsonb) from public, anon, authenticated;
