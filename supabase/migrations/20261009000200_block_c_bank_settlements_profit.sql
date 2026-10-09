alter table public.financial_operations
  drop constraint if exists financial_operations_operation_type_check;

alter table public.financial_operations
  add constraint financial_operations_operation_type_check check (operation_type in (
    'savings_contribution_linked',
    'loan_disbursement',
    'loan_payment',
    'loan_prepayment',
    'polla_contribution',
    'polla_prize_awarded',
    'polla_prize_paid',
    'manual_income',
    'manual_expense',
    'admin_withdrawal',
    'bank_opening',
    'bank_interest_received',
    'bank_fee',
    'liquidity_transfer',
    'member_settlement_confirmed',
    'member_settlement_paid',
    'loan_profit_distribution_confirmed',
    'loan_profit_distribution_paid',
    'reversal'
  ));

alter table public.ledger_entries
  drop constraint if exists ledger_entries_account_check;

alter table public.ledger_entries
  add constraint ledger_entries_account_check check (account in (
    'cash',
    'loans_receivable',
    'savings_liability',
    'member_loan_profit_fund',
    'polla_pool',
    'prizes_payable',
    'admin_payable',
    'common_income',
    'common_expense',
    'bank_opening_equity',
    'bank_interest_income',
    'bank_fee_expense',
    'settlements_payable',
    'settlement_policy_pending',
    'savings_yield_expense',
    'utility_distribution_payable',
    'liquidity_reserve'
  ));

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  institution_name text,
  masked_identifier text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  unique (workspace_id, display_name),
  unique (workspace_id, id)
);

alter table public.ledger_entries
  add column if not exists liquidity_location text not null default 'unknown'
    check (liquidity_location in ('unknown', 'bank', 'cash')),
  add column if not exists bank_account_id uuid;

alter table public.ledger_entries
  drop constraint if exists ledger_entries_bank_account_fk;

alter table public.ledger_entries
  add constraint ledger_entries_bank_account_fk
  foreign key (workspace_id, bank_account_id)
  references public.bank_accounts(workspace_id, id);

alter table public.ledger_entries
  drop constraint if exists ledger_entries_liquidity_location_check;

alter table public.ledger_entries
  add constraint ledger_entries_liquidity_location_check check (
    (account = 'cash' and liquidity_location in ('unknown', 'bank', 'cash'))
    or (account <> 'cash' and liquidity_location = 'unknown' and bank_account_id is null)
  );

alter table public.ledger_entries
  drop constraint if exists ledger_entries_bank_location_check;

alter table public.ledger_entries
  add constraint ledger_entries_bank_location_check check (
    (liquidity_location = 'bank' and bank_account_id is not null)
    or (liquidity_location <> 'bank' and bank_account_id is null)
  );

alter table public.polla_prizes
  drop constraint if exists polla_prizes_status_check;

alter table public.polla_prizes
  add constraint polla_prizes_status_check check (status in ('pending_payment', 'paid', 'settled', 'reversed'));

alter table public.loan_contracts
  add column if not exists settlement_agreement_code text
    check (settlement_agreement_code is null or settlement_agreement_code in ('P013_FIRST_MONTH'));

create table public.bank_reconciliations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  bank_account_id uuid not null,
  as_of_date date not null check (as_of_date not in ('infinity'::date, '-infinity'::date)),
  opening_verified_balance numeric(18,2) not null check (opening_verified_balance = round(opening_verified_balance, 2)),
  opening_date date not null check (opening_date not in ('infinity'::date, '-infinity'::date)),
  external_balance numeric(18,2) not null check (external_balance = round(external_balance, 2)),
  reconstructed_balance numeric(18,2) not null check (reconstructed_balance = round(reconstructed_balance, 2)),
  difference_amount numeric(18,2) not null check (difference_amount = round(difference_amount, 2)),
  status text not null default 'open' check (status in ('open', 'matched', 'difference')),
  reference text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, bank_account_id) references public.bank_accounts(workspace_id, id)
);

create table public.member_settlements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  cycle_member_id uuid not null,
  member_id uuid not null,
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  cut_date date not null check (cut_date not in ('infinity'::date, '-infinity'::date)),
  status text not null default 'confirmed' check (status in ('confirmed', 'paid', 'reversed')),
  preview_hash text not null,
  snapshot jsonb not null,
  net_amount numeric(18,2) not null check (net_amount = round(net_amount, 2)),
  transfer_amount numeric(18,2) not null check (transfer_amount = round(transfer_amount, 2)),
  rounding_adjustment numeric(18,2) not null check (rounding_adjustment = round(rounding_adjustment, 2)),
  operation_id uuid references public.financial_operations(id),
  paid_operation_id uuid references public.financial_operations(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  paid_at date,
  unique (workspace_id, idempotency_key),
  unique (workspace_id, id),
  unique (cycle_member_id, status) deferrable initially immediate,
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, cycle_member_id) references public.cycle_members(workspace_id, id),
  foreign key (workspace_id, member_id) references public.members(workspace_id, id)
);

create unique index member_settlements_one_open_per_member_idx
  on public.member_settlements(cycle_member_id)
  where status in ('confirmed', 'paid');

create table public.member_settlement_debt_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  settlement_id uuid not null,
  loan_id uuid not null,
  principal_amount numeric(18,2) not null check (principal_amount >= 0 and principal_amount = round(principal_amount, 2)),
  interest_amount numeric(18,2) not null check (interest_amount >= 0 and interest_amount = round(interest_amount, 2)),
  created_at timestamptz not null default now(),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, settlement_id) references public.member_settlements(workspace_id, id),
  foreign key (workspace_id, loan_id) references public.loan_contracts(workspace_id, id)
);

create table public.member_settlement_prize_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  settlement_id uuid not null,
  prize_id uuid not null,
  amount numeric(18,2) not null check (amount > 0 and amount = round(amount, 2)),
  created_at timestamptz not null default now(),
  unique (prize_id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, settlement_id) references public.member_settlements(workspace_id, id),
  foreign key (workspace_id, prize_id) references public.polla_prizes(workspace_id, id)
);

create table public.member_settlement_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  settlement_id uuid not null,
  operation_id uuid not null references public.financial_operations(id),
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  paid_date date not null check (paid_date not in ('infinity'::date, '-infinity'::date)),
  amount numeric(18,2) not null check (amount > 0 and amount = round(amount, 2)),
  liquidity_location text not null check (liquidity_location in ('bank', 'cash')),
  bank_account_id uuid,
  reference text not null check (length(trim(reference)) > 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, settlement_id) references public.member_settlements(workspace_id, id),
  foreign key (workspace_id, bank_account_id) references public.bank_accounts(workspace_id, id),
  check ((liquidity_location = 'bank' and bank_account_id is not null) or (liquidity_location = 'cash' and bank_account_id is null))
);

create table public.loan_profit_distributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  cut_date date not null check (cut_date not in ('infinity'::date, '-infinity'::date)),
  status text not null default 'confirmed' check (status in ('confirmed', 'paid', 'reversed')),
  preview_hash text not null,
  policy_version text not null,
  snapshot jsonb not null,
  distributable_amount numeric(18,2) not null check (distributable_amount >= 0 and distributable_amount = round(distributable_amount, 2)),
  payment_amount numeric(18,2) not null check (payment_amount >= 0 and payment_amount = round(payment_amount, 2)),
  operation_id uuid references public.financial_operations(id),
  paid_operation_id uuid references public.financial_operations(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  unique (workspace_id, cycle_id, cut_date, policy_version),
  unique (workspace_id, id)
);

create table public.loan_profit_distribution_payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  distribution_id uuid not null,
  operation_id uuid not null references public.financial_operations(id),
  idempotency_key text not null check (length(trim(idempotency_key)) >= 8),
  paid_date date not null check (paid_date not in ('infinity'::date, '-infinity'::date)),
  amount numeric(18,2) not null check (amount > 0 and amount = round(amount, 2)),
  liquidity_location text not null check (liquidity_location in ('bank', 'cash')),
  bank_account_id uuid,
  reference text not null check (length(trim(reference)) > 0),
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, distribution_id) references public.loan_profit_distributions(workspace_id, id),
  foreign key (workspace_id, bank_account_id) references public.bank_accounts(workspace_id, id),
  check ((liquidity_location = 'bank' and bank_account_id is not null) or (liquidity_location = 'cash' and bank_account_id is null))
);

alter table public.bank_accounts enable row level security;
alter table public.bank_reconciliations enable row level security;
alter table public.member_settlements enable row level security;
alter table public.member_settlement_debt_applications enable row level security;
alter table public.member_settlement_prize_applications enable row level security;
alter table public.member_settlement_payments enable row level security;
alter table public.loan_profit_distributions enable row level security;
alter table public.loan_profit_distribution_payments enable row level security;

create policy "workspace admins read bank accounts" on public.bank_accounts for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read bank reconciliations" on public.bank_reconciliations for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read settlements" on public.member_settlements for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read settlement debt applications" on public.member_settlement_debt_applications for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read settlement prize applications" on public.member_settlement_prize_applications for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read settlement payments" on public.member_settlement_payments for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read profit distributions" on public.loan_profit_distributions for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read profit distribution payments" on public.loan_profit_distribution_payments for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

grant select on public.bank_accounts, public.bank_reconciliations, public.member_settlements,
  public.member_settlement_debt_applications, public.member_settlement_prize_applications,
  public.member_settlement_payments, public.loan_profit_distributions,
  public.loan_profit_distribution_payments to authenticated;

revoke insert, update, delete on public.bank_accounts, public.bank_reconciliations, public.member_settlements,
  public.member_settlement_debt_applications, public.member_settlement_prize_applications,
  public.member_settlement_payments, public.loan_profit_distributions,
  public.loan_profit_distribution_payments from anon, authenticated;

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
  target_cycle public.cycles%rowtype;
  entry jsonb;
  entry_amount numeric;
  entry_account text;
  entry_location text;
  entry_bank_account_id uuid;
begin
  if actor is null then
    raise exception 'Debe iniciar sesion.';
  end if;

  select * into target_cycle
  from public.cycles
  where workspace_id = p_workspace_id and id = p_cycle_id;

  if target_cycle.id is null then
    raise exception 'Ciclo financiero no encontrado para el workspace.';
  end if;

  if not public.current_user_is_workspace_admin(p_workspace_id) then
    raise exception 'No tiene permiso sobre este workspace.';
  end if;

  if length(trim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'Clave de idempotencia financiera invalida.';
  end if;

  if p_effective_date is null or p_effective_date in ('infinity'::date, '-infinity'::date) then
    raise exception 'La fecha efectiva debe ser finita.';
  end if;

  select * into existing
  from public.financial_operations
  where workspace_id = p_workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;

  if existing.id is not null then
    if existing.cycle_id = p_cycle_id
      and existing.operation_type = p_operation_type
      and existing.effective_date = p_effective_date
      and existing.reference_table is not distinct from p_reference_table
      and existing.reference_id is not distinct from p_reference_id
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
    entry_amount := (entry->>'amount')::numeric;
    entry_account := entry->>'account';
    entry_location := coalesce(nullif(entry->>'liquidity_location', ''), 'unknown');
    entry_bank_account_id := nullif(entry->>'bank_account_id', '')::uuid;
    if entry_amount = 0 then
      continue;
    end if;
    if entry_amount is null or entry_amount::text = 'NaN' or entry_amount <> round(entry_amount, 2) then
      raise exception 'Importe de partida invalido.';
    end if;
    if entry_account <> 'cash' and (entry_location <> 'unknown' or entry_bank_account_id is not null) then
      raise exception 'Solo las partidas de caja pueden tener ubicacion de liquidez.';
    end if;
    if entry_location = 'bank' then
      if entry_bank_account_id is null then
        raise exception 'La partida bancaria requiere cuenta.';
      end if;
      if not exists (
        select 1 from public.bank_accounts ba
        where ba.workspace_id = p_workspace_id and ba.id = entry_bank_account_id and ba.status = 'active'
      ) then
        raise exception 'Cuenta bancaria no encontrada o archivada.';
      end if;
    elsif entry_bank_account_id is not null then
      raise exception 'La cuenta bancaria solo aplica a ubicacion banco.';
    end if;

    insert into public.ledger_entries (
      operation_id, workspace_id, cycle_id, account, amount, member_id, loan_id,
      polla_activity_id, prize_id, liquidity_location, bank_account_id
    ) values (
      created.id,
      p_workspace_id,
      p_cycle_id,
      entry_account,
      entry_amount,
      nullif(entry->>'member_id', '')::uuid,
      nullif(entry->>'loan_id', '')::uuid,
      nullif(entry->>'polla_activity_id', '')::uuid,
      nullif(entry->>'prize_id', '')::uuid,
      entry_location,
      entry_bank_account_id
    );
  end loop;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_table, entity_id, payload)
  values (p_workspace_id, actor, 'financial_operation.created', 'financial_operations', created.id, created.payload);

  return created;
end;
$$;

create or replace function public.cash_available_at(
  p_cycle_id uuid,
  p_effective_date date,
  p_liquidity_location text,
  p_bank_account_id uuid default null
)
returns numeric
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  available numeric(18,2);
begin
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_liquidity_location not in ('bank', 'cash') then raise exception 'Ubicacion de liquidez invalida.'; end if;
  if (p_liquidity_location = 'bank' and p_bank_account_id is null) or (p_liquidity_location = 'cash' and p_bank_account_id is not null) then
    raise exception 'Cuenta y ubicacion no son coherentes.';
  end if;

  select round(coalesce(sum(le.amount), 0), 2) into available
  from public.ledger_entries le
  join public.financial_operations fo on fo.id = le.operation_id
  where le.cycle_id = p_cycle_id
    and le.account = 'cash'
    and le.liquidity_location = p_liquidity_location
    and le.bank_account_id is not distinct from p_bank_account_id
    and fo.effective_date <= p_effective_date;

  return coalesce(available, 0);
end;
$$;

create or replace function public.create_bank_account(
  p_cycle_id uuid,
  p_display_name text,
  p_institution_name text,
  p_masked_identifier text
)
returns public.bank_accounts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  existing public.bank_accounts%rowtype;
  created public.bank_accounts%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;

  select * into existing from public.bank_accounts
  where workspace_id = target_cycle.workspace_id and display_name = trim(p_display_name);
  if existing.id is not null then return existing; end if;

  insert into public.bank_accounts (workspace_id, display_name, institution_name, masked_identifier)
  values (target_cycle.workspace_id, trim(p_display_name), nullif(trim(coalesce(p_institution_name, '')), ''), nullif(trim(coalesce(p_masked_identifier, '')), ''))
  returning * into created;
  return created;
end;
$$;

create or replace function public.record_bank_opening(
  p_cycle_id uuid,
  p_bank_account_id uuid,
  p_idempotency_key text,
  p_effective_date date,
  p_amount numeric,
  p_reference text
)
returns public.financial_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
begin
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_amount, 'saldo inicial verificado', true);
  if not exists (select 1 from public.bank_accounts where workspace_id = target_cycle.workspace_id and id = p_bank_account_id and status = 'active') then
    raise exception 'Cuenta bancaria no encontrada.';
  end if;

  return public.create_b_operation(
    target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'bank_opening', p_effective_date,
    'bank_accounts', p_bank_account_id,
    jsonb_build_object('bank_account_id', p_bank_account_id, 'amount', p_amount, 'reference', coalesce(p_reference, ''), 'source', 'verified_opening_fixture_or_statement'),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'amount', p_amount, 'liquidity_location', 'bank', 'bank_account_id', p_bank_account_id),
      jsonb_build_object('account', 'bank_opening_equity', 'amount', -p_amount)
    )
  );
end;
$$;

create or replace function public.record_bank_interest_received(
  p_cycle_id uuid,
  p_bank_account_id uuid,
  p_idempotency_key text,
  p_effective_date date,
  p_gross_amount numeric,
  p_withholding_amount numeric,
  p_fee_amount numeric,
  p_reference text
)
returns public.financial_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  net_amount numeric(18,2);
  entries jsonb;
begin
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_gross_amount, 'interes bruto recibido', true);
  perform public.assert_money_2(coalesce(p_withholding_amount, 0), 'retencion bancaria', false);
  perform public.assert_money_2(coalesce(p_fee_amount, 0), 'comision asociada al interes', false);
  if not exists (select 1 from public.bank_accounts where workspace_id = target_cycle.workspace_id and id = p_bank_account_id and status = 'active') then
    raise exception 'Cuenta bancaria no encontrada.';
  end if;
  net_amount := round(p_gross_amount - coalesce(p_withholding_amount, 0) - coalesce(p_fee_amount, 0), 2);
  if net_amount <= 0 then raise exception 'El neto del abono bancario debe ser positivo.'; end if;

  entries := jsonb_build_array(
    jsonb_build_object('account', 'cash', 'amount', net_amount, 'liquidity_location', 'bank', 'bank_account_id', p_bank_account_id),
    jsonb_build_object('account', 'bank_interest_income', 'amount', -p_gross_amount)
  );
  if coalesce(p_withholding_amount, 0) > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'common_expense', 'amount', p_withholding_amount));
  end if;
  if coalesce(p_fee_amount, 0) > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'bank_fee_expense', 'amount', p_fee_amount));
  end if;

  return public.create_b_operation(
    target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'bank_interest_received', p_effective_date,
    'bank_accounts', p_bank_account_id,
    jsonb_build_object('bank_account_id', p_bank_account_id, 'gross', p_gross_amount, 'withholding', coalesce(p_withholding_amount, 0), 'fee', coalesce(p_fee_amount, 0), 'net', net_amount, 'reference', coalesce(p_reference, '')),
    entries
  );
end;
$$;

create or replace function public.record_bank_fee(
  p_cycle_id uuid,
  p_bank_account_id uuid,
  p_idempotency_key text,
  p_effective_date date,
  p_amount numeric,
  p_reference text
)
returns public.financial_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
begin
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_amount, 'comision bancaria', true);
  if public.cash_available_at(p_cycle_id, p_effective_date, 'bank', p_bank_account_id) < p_amount then
    raise exception 'Saldo bancario insuficiente para registrar la comision.';
  end if;

  return public.create_b_operation(
    target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'bank_fee', p_effective_date,
    'bank_accounts', p_bank_account_id,
    jsonb_build_object('bank_account_id', p_bank_account_id, 'amount', p_amount, 'reference', coalesce(p_reference, '')),
    jsonb_build_array(
      jsonb_build_object('account', 'bank_fee_expense', 'amount', p_amount),
      jsonb_build_object('account', 'cash', 'amount', -p_amount, 'liquidity_location', 'bank', 'bank_account_id', p_bank_account_id)
    )
  );
end;
$$;

create or replace function public.record_internal_liquidity_transfer(
  p_cycle_id uuid,
  p_idempotency_key text,
  p_effective_date date,
  p_from_location text,
  p_from_bank_account_id uuid,
  p_to_location text,
  p_to_bank_account_id uuid,
  p_amount numeric,
  p_reference text
)
returns public.financial_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
begin
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_amount, 'traslado interno', true);
  if p_from_location not in ('bank', 'cash') or p_to_location not in ('bank', 'cash') then raise exception 'Ubicacion de traslado invalida.'; end if;
  if p_from_location = p_to_location and p_from_bank_account_id is not distinct from p_to_bank_account_id then raise exception 'El traslado requiere ubicaciones distintas.'; end if;
  if public.cash_available_at(p_cycle_id, p_effective_date, p_from_location, p_from_bank_account_id) < p_amount then
    raise exception 'Saldo insuficiente en la ubicacion origen.';
  end if;

  return public.create_b_operation(
    target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'liquidity_transfer', p_effective_date,
    'liquidity_locations', null,
    jsonb_build_object('from_location', p_from_location, 'from_bank_account_id', p_from_bank_account_id, 'to_location', p_to_location, 'to_bank_account_id', p_to_bank_account_id, 'amount', p_amount, 'reference', coalesce(p_reference, '')),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'amount', -p_amount, 'liquidity_location', p_from_location, 'bank_account_id', p_from_bank_account_id),
      jsonb_build_object('account', 'cash', 'amount', p_amount, 'liquidity_location', p_to_location, 'bank_account_id', p_to_bank_account_id)
    )
  );
end;
$$;

create or replace function public.create_bank_reconciliation(
  p_cycle_id uuid,
  p_bank_account_id uuid,
  p_opening_verified_balance numeric,
  p_opening_date date,
  p_external_balance numeric,
  p_as_of_date date,
  p_reference text
)
returns public.bank_reconciliations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  reconstructed numeric(18,2);
  created public.bank_reconciliations%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_opening_verified_balance, 'saldo apertura conciliacion', false);
  perform public.assert_money_2(p_external_balance, 'saldo externo', false);
  reconstructed := public.cash_available_at(p_cycle_id, p_as_of_date, 'bank', p_bank_account_id);

  insert into public.bank_reconciliations (
    workspace_id, cycle_id, bank_account_id, as_of_date, opening_verified_balance,
    opening_date, external_balance, reconstructed_balance, difference_amount, status,
    reference, created_by
  ) values (
    target_cycle.workspace_id, target_cycle.id, p_bank_account_id, p_as_of_date, p_opening_verified_balance,
    p_opening_date, p_external_balance, reconstructed, round(p_external_balance - reconstructed, 2),
    case when round(p_external_balance - reconstructed, 2) = 0 then 'matched' else 'difference' end,
    nullif(trim(coalesce(p_reference, '')), ''), auth.uid()
  ) returning * into created;

  return created;
end;
$$;

create or replace function public.set_loan_settlement_agreement(
  p_loan_id uuid,
  p_agreement_code text
)
returns public.loan_contracts
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  loan public.loan_contracts%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into loan from public.loan_contracts where id = p_loan_id for update;
  if loan.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(loan.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_agreement_code is not null and p_agreement_code <> 'P013_FIRST_MONTH' then
    raise exception 'Acuerdo de liquidacion no soportado.';
  end if;
  update public.loan_contracts
  set settlement_agreement_code = p_agreement_code
  where id = loan.id
  returning * into loan;
  return loan;
end;
$$;

create or replace function public.preview_member_settlement(
  p_cycle_member_id uuid,
  p_cut_date date,
  p_annual_admin_fee numeric,
  p_penalty_amount numeric,
  p_other_discounts numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cm public.cycle_members%rowtype;
  capital numeric(18,2);
  recognized_yield numeric;
  recognized_yield_cents numeric(18,2);
  prizes numeric(18,2);
  principal_debt numeric(18,2);
  p013_interest numeric(18,2);
  debts numeric(18,2);
  net numeric(18,2);
  transfer numeric(18,2);
  rounding numeric(18,2);
  debt_items jsonb;
  prize_items jsonb;
  snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into cm from public.cycle_members where id = p_cycle_member_id;
  if cm.id is null then raise exception 'Participacion no encontrada.'; end if;
  if not public.current_user_is_workspace_admin(cm.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_cut_date is null or p_cut_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de corte invalida.'; end if;
  perform public.assert_money_2(coalesce(p_annual_admin_fee, 0), 'cuota anual', false);
  perform public.assert_money_2(coalesce(p_penalty_amount, 0), 'penalidad', false);
  perform public.assert_money_2(coalesce(p_other_discounts, 0), 'otros descuentos', false);

  select round(coalesce(sum(sc.amount), 0), 2),
         coalesce(sum(sc.amount * (power(1.12::double precision, greatest(0, p_cut_date - sc.effective_date)::double precision / 365.0) - 1)), 0)
  into capital, recognized_yield
  from public.savings_contributions sc
  where sc.cycle_member_id = cm.id
    and sc.effective_date <= p_cut_date;
  recognized_yield_cents := round(recognized_yield, 2);

  select coalesce(jsonb_agg(jsonb_build_object('prize_id', pp.id, 'net_amount', pp.net_amount) order by pp.awarded_at), '[]'::jsonb),
         round(coalesce(sum(pp.net_amount), 0), 2)
  into prize_items, prizes
  from public.polla_prizes pp
  where pp.winner_cycle_member_id = cm.id
    and pp.status = 'pending_payment'
    and pp.awarded_at <= p_cut_date;

  with loan_balances as (
    select lc.id,
           round(lc.principal
             - coalesce((select sum(lp.capital_amount) from public.loan_payments lp where lp.loan_id = lc.id and lp.status = 'posted'), 0)
             - coalesce((select sum(sda.principal_amount) from public.member_settlement_debt_applications sda where sda.loan_id = lc.id), 0), 2) as principal_due,
           case when lc.settlement_agreement_code = 'P013_FIRST_MONTH' then
             greatest(0, round(coalesce(lc.prepayment_first_month_interest, 0)
               - coalesce((select sum(lp.interest_amount) from public.loan_payments lp where lp.loan_id = lc.id and lp.status = 'posted'), 0)
               - coalesce((select sum(sda.interest_amount) from public.member_settlement_debt_applications sda where sda.loan_id = lc.id), 0), 2))
           else 0 end as interest_due
    from public.loan_contracts lc
    where lc.workspace_id = cm.workspace_id
      and lc.cycle_id = cm.cycle_id
      and lc.borrower_member_id = cm.member_id
      and lc.status = 'active'
  )
  select coalesce(jsonb_agg(jsonb_build_object('loan_id', id, 'principal_amount', principal_due, 'interest_amount', interest_due) order by id) filter (where principal_due > 0 or interest_due > 0), '[]'::jsonb),
         round(coalesce(sum(principal_due), 0), 2),
         round(coalesce(sum(interest_due), 0), 2)
  into debt_items, principal_debt, p013_interest
  from loan_balances
  where principal_due > 0 or interest_due > 0;

  debts := round(principal_debt + p013_interest, 2);
  net := round(capital + recognized_yield_cents + prizes - debts - coalesce(p_annual_admin_fee, 0) - coalesce(p_penalty_amount, 0) - coalesce(p_other_discounts, 0), 2);
  transfer := round(net, 0);
  rounding := round(transfer - net, 2);

  snapshot := jsonb_build_object(
    'rule_version', 'C-settlement-2026-10-09',
    'cycle_member_id', cm.id,
    'member_id', cm.member_id,
    'cycle_id', cm.cycle_id,
    'workspace_id', cm.workspace_id,
    'cut_date', p_cut_date,
    'annual_effective_rate', 0.12,
    'capital', capital,
    'recognized_yield_unrounded', recognized_yield,
    'recognized_yield', recognized_yield_cents,
    'pending_net_prizes', prizes,
    'principal_debt', principal_debt,
    'p013_first_month_interest', p013_interest,
    'debts', debts,
    'annual_admin_fee', coalesce(p_annual_admin_fee, 0),
    'penalty', coalesce(p_penalty_amount, 0),
    'other_discounts', coalesce(p_other_discounts, 0),
    'net', net,
    'transfer_amount', transfer,
    'rounding_adjustment', rounding,
    'debt_items', coalesce(debt_items, '[]'::jsonb),
    'prize_items', coalesce(prize_items, '[]'::jsonb),
    'policy_note', 'Penalidad, cuota anual y otros descuentos son parametros de acuerdo/version; destino pendiente queda en settlement_policy_pending.'
  );

  return snapshot || jsonb_build_object('preview_hash', md5(snapshot::text));
end;
$$;

create or replace function public.confirm_member_settlement(
  p_cycle_member_id uuid,
  p_idempotency_key text,
  p_cut_date date,
  p_annual_admin_fee numeric,
  p_penalty_amount numeric,
  p_other_discounts numeric,
  p_preview_hash text
)
returns public.member_settlements
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  cm public.cycle_members%rowtype;
  existing public.member_settlements%rowtype;
  created public.member_settlements%rowtype;
  op public.financial_operations%rowtype;
  preview jsonb;
  preview_hash text;
  entries jsonb;
  debt jsonb;
  prize jsonb;
  net numeric(18,2);
  transfer numeric(18,2);
  rounding numeric(18,2);
  principal_debt numeric(18,2);
  p013_interest numeric(18,2);
  policy_pending numeric(18,2);
  prizes numeric(18,2);
begin
  if actor is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into cm from public.cycle_members where id = p_cycle_member_id for update;
  if cm.id is null then raise exception 'Participacion no encontrada.'; end if;
  if not public.current_user_is_workspace_admin(cm.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if cm.savings_status <> 'active' then raise exception 'La participacion de ahorro no esta activa.'; end if;

  select * into existing from public.member_settlements
  where workspace_id = cm.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.cycle_member_id = cm.id and existing.cut_date = p_cut_date and existing.preview_hash = p_preview_hash then
      return existing;
    end if;
    raise exception 'La clave de idempotencia de liquidacion ya existe con otro contenido.';
  end if;

  preview := public.preview_member_settlement(p_cycle_member_id, p_cut_date, p_annual_admin_fee, p_penalty_amount, p_other_discounts);
  preview_hash := preview->>'preview_hash';
  if preview_hash <> p_preview_hash then
    raise exception 'La previsualizacion esta obsoleta; calcule de nuevo antes de confirmar.';
  end if;

  net := (preview->>'net')::numeric;
  if net < 0 then
    raise exception 'La liquidacion arroja deuda residual; falta politica para confirmar netos negativos.';
  end if;

  transfer := (preview->>'transfer_amount')::numeric;
  rounding := (preview->>'rounding_adjustment')::numeric;
  principal_debt := (preview->>'principal_debt')::numeric;
  p013_interest := (preview->>'p013_first_month_interest')::numeric;
  prizes := (preview->>'pending_net_prizes')::numeric;
  policy_pending := round((preview->>'annual_admin_fee')::numeric + (preview->>'penalty')::numeric + (preview->>'other_discounts')::numeric, 2);

  insert into public.member_settlements (
    workspace_id, cycle_id, cycle_member_id, member_id, idempotency_key, cut_date,
    preview_hash, snapshot, net_amount, transfer_amount, rounding_adjustment, created_by
  ) values (
    cm.workspace_id, cm.cycle_id, cm.id, cm.member_id, trim(p_idempotency_key), p_cut_date,
    preview_hash, preview, net, transfer, rounding, actor
  ) returning * into created;

  entries := jsonb_build_array(
    jsonb_build_object('account', 'savings_liability', 'amount', (preview->>'capital')::numeric, 'member_id', cm.member_id),
    jsonb_build_object('account', 'savings_yield_expense', 'amount', (preview->>'recognized_yield')::numeric, 'member_id', cm.member_id),
    jsonb_build_object('account', 'settlements_payable', 'amount', -net, 'member_id', cm.member_id)
  );
  if prizes > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'prizes_payable', 'amount', prizes, 'member_id', cm.member_id));
  end if;
  if principal_debt > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'loans_receivable', 'amount', -principal_debt, 'member_id', cm.member_id));
  end if;
  if p013_interest > 0 then
    entries := entries || jsonb_build_array(
      jsonb_build_object('account', 'admin_payable', 'amount', -round(p013_interest * 0.10, 2), 'member_id', cm.member_id),
      jsonb_build_object('account', 'member_loan_profit_fund', 'amount', -round(p013_interest - round(p013_interest * 0.10, 2), 2), 'member_id', cm.member_id)
    );
  end if;
  if policy_pending > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'settlement_policy_pending', 'amount', -policy_pending, 'member_id', cm.member_id));
  end if;

  op := public.create_b_operation(
    cm.workspace_id, cm.cycle_id, p_idempotency_key, 'member_settlement_confirmed', p_cut_date,
    'member_settlements', created.id,
    jsonb_build_object('settlement_id', created.id, 'preview_hash', preview_hash, 'net', net, 'transfer', transfer),
    entries
  );

  update public.member_settlements set operation_id = op.id where id = created.id returning * into created;
  update public.cycle_members set savings_status = 'withdrawn', participates_in_savings = false where id = cm.id;

  for debt in select * from jsonb_array_elements(preview->'debt_items') loop
    insert into public.member_settlement_debt_applications (workspace_id, cycle_id, settlement_id, loan_id, principal_amount, interest_amount)
    values (cm.workspace_id, cm.cycle_id, created.id, (debt->>'loan_id')::uuid, (debt->>'principal_amount')::numeric, (debt->>'interest_amount')::numeric);
    update public.loan_contracts lc
    set status = 'paid', cancelled_at = p_cut_date
    where lc.id = (debt->>'loan_id')::uuid
      and round(lc.principal
        - coalesce((select sum(lp.capital_amount) from public.loan_payments lp where lp.loan_id = lc.id and lp.status = 'posted'), 0)
        - coalesce((select sum(sda.principal_amount) from public.member_settlement_debt_applications sda where sda.loan_id = lc.id), 0), 2) = 0;
  end loop;

  for prize in select * from jsonb_array_elements(preview->'prize_items') loop
    insert into public.member_settlement_prize_applications (workspace_id, cycle_id, settlement_id, prize_id, amount)
    values (cm.workspace_id, cm.cycle_id, created.id, (prize->>'prize_id')::uuid, (prize->>'net_amount')::numeric);
    update public.polla_prizes set status = 'settled' where id = (prize->>'prize_id')::uuid;
  end loop;

  insert into public.audit_events (workspace_id, actor_user_id, event_type, entity_table, entity_id, payload)
  values (cm.workspace_id, actor, 'member_settlement.confirmed', 'member_settlements', created.id, preview);

  return created;
end;
$$;

create or replace function public.pay_member_settlement(
  p_settlement_id uuid,
  p_idempotency_key text,
  p_paid_date date,
  p_liquidity_location text,
  p_bank_account_id uuid,
  p_reference text
)
returns public.member_settlement_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  settlement public.member_settlements%rowtype;
  existing public.member_settlement_payments%rowtype;
  op public.financial_operations%rowtype;
  created public.member_settlement_payments%rowtype;
  entries jsonb;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into settlement from public.member_settlements where id = p_settlement_id for update;
  if settlement.id is null then raise exception 'Liquidacion no encontrada.'; end if;
  if not public.current_user_is_workspace_admin(settlement.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;

  select * into existing from public.member_settlement_payments
  where workspace_id = settlement.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.settlement_id = settlement.id and existing.amount = settlement.transfer_amount and existing.paid_date = p_paid_date then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del pago de liquidacion ya existe con otro contenido.';
  end if;

  if settlement.status <> 'confirmed' then raise exception 'La liquidacion no esta pendiente de pago.'; end if;
  if settlement.transfer_amount <= 0 then raise exception 'La liquidacion no tiene transferencia positiva.'; end if;
  if length(trim(coalesce(p_reference, ''))) = 0 then raise exception 'El pago requiere referencia.'; end if;
  if public.cash_available_at(settlement.cycle_id, p_paid_date, p_liquidity_location, p_bank_account_id) < settlement.transfer_amount then
    raise exception 'Liquidez insuficiente para pagar la liquidacion.';
  end if;

  entries := jsonb_build_array(
    jsonb_build_object('account', 'settlements_payable', 'amount', settlement.net_amount, 'member_id', settlement.member_id),
    jsonb_build_object('account', 'cash', 'amount', -settlement.transfer_amount, 'member_id', settlement.member_id, 'liquidity_location', p_liquidity_location, 'bank_account_id', p_bank_account_id)
  );
  if settlement.rounding_adjustment > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'common_expense', 'amount', settlement.rounding_adjustment, 'member_id', settlement.member_id));
  elsif settlement.rounding_adjustment < 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'common_income', 'amount', settlement.rounding_adjustment, 'member_id', settlement.member_id));
  end if;

  op := public.create_b_operation(
    settlement.workspace_id, settlement.cycle_id, p_idempotency_key, 'member_settlement_paid', p_paid_date,
    'member_settlements', settlement.id,
    jsonb_build_object('settlement_id', settlement.id, 'amount', settlement.transfer_amount, 'reference', trim(p_reference)),
    entries
  );

  insert into public.member_settlement_payments (
    workspace_id, cycle_id, settlement_id, operation_id, idempotency_key, paid_date,
    amount, liquidity_location, bank_account_id, reference
  ) values (
    settlement.workspace_id, settlement.cycle_id, settlement.id, op.id, trim(p_idempotency_key), p_paid_date,
    settlement.transfer_amount, p_liquidity_location, p_bank_account_id, trim(p_reference)
  ) returning * into created;

  update public.member_settlements set status = 'paid', paid_operation_id = op.id, paid_at = p_paid_date where id = settlement.id;
  return created;
end;
$$;

create or replace function public.preview_loan_profit_distribution(
  p_cycle_id uuid,
  p_cut_date date,
  p_policy_version text,
  p_costs_amount numeric,
  p_committed_yield_amount numeric,
  p_reserve_amount numeric
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  fund numeric(18,2);
  costs numeric(18,2);
  committed_yield numeric(18,2);
  reserve numeric(18,2);
  distributable numeric(18,2);
  eligible_count integer;
  per_member numeric(18,2);
  residual numeric(18,2);
  liquidity numeric(18,2);
  members jsonb;
  snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(coalesce(p_costs_amount, 0), 'costos de utilidad', false);
  perform public.assert_money_2(coalesce(p_committed_yield_amount, 0), 'rendimiento comprometido', false);
  perform public.assert_money_2(coalesce(p_reserve_amount, 0), 'reserva', false);

  select round(0 - coalesce(sum(le.amount), 0), 2) into fund
  from public.ledger_entries le
  join public.financial_operations fo on fo.id = le.operation_id
  where le.cycle_id = p_cycle_id
    and le.account = 'member_loan_profit_fund'
    and fo.effective_date <= p_cut_date;

  costs := coalesce(p_costs_amount, 0);
  committed_yield := coalesce(p_committed_yield_amount, 0);
  reserve := coalesce(p_reserve_amount, 0);
  distributable := greatest(0, round(coalesce(fund, 0) - costs - committed_yield - reserve, 2));

  select count(*) into eligible_count
  from public.cycle_members cm
  where cm.cycle_id = p_cycle_id and cm.participates_in_loan_profit = true;

  if eligible_count > 0 then
    per_member := round(distributable / eligible_count, 2);
    residual := round(distributable - per_member * eligible_count, 2);
  else
    per_member := 0;
    residual := distributable;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cycle_member_id', cm.id,
    'member_id', cm.member_id,
    'display_name', m.display_name,
    'eligible', cm.participates_in_loan_profit,
    'amount', case when cm.participates_in_loan_profit then per_member else 0 end
  ) order by m.display_name), '[]'::jsonb)
  into members
  from public.cycle_members cm
  join public.members m on m.id = cm.member_id
  where cm.cycle_id = p_cycle_id;

  select round(coalesce(sum(le.amount), 0), 2) into liquidity
  from public.ledger_entries le
  join public.financial_operations fo on fo.id = le.operation_id
  where le.cycle_id = p_cycle_id and le.account = 'cash' and fo.effective_date <= p_cut_date;

  snapshot := jsonb_build_object(
    'rule_version', 'C-loan-profit-test-policy-2026-10-09',
    'policy_version', p_policy_version,
    'cycle_id', p_cycle_id,
    'cut_date', p_cut_date,
    'recognized_fund', coalesce(fund, 0),
    'costs', costs,
    'committed_yield', committed_yield,
    'reserve', reserve,
    'distributable', distributable,
    'eligible_count', eligible_count,
    'per_member', per_member,
    'rounding_residual', residual,
    'liquidity_available', coalesce(liquidity, 0),
    'liquidity_deficit', greatest(0, round(distributable - coalesce(liquidity, 0), 2)),
    'members', members,
    'confirmation_allowed', eligible_count > 0 and distributable > 0 and length(trim(coalesce(p_policy_version, ''))) > 0
  );

  return snapshot || jsonb_build_object('preview_hash', md5(snapshot::text));
end;
$$;

create or replace function public.confirm_loan_profit_distribution(
  p_cycle_id uuid,
  p_idempotency_key text,
  p_cut_date date,
  p_policy_version text,
  p_costs_amount numeric,
  p_committed_yield_amount numeric,
  p_reserve_amount numeric,
  p_preview_hash text
)
returns public.loan_profit_distributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  target_cycle public.cycles%rowtype;
  existing public.loan_profit_distributions%rowtype;
  created public.loan_profit_distributions%rowtype;
  preview jsonb;
  op public.financial_operations%rowtype;
  distributable numeric(18,2);
  entries jsonb;
begin
  if actor is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id for update;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;

  select * into existing from public.loan_profit_distributions
  where workspace_id = target_cycle.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.cut_date = p_cut_date and existing.policy_version = p_policy_version and existing.preview_hash = p_preview_hash then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del reparto ya existe con otro contenido.';
  end if;

  preview := public.preview_loan_profit_distribution(p_cycle_id, p_cut_date, p_policy_version, p_costs_amount, p_committed_yield_amount, p_reserve_amount);
  if preview->>'preview_hash' <> p_preview_hash then
    raise exception 'La previsualizacion de utilidad esta obsoleta.';
  end if;
  if not (preview->>'confirmation_allowed')::boolean then
    raise exception 'La politica no autoriza confirmar este reparto.';
  end if;
  distributable := (preview->>'distributable')::numeric;

  insert into public.loan_profit_distributions (
    workspace_id, cycle_id, idempotency_key, cut_date, preview_hash, policy_version,
    snapshot, distributable_amount, payment_amount, created_by
  ) values (
    target_cycle.workspace_id, target_cycle.id, trim(p_idempotency_key), p_cut_date, p_preview_hash, p_policy_version,
    preview, distributable, distributable, actor
  ) returning * into created;

  entries := jsonb_build_array(
    jsonb_build_object('account', 'member_loan_profit_fund', 'amount', distributable + (preview->>'costs')::numeric + (preview->>'committed_yield')::numeric + (preview->>'reserve')::numeric),
    jsonb_build_object('account', 'utility_distribution_payable', 'amount', -distributable)
  );
  if (preview->>'costs')::numeric > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'settlement_policy_pending', 'amount', -(preview->>'costs')::numeric));
  end if;
  if (preview->>'committed_yield')::numeric > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'savings_liability', 'amount', -(preview->>'committed_yield')::numeric));
  end if;
  if (preview->>'reserve')::numeric > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'liquidity_reserve', 'amount', -(preview->>'reserve')::numeric));
  end if;

  op := public.create_b_operation(
    target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'loan_profit_distribution_confirmed', p_cut_date,
    'loan_profit_distributions', created.id,
    jsonb_build_object('distribution_id', created.id, 'preview_hash', p_preview_hash, 'distributable', distributable, 'policy_version', p_policy_version),
    entries
  );

  update public.loan_profit_distributions set operation_id = op.id where id = created.id returning * into created;
  return created;
end;
$$;

create or replace function public.pay_loan_profit_distribution(
  p_distribution_id uuid,
  p_idempotency_key text,
  p_paid_date date,
  p_liquidity_location text,
  p_bank_account_id uuid,
  p_reference text
)
returns public.loan_profit_distribution_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  distribution public.loan_profit_distributions%rowtype;
  existing public.loan_profit_distribution_payments%rowtype;
  op public.financial_operations%rowtype;
  created public.loan_profit_distribution_payments%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into distribution from public.loan_profit_distributions where id = p_distribution_id for update;
  if distribution.id is null then raise exception 'Reparto no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(distribution.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if distribution.status <> 'confirmed' then raise exception 'El reparto no esta pendiente de pago.'; end if;
  if public.cash_available_at(distribution.cycle_id, p_paid_date, p_liquidity_location, p_bank_account_id) < distribution.payment_amount then
    raise exception 'Liquidez insuficiente para pagar el reparto.';
  end if;

  select * into existing from public.loan_profit_distribution_payments
  where workspace_id = distribution.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.distribution_id = distribution.id and existing.amount = distribution.payment_amount and existing.paid_date = p_paid_date then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del pago de reparto ya existe con otro contenido.';
  end if;

  op := public.create_b_operation(
    distribution.workspace_id, distribution.cycle_id, p_idempotency_key, 'loan_profit_distribution_paid', p_paid_date,
    'loan_profit_distributions', distribution.id,
    jsonb_build_object('distribution_id', distribution.id, 'amount', distribution.payment_amount, 'reference', trim(p_reference)),
    jsonb_build_array(
      jsonb_build_object('account', 'utility_distribution_payable', 'amount', distribution.payment_amount),
      jsonb_build_object('account', 'cash', 'amount', -distribution.payment_amount, 'liquidity_location', p_liquidity_location, 'bank_account_id', p_bank_account_id)
    )
  );

  insert into public.loan_profit_distribution_payments (
    workspace_id, cycle_id, distribution_id, operation_id, idempotency_key, paid_date,
    amount, liquidity_location, bank_account_id, reference
  ) values (
    distribution.workspace_id, distribution.cycle_id, distribution.id, op.id, trim(p_idempotency_key), p_paid_date,
    distribution.payment_amount, p_liquidity_location, p_bank_account_id, trim(p_reference)
  ) returning * into created;

  update public.loan_profit_distributions set status = 'paid', paid_operation_id = op.id where id = distribution.id;
  return created;
end;
$$;

create or replace function public.reverse_financial_operation(
  p_operation_id uuid,
  p_idempotency_key text,
  p_effective_date date,
  p_reason text
)
returns public.financial_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  original public.financial_operations%rowtype;
  existing public.financial_operations%rowtype;
  reversal public.financial_operations%rowtype;
  entries jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into original from public.financial_operations where id = p_operation_id for update;
  if original.id is null then raise exception 'Operacion original no encontrada.'; end if;
  if not public.current_user_is_workspace_admin(original.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;

  select * into existing
  from public.financial_operations
  where workspace_id = original.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.operation_type = 'reversal'
      and existing.reverses_operation_id = original.id
      and existing.effective_date = p_effective_date
      and existing.payload = jsonb_build_object('reverses_operation_id', original.id, 'reason', trim(coalesce(p_reason, ''))) then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del reverso ya existe con otro contenido.';
  end if;

  if original.operation_type = 'reversal' then raise exception 'No se reversa un reverso.'; end if;
  if exists (select 1 from public.financial_operations where reverses_operation_id = original.id) then
    raise exception 'La operacion ya tiene reverso.';
  end if;
  if original.operation_type in ('member_settlement_confirmed', 'loan_profit_distribution_confirmed') then
    raise exception 'Los reversos de liquidaciones y repartos con dependencias requieren flujo dedicado.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'account', le.account,
    'amount', -le.amount,
    'member_id', le.member_id,
    'loan_id', le.loan_id,
    'polla_activity_id', le.polla_activity_id,
    'prize_id', le.prize_id,
    'liquidity_location', le.liquidity_location,
    'bank_account_id', le.bank_account_id
  )) into entries
  from public.ledger_entries le
  where le.operation_id = original.id;

  reversal := public.create_b_operation(
    original.workspace_id, original.cycle_id, p_idempotency_key, 'reversal', p_effective_date,
    'financial_operations', original.id,
    jsonb_build_object('reverses_operation_id', original.id, 'reason', trim(coalesce(p_reason, ''))),
    coalesce(entries, '[]'::jsonb)
  );

  update public.financial_operations
  set reverses_operation_id = original.id
  where id = reversal.id;

  if original.operation_type in ('loan_payment', 'loan_prepayment') then
    update public.loan_payments set status = 'reversed' where operation_id = original.id;
    update public.loan_contracts lc
    set status = 'active', cancelled_at = null
    where lc.id = original.reference_id and lc.status = 'paid';
  elsif original.operation_type = 'polla_contribution' then
    update public.polla_contributions set status = 'reversed' where operation_id = original.id;
  elsif original.operation_type = 'polla_prize_paid' then
    update public.polla_prize_payments set status = 'reversed' where operation_id = original.id;
    update public.polla_prizes pp set status = 'pending_payment', paid_operation_id = null where pp.paid_operation_id = original.id;
  elsif original.operation_type = 'polla_prize_awarded' then
    update public.polla_prizes set status = 'reversed' where award_operation_id = original.id;
  elsif original.operation_type = 'loan_disbursement' then
    update public.loan_contracts set status = 'draft', disbursed_operation_id = null where disbursed_operation_id = original.id;
  end if;

  return reversal;
end;
$$;

grant execute on function public.cash_available_at(uuid, date, text, uuid) to authenticated;
grant execute on function public.create_bank_account(uuid, text, text, text) to authenticated;
grant execute on function public.record_bank_opening(uuid, uuid, text, date, numeric, text) to authenticated;
grant execute on function public.record_bank_interest_received(uuid, uuid, text, date, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.record_bank_fee(uuid, uuid, text, date, numeric, text) to authenticated;
grant execute on function public.record_internal_liquidity_transfer(uuid, text, date, text, uuid, text, uuid, numeric, text) to authenticated;
grant execute on function public.create_bank_reconciliation(uuid, uuid, numeric, date, numeric, date, text) to authenticated;
grant execute on function public.set_loan_settlement_agreement(uuid, text) to authenticated;
grant execute on function public.preview_member_settlement(uuid, date, numeric, numeric, numeric) to authenticated;
grant execute on function public.confirm_member_settlement(uuid, text, date, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.pay_member_settlement(uuid, text, date, text, uuid, text) to authenticated;
grant execute on function public.preview_loan_profit_distribution(uuid, date, text, numeric, numeric, numeric) to authenticated;
grant execute on function public.confirm_loan_profit_distribution(uuid, text, date, text, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.pay_loan_profit_distribution(uuid, text, date, text, uuid, text) to authenticated;

revoke execute on function public.create_b_operation(uuid, uuid, text, text, date, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.assert_b_ledger_balanced(jsonb) from public, anon, authenticated;
revoke execute on function public.assert_money_2(numeric, text, boolean) from public, anon, authenticated;
