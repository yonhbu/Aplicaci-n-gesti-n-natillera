alter table public.savings_contributions
  add column if not exists status text not null default 'posted' check (status in ('posted', 'reversed'));

alter table public.member_settlement_payments
  add column if not exists status text not null default 'posted' check (status in ('posted', 'reversed'));

alter table public.loan_profit_distribution_payments
  add column if not exists status text not null default 'posted' check (status in ('posted', 'reversed'));

alter table public.loan_profit_distribution_payments
  drop constraint if exists loan_profit_distribution_payments_workspace_id_id_key;

alter table public.loan_profit_distribution_payments
  add constraint loan_profit_distribution_payments_workspace_id_id_key unique (workspace_id, id);

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
    'bank_external_financing',
    'bank_interest_received',
    'bank_fee',
    'liquidity_transfer',
    'member_settlement_confirmed',
    'member_settlement_paid',
    'loan_profit_distribution_confirmed',
    'loan_profit_distribution_paid',
    'reversal'
  ));

create table if not exists public.loan_profit_distribution_policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  policy_version text not null check (length(trim(policy_version)) >= 3),
  description text not null check (length(trim(description)) > 0),
  approved boolean not null default true,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (workspace_id, cycle_id, policy_version),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id)
);

create table if not exists public.loan_profit_distribution_allocations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  distribution_id uuid not null,
  cycle_member_id uuid not null,
  member_id uuid not null,
  amount numeric(18,2) not null check (amount >= 0 and amount = round(amount, 2)),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'paid', 'reversed')),
  payment_id uuid,
  paid_at date,
  payment_reference text,
  created_at timestamptz not null default now(),
  unique (distribution_id, cycle_member_id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, distribution_id) references public.loan_profit_distributions(workspace_id, id),
  foreign key (workspace_id, cycle_member_id) references public.cycle_members(workspace_id, id),
  foreign key (workspace_id, member_id) references public.members(workspace_id, id)
);

alter table public.loan_profit_distribution_allocations
  drop constraint if exists loan_profit_distribution_allocations_payment_fk;

alter table public.loan_profit_distribution_allocations
  add constraint loan_profit_distribution_allocations_payment_fk
  foreign key (workspace_id, payment_id)
  references public.loan_profit_distribution_payments(workspace_id, id);

alter table public.loan_profit_distribution_policies enable row level security;
alter table public.loan_profit_distribution_allocations enable row level security;

drop policy if exists "workspace admins read loan profit policies" on public.loan_profit_distribution_policies;
create policy "workspace admins read loan profit policies" on public.loan_profit_distribution_policies
  for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

drop policy if exists "workspace admins read loan profit allocations" on public.loan_profit_distribution_allocations;
create policy "workspace admins read loan profit allocations" on public.loan_profit_distribution_allocations
  for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

grant select on public.loan_profit_distribution_policies, public.loan_profit_distribution_allocations to authenticated;
revoke insert, update, delete on public.loan_profit_distribution_policies, public.loan_profit_distribution_allocations from anon, authenticated;

create or replace function public.create_loan_profit_distribution_policy(
  p_cycle_id uuid,
  p_policy_version text,
  p_description text
)
returns public.loan_profit_distribution_policies
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  created public.loan_profit_distribution_policies%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if length(trim(coalesce(p_policy_version, ''))) < 3 then raise exception 'La politica de reparto es invalida.'; end if;
  if length(trim(coalesce(p_description, ''))) = 0 then raise exception 'La politica requiere descripcion.'; end if;

  insert into public.loan_profit_distribution_policies (
    workspace_id, cycle_id, policy_version, description, created_by
  ) values (
    target_cycle.workspace_id, target_cycle.id, trim(p_policy_version), trim(p_description), auth.uid()
  )
  on conflict (workspace_id, cycle_id, policy_version) do update
  set description = excluded.description,
      approved = true
  returning * into created;

  return created;
end;
$$;

create or replace function public.record_bank_external_financing(
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
  perform public.assert_money_2(p_amount, 'financiacion bancaria externa', true);
  if not exists (select 1 from public.bank_accounts where workspace_id = target_cycle.workspace_id and id = p_bank_account_id and status = 'active') then
    raise exception 'Cuenta bancaria no encontrada.';
  end if;

  return public.create_b_operation(
    target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'bank_external_financing', p_effective_date,
    'bank_accounts', p_bank_account_id,
    jsonb_build_object('bank_account_id', p_bank_account_id, 'amount', p_amount, 'reference', coalesce(p_reference, ''), 'source', 'external_financing_fixture_or_documented_source'),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'amount', p_amount, 'liquidity_location', 'bank', 'bank_account_id', p_bank_account_id),
      jsonb_build_object('account', 'settlement_policy_pending', 'amount', -p_amount)
    )
  );
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
  existing public.financial_operations%rowtype;
begin
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_amount, 'saldo inicial verificado', true);
  if not exists (select 1 from public.bank_accounts where workspace_id = target_cycle.workspace_id and id = p_bank_account_id and status = 'active') then
    raise exception 'Cuenta bancaria no encontrada.';
  end if;

  select * into existing
  from public.financial_operations
  where workspace_id = target_cycle.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    return public.create_b_operation(
      target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'bank_opening', p_effective_date,
      'bank_accounts', p_bank_account_id,
      jsonb_build_object('bank_account_id', p_bank_account_id, 'amount', p_amount, 'reference', coalesce(p_reference, ''), 'source', 'verified_opening_fixture_or_statement'),
      jsonb_build_array(
        jsonb_build_object('account', 'cash', 'amount', p_amount, 'liquidity_location', 'bank', 'bank_account_id', p_bank_account_id),
        jsonb_build_object('account', 'bank_opening_equity', 'amount', -p_amount)
      )
    );
  end if;

  if exists (
    select 1
    from public.financial_operations fo
    where fo.workspace_id = target_cycle.workspace_id
      and fo.cycle_id = target_cycle.id
      and fo.operation_type = 'bank_opening'
      and fo.reference_id = p_bank_account_id
  ) then
    raise exception 'La apertura bancaria ya fue registrada para esta cuenta y ciclo; use financiacion externa documentada para entradas posteriores.';
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
  existing public.financial_operations%rowtype;
begin
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_amount, 'comision bancaria', true);

  select * into existing
  from public.financial_operations
  where workspace_id = target_cycle.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    return public.create_b_operation(
      target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'bank_fee', p_effective_date,
      'bank_accounts', p_bank_account_id,
      jsonb_build_object('bank_account_id', p_bank_account_id, 'amount', p_amount, 'reference', coalesce(p_reference, '')),
      jsonb_build_array(
        jsonb_build_object('account', 'bank_fee_expense', 'amount', p_amount),
        jsonb_build_object('account', 'cash', 'amount', -p_amount, 'liquidity_location', 'bank', 'bank_account_id', p_bank_account_id)
      )
    );
  end if;

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
  existing public.financial_operations%rowtype;
begin
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_amount, 'traslado interno', true);
  if p_from_location not in ('bank', 'cash') or p_to_location not in ('bank', 'cash') then raise exception 'Ubicacion de traslado invalida.'; end if;
  if p_from_location = p_to_location and p_from_bank_account_id is not distinct from p_to_bank_account_id then raise exception 'El traslado requiere ubicaciones distintas.'; end if;

  select * into existing
  from public.financial_operations
  where workspace_id = target_cycle.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    return public.create_b_operation(
      target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'liquidity_transfer', p_effective_date,
      'liquidity_locations', null,
      jsonb_build_object('from_location', p_from_location, 'from_bank_account_id', p_from_bank_account_id, 'to_location', p_to_location, 'to_bank_account_id', p_to_bank_account_id, 'amount', p_amount, 'reference', coalesce(p_reference, '')),
      jsonb_build_array(
        jsonb_build_object('account', 'cash', 'amount', -p_amount, 'liquidity_location', p_from_location, 'bank_account_id', p_from_bank_account_id),
        jsonb_build_object('account', 'cash', 'amount', p_amount, 'liquidity_location', p_to_location, 'bank_account_id', p_to_bank_account_id)
      )
    );
  end if;

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
  select * into loan from public.loan_contracts where id = p_loan_id for update;
  if loan.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(loan.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_disbursed_date is null or p_disbursed_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de desembolso invalida.'; end if;

  if loan.status <> 'draft' or loan.disbursed_operation_id is not null then
    if loan.disbursed_operation_id is null then raise exception 'El prestamo no esta disponible para desembolso.'; end if;
    select * into op from public.financial_operations where id = loan.disbursed_operation_id;
    if op.idempotency_key = trim(p_idempotency_key)
      and op.effective_date = p_disbursed_date
      and op.payload = jsonb_build_object('loan_id', loan.id, 'principal', loan.principal, 'liquidity_location', 'cash') then
      return loan;
    end if;
    raise exception 'El prestamo ya fue desembolsado con otra operacion.';
  end if;

  op := public.create_b_operation(
    loan.workspace_id, loan.cycle_id, p_idempotency_key, 'loan_disbursement', p_disbursed_date,
    'loan_contracts', loan.id,
    jsonb_build_object('loan_id', loan.id, 'principal', loan.principal, 'liquidity_location', 'cash'),
    jsonb_build_array(
      jsonb_build_object('account', 'loans_receivable', 'amount', loan.principal, 'loan_id', loan.id),
      jsonb_build_object('account', 'cash', 'amount', -loan.principal, 'loan_id', loan.id, 'liquidity_location', 'cash')
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
  select * into loan from public.loan_contracts where id = p_loan_id for update;
  if loan.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(loan.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;

  select * into existing from public.loan_payments
  where workspace_id = loan.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.loan_id = loan.id
      and existing.payment_date = p_payment_date
      and existing.amount = p_amount
      and existing.capital_amount = p_capital_amount
      and existing.interest_amount = p_interest_amount
      and existing.kind = coalesce(p_kind, 'regular') then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del cobro ya existe con otro contenido.';
  end if;

  if loan.status <> 'active' then raise exception 'Solo se cobran prestamos activos desembolsados.'; end if;
  if coalesce(p_kind, 'regular') not in ('regular', 'prepayment') then raise exception 'Tipo de cobro invalido.'; end if;
  if p_amount <> p_capital_amount + p_interest_amount then raise exception 'El pago debe coincidir con capital mas interes.'; end if;
  perform public.assert_money_2(p_amount, 'pago', true);
  perform public.assert_money_2(p_capital_amount, 'capital', false);
  perform public.assert_money_2(p_interest_amount, 'interes', false);
  if p_payment_date is null or p_payment_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de cobro invalida.'; end if;

  select round(loan.principal - coalesce(sum(lp.capital_amount) filter (where lp.status = 'posted'), 0), 2)
  into outstanding
  from public.loan_payments lp
  where lp.loan_id = loan.id;

  if p_capital_amount > outstanding then
    raise exception 'El capital cobrado supera el saldo pendiente.';
  end if;

  admin := round(p_interest_amount * 0.10, 2);
  fund := round(p_interest_amount - admin, 2);
  op := public.create_b_operation(
    loan.workspace_id, loan.cycle_id, p_idempotency_key, case when p_kind = 'prepayment' then 'loan_prepayment' else 'loan_payment' end, p_payment_date,
    'loan_contracts', loan.id,
    jsonb_build_object('loan_id', loan.id, 'amount', p_amount, 'capital', p_capital_amount, 'interest', p_interest_amount, 'kind', coalesce(p_kind, 'regular'), 'admin', admin, 'member_fund', fund, 'liquidity_location', 'cash'),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'amount', p_amount, 'loan_id', loan.id, 'liquidity_location', 'cash'),
      jsonb_build_object('account', 'loans_receivable', 'amount', -p_capital_amount, 'loan_id', loan.id),
      jsonb_build_object('account', 'admin_payable', 'amount', -admin, 'loan_id', loan.id),
      jsonb_build_object('account', 'member_loan_profit_fund', 'amount', -fund, 'loan_id', loan.id)
    )
  );

  insert into public.loan_payments (
    workspace_id, cycle_id, loan_id, operation_id, idempotency_key, payment_date, amount, capital_amount, interest_amount, kind
  ) values (
    loan.workspace_id, loan.cycle_id, loan.id, op.id, trim(p_idempotency_key), p_payment_date, p_amount, p_capital_amount, p_interest_amount, coalesce(p_kind, 'regular')
  ) returning * into created;

  if round(outstanding - p_capital_amount, 2) = 0 then
    update public.loan_contracts set status = 'paid', cancelled_at = p_payment_date where id = loan.id;
    update public.loan_schedules set status = 'cancelled' where loan_id = loan.id and status = 'projected';
  end if;

  return created;
end;
$$;

create or replace function public.record_manual_cash_movement(
  p_cycle_id uuid,
  p_idempotency_key text,
  p_effective_date date,
  p_amount numeric,
  p_kind text,
  p_description text
)
returns public.financial_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  op_type text;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_amount, 'movimiento manual', true);
  if p_kind not in ('income', 'expense') then raise exception 'Tipo de movimiento manual invalido.'; end if;
  op_type := case when p_kind = 'income' then 'manual_income' else 'manual_expense' end;

  return public.create_b_operation(
    target_cycle.workspace_id, target_cycle.id, p_idempotency_key, op_type, p_effective_date,
    'manual_cash_movements', null,
    jsonb_build_object('amount', p_amount, 'kind', p_kind, 'description', coalesce(p_description, ''), 'liquidity_location', 'cash'),
    case when p_kind = 'income' then
      jsonb_build_array(
        jsonb_build_object('account', 'cash', 'amount', p_amount, 'liquidity_location', 'cash'),
        jsonb_build_object('account', 'common_income', 'amount', -p_amount)
      )
    else
      jsonb_build_array(
        jsonb_build_object('account', 'common_expense', 'amount', p_amount),
        jsonb_build_object('account', 'cash', 'amount', -p_amount, 'liquidity_location', 'cash')
      )
    end
  );
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
  savings_sources jsonb;
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
         coalesce(sum(sc.amount * (power(1.12::double precision, greatest(0, p_cut_date - sc.effective_date)::double precision / 365.0) - 1)), 0),
         coalesce(jsonb_agg(jsonb_build_object('contribution_id', sc.id, 'amount', sc.amount, 'effective_date', sc.effective_date, 'applied_year', sc.applied_year, 'applied_month', sc.applied_month) order by sc.effective_date, sc.id), '[]'::jsonb)
  into capital, recognized_yield, savings_sources
  from public.savings_contributions sc
  where sc.cycle_member_id = cm.id
    and sc.status = 'posted'
    and sc.effective_date <= p_cut_date;
  recognized_yield_cents := round(recognized_yield, 2);

  select coalesce(jsonb_agg(jsonb_build_object('prize_id', pp.id, 'net_amount', pp.net_amount, 'awarded_at', pp.awarded_at) order by pp.awarded_at, pp.id), '[]'::jsonb),
         round(coalesce(sum(pp.net_amount), 0), 2)
  into prize_items, prizes
  from public.polla_prizes pp
  where pp.winner_cycle_member_id = cm.id
    and pp.status = 'pending_payment'
    and pp.awarded_at <= p_cut_date;

  with loan_balances as (
    select lc.id,
           round(lc.principal
             - coalesce((
                 select sum(lp.capital_amount)
                 from public.loan_payments lp
                 join public.financial_operations pay_op on pay_op.id = lp.operation_id
                 left join public.financial_operations rev_op on rev_op.reverses_operation_id = pay_op.id and rev_op.effective_date <= p_cut_date
                 where lp.loan_id = lc.id
                   and pay_op.effective_date <= p_cut_date
                   and rev_op.id is null
               ), 0)
             - coalesce((
                 select sum(sda.principal_amount)
                 from public.member_settlement_debt_applications sda
                 join public.member_settlements ms on ms.id = sda.settlement_id
                 where sda.loan_id = lc.id
                   and ms.cut_date <= p_cut_date
                   and ms.status <> 'reversed'
               ), 0), 2) as principal_due,
           case when lc.settlement_agreement_code = 'P013_FIRST_MONTH' then
             greatest(0, round(coalesce(lc.prepayment_first_month_interest, 0)
               - coalesce((
                   select sum(lp.interest_amount)
                   from public.loan_payments lp
                   join public.financial_operations pay_op on pay_op.id = lp.operation_id
                   left join public.financial_operations rev_op on rev_op.reverses_operation_id = pay_op.id and rev_op.effective_date <= p_cut_date
                   where lp.loan_id = lc.id
                     and pay_op.effective_date <= p_cut_date
                     and rev_op.id is null
                 ), 0)
               - coalesce((
                   select sum(sda.interest_amount)
                   from public.member_settlement_debt_applications sda
                   join public.member_settlements ms on ms.id = sda.settlement_id
                   where sda.loan_id = lc.id
                     and ms.cut_date <= p_cut_date
                     and ms.status <> 'reversed'
                 ), 0), 2))
           else 0 end as interest_due
    from public.loan_contracts lc
    join public.financial_operations disb_op on disb_op.id = lc.disbursed_operation_id
    left join public.financial_operations disb_rev on disb_rev.reverses_operation_id = disb_op.id and disb_rev.effective_date <= p_cut_date
    where lc.workspace_id = cm.workspace_id
      and lc.cycle_id = cm.cycle_id
      and lc.borrower_member_id = cm.member_id
      and disb_op.effective_date <= p_cut_date
      and disb_rev.id is null
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
    'rule_version', 'C-settlement-2026-10-09.abc-corrections',
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
    'savings_sources', coalesce(savings_sources, '[]'::jsonb),
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
  if length(trim(coalesce(p_idempotency_key, ''))) < 8 then raise exception 'Clave de idempotencia de liquidacion invalida.'; end if;
  if length(trim(coalesce(p_preview_hash, ''))) = 0 then raise exception 'La previsualizacion es obligatoria antes de confirmar.'; end if;

  select * into existing from public.member_settlements
  where workspace_id = cm.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.cycle_member_id = cm.id and existing.cut_date = p_cut_date and existing.preview_hash is not distinct from trim(p_preview_hash) then
      return existing;
    end if;
    raise exception 'La clave de idempotencia de liquidacion ya existe con otro contenido.';
  end if;

  if cm.savings_status <> 'active' then raise exception 'La participacion de ahorro no esta activa.'; end if;

  if exists (
    select 1
    from public.loan_contracts lc
    join public.loan_payments lp on lp.loan_id = lc.id and lp.status = 'posted' and lp.payment_date > p_cut_date
    where lc.workspace_id = cm.workspace_id
      and lc.cycle_id = cm.cycle_id
      and lc.borrower_member_id = cm.member_id
  ) then
    raise exception 'La liquidacion retroactiva tiene cobros posteriores; genere politica explicita antes de confirmar.';
  end if;

  preview := public.preview_member_settlement(p_cycle_member_id, p_cut_date, p_annual_admin_fee, p_penalty_amount, p_other_discounts);
  preview_hash := preview->>'preview_hash';
  if preview_hash is distinct from trim(p_preview_hash) then
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
    if existing.settlement_id = settlement.id
      and existing.amount = settlement.transfer_amount
      and existing.paid_date = p_paid_date
      and existing.liquidity_location = p_liquidity_location
      and existing.bank_account_id is not distinct from p_bank_account_id
      and existing.reference = trim(coalesce(p_reference, '')) then
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
    jsonb_build_object('settlement_id', settlement.id, 'amount', settlement.transfer_amount, 'location', p_liquidity_location, 'bank_account_id', p_bank_account_id, 'reference', trim(p_reference)),
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
  policy_approved boolean;
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
  left join public.financial_operations rev_op on rev_op.reverses_operation_id = fo.id and rev_op.effective_date <= p_cut_date
  where le.cycle_id = p_cycle_id
    and le.account = 'member_loan_profit_fund'
    and fo.effective_date <= p_cut_date
    and rev_op.id is null;

  costs := coalesce(p_costs_amount, 0);
  committed_yield := coalesce(p_committed_yield_amount, 0);
  reserve := coalesce(p_reserve_amount, 0);
  distributable := greatest(0, round(coalesce(fund, 0) - costs - committed_yield - reserve, 2));

  select count(*) into eligible_count
  from public.cycle_members cm
  where cm.cycle_id = p_cycle_id and cm.participates_in_loan_profit = true;

  if eligible_count > 0 then
    per_member := floor((distributable * 100) / eligible_count) / 100;
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
  ) order by m.display_name, cm.id), '[]'::jsonb)
  into members
  from public.cycle_members cm
  join public.members m on m.id = cm.member_id
  where cm.cycle_id = p_cycle_id;

  select round(coalesce(sum(le.amount), 0), 2) into liquidity
  from public.ledger_entries le
  join public.financial_operations fo on fo.id = le.operation_id
  where le.cycle_id = p_cycle_id
    and le.account = 'cash'
    and le.liquidity_location in ('bank', 'cash')
    and fo.effective_date <= p_cut_date;

  select exists (
    select 1
    from public.loan_profit_distribution_policies p
    where p.workspace_id = target_cycle.workspace_id
      and p.cycle_id = target_cycle.id
      and p.policy_version = trim(coalesce(p_policy_version, ''))
      and p.approved
  ) into policy_approved;

  snapshot := jsonb_build_object(
    'rule_version', 'C-loan-profit-policy-2026-10-09.abc-corrections',
    'policy_version', trim(coalesce(p_policy_version, '')),
    'cycle_id', p_cycle_id,
    'cut_date', p_cut_date,
    'recognized_fund', coalesce(fund, 0),
    'costs', costs,
    'committed_yield', committed_yield,
    'reserve', reserve,
    'economic_deficit_before_floor', greatest(0, round(costs + committed_yield + reserve - coalesce(fund, 0), 2)),
    'distributable', distributable,
    'eligible_count', eligible_count,
    'per_member', per_member,
    'rounding_residual', residual,
    'liquidity_available', coalesce(liquidity, 0),
    'liquidity_deficit', greatest(0, round(distributable - coalesce(liquidity, 0), 2)),
    'members', members,
    'policy_approved', policy_approved,
    'confirmation_allowed', eligible_count > 0 and distributable > 0 and policy_approved
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
  payment_amount numeric(18,2);
  entries jsonb;
  member_item jsonb;
begin
  if actor is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id for update;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 8 then raise exception 'Clave de idempotencia del reparto invalida.'; end if;
  if length(trim(coalesce(p_preview_hash, ''))) = 0 then raise exception 'La previsualizacion de utilidad es obligatoria.'; end if;

  select * into existing from public.loan_profit_distributions
  where workspace_id = target_cycle.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.cut_date = p_cut_date and existing.policy_version = trim(p_policy_version) and existing.preview_hash is not distinct from trim(p_preview_hash) then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del reparto ya existe con otro contenido.';
  end if;

  preview := public.preview_loan_profit_distribution(p_cycle_id, p_cut_date, p_policy_version, p_costs_amount, p_committed_yield_amount, p_reserve_amount);
  if (preview->>'preview_hash') is distinct from trim(p_preview_hash) then
    raise exception 'La previsualizacion de utilidad esta obsoleta.';
  end if;
  if not (preview->>'confirmation_allowed')::boolean then
    raise exception 'La politica no autoriza confirmar este reparto.';
  end if;
  distributable := (preview->>'distributable')::numeric;
  payment_amount := round(distributable - (preview->>'rounding_residual')::numeric, 2);
  if payment_amount <= 0 then
    raise exception 'El reparto no tiene centavos asignables a beneficiarios; conserve el residual pendiente.';
  end if;

  insert into public.loan_profit_distributions (
    workspace_id, cycle_id, idempotency_key, cut_date, preview_hash, policy_version,
    snapshot, distributable_amount, payment_amount, created_by
  ) values (
    target_cycle.workspace_id, target_cycle.id, trim(p_idempotency_key), p_cut_date, trim(p_preview_hash), trim(p_policy_version),
    preview, distributable, payment_amount, actor
  ) returning * into created;

  for member_item in select * from jsonb_array_elements(preview->'members') loop
    if (member_item->>'eligible')::boolean and (member_item->>'amount')::numeric > 0 then
      insert into public.loan_profit_distribution_allocations (
        workspace_id, cycle_id, distribution_id, cycle_member_id, member_id, amount
      ) values (
        target_cycle.workspace_id,
        target_cycle.id,
        created.id,
        (member_item->>'cycle_member_id')::uuid,
        (member_item->>'member_id')::uuid,
        (member_item->>'amount')::numeric
      );
    end if;
  end loop;

  entries := jsonb_build_array(
    jsonb_build_object('account', 'member_loan_profit_fund', 'amount', payment_amount + (preview->>'costs')::numeric + (preview->>'committed_yield')::numeric + (preview->>'reserve')::numeric),
    jsonb_build_object('account', 'utility_distribution_payable', 'amount', -payment_amount)
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
    jsonb_build_object('distribution_id', created.id, 'preview_hash', trim(p_preview_hash), 'distributable', distributable, 'payment_amount', payment_amount, 'policy_version', trim(p_policy_version)),
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

  select * into existing from public.loan_profit_distribution_payments
  where workspace_id = distribution.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.distribution_id = distribution.id
      and existing.amount = distribution.payment_amount
      and existing.paid_date = p_paid_date
      and existing.liquidity_location = p_liquidity_location
      and existing.bank_account_id is not distinct from p_bank_account_id
      and existing.reference = trim(coalesce(p_reference, '')) then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del pago de reparto ya existe con otro contenido.';
  end if;

  if distribution.status <> 'confirmed' then raise exception 'El reparto no esta pendiente de pago.'; end if;
  if length(trim(coalesce(p_reference, ''))) = 0 then raise exception 'El pago de reparto requiere referencia.'; end if;
  if public.cash_available_at(distribution.cycle_id, p_paid_date, p_liquidity_location, p_bank_account_id) < distribution.payment_amount then
    raise exception 'Liquidez insuficiente para pagar el reparto.';
  end if;

  op := public.create_b_operation(
    distribution.workspace_id, distribution.cycle_id, p_idempotency_key, 'loan_profit_distribution_paid', p_paid_date,
    'loan_profit_distributions', distribution.id,
    jsonb_build_object('distribution_id', distribution.id, 'amount', distribution.payment_amount, 'location', p_liquidity_location, 'bank_account_id', p_bank_account_id, 'reference', trim(p_reference)),
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

  update public.loan_profit_distribution_allocations
  set status = 'paid', payment_id = created.id, paid_at = p_paid_date, payment_reference = trim(p_reference)
  where distribution_id = distribution.id and status = 'pending_payment';

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

  if length(trim(coalesce(p_reason, ''))) = 0 then raise exception 'El reverso requiere motivo.'; end if;
  if original.operation_type = 'reversal' then raise exception 'No se reversa un reverso.'; end if;
  if exists (select 1 from public.financial_operations where reverses_operation_id = original.id) then
    raise exception 'La operacion ya tiene reverso.';
  end if;
  if original.operation_type = 'loan_disbursement'
    and (
      exists (select 1 from public.loan_payments where loan_id = original.reference_id and status = 'posted')
      or exists (select 1 from public.member_settlement_debt_applications where loan_id = original.reference_id)
    ) then
    raise exception 'Antes debe resolver cobros o compensaciones dependientes del prestamo.';
  end if;
  if original.operation_type = 'polla_prize_awarded'
    and exists (
      select 1
      from public.polla_prizes pp
      left join public.polla_prize_payments pay on pay.prize_id = pp.id and pay.status = 'posted'
      left join public.member_settlement_prize_applications spa on spa.prize_id = pp.id
      where pp.award_operation_id = original.id
        and (pay.id is not null or spa.id is not null)
    ) then
    raise exception 'Antes debe resolver pagos o liquidaciones dependientes del premio.';
  end if;
  if original.operation_type in ('member_settlement_confirmed', 'loan_profit_distribution_confirmed') then
    raise exception 'Los reversos de liquidaciones y repartos confirmados requieren flujo dedicado.';
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
  elsif original.operation_type = 'loan_disbursement' then
    update public.loan_contracts set status = 'draft', disbursed_operation_id = null where disbursed_operation_id = original.id;
  elsif original.operation_type = 'savings_contribution_linked' then
    update public.savings_contributions set status = 'reversed' where id = original.reference_id;
  elsif original.operation_type = 'polla_contribution' then
    update public.polla_contributions set status = 'reversed' where operation_id = original.id;
  elsif original.operation_type = 'polla_prize_paid' then
    update public.polla_prize_payments set status = 'reversed' where operation_id = original.id;
    update public.polla_prizes pp set status = 'pending_payment', paid_operation_id = null where pp.paid_operation_id = original.id;
  elsif original.operation_type = 'polla_prize_awarded' then
    update public.polla_prizes set status = 'reversed' where award_operation_id = original.id;
  elsif original.operation_type = 'member_settlement_paid' then
    update public.member_settlement_payments set status = 'reversed' where operation_id = original.id;
    update public.member_settlements
    set status = 'confirmed', paid_operation_id = null, paid_at = null
    where paid_operation_id = original.id;
  elsif original.operation_type = 'loan_profit_distribution_paid' then
    update public.loan_profit_distribution_payments set status = 'reversed' where operation_id = original.id;
    update public.loan_profit_distribution_allocations
    set status = 'pending_payment', payment_id = null, paid_at = null, payment_reference = null
    where payment_id in (select id from public.loan_profit_distribution_payments where operation_id = original.id);
    update public.loan_profit_distributions
    set status = 'confirmed', paid_operation_id = null
    where paid_operation_id = original.id;
  end if;

  return reversal;
end;
$$;

grant execute on function public.create_loan_profit_distribution_policy(uuid, text, text) to authenticated;
grant execute on function public.record_bank_external_financing(uuid, uuid, text, date, numeric, text) to authenticated;
grant execute on function public.record_bank_opening(uuid, uuid, text, date, numeric, text) to authenticated;
grant execute on function public.record_bank_fee(uuid, uuid, text, date, numeric, text) to authenticated;
grant execute on function public.record_internal_liquidity_transfer(uuid, text, date, text, uuid, text, uuid, numeric, text) to authenticated;
grant execute on function public.preview_member_settlement(uuid, date, numeric, numeric, numeric) to authenticated;
grant execute on function public.confirm_member_settlement(uuid, text, date, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.pay_member_settlement(uuid, text, date, text, uuid, text) to authenticated;
grant execute on function public.preview_loan_profit_distribution(uuid, date, text, numeric, numeric, numeric) to authenticated;
grant execute on function public.confirm_loan_profit_distribution(uuid, text, date, text, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.pay_loan_profit_distribution(uuid, text, date, text, uuid, text) to authenticated;
grant execute on function public.reverse_financial_operation(uuid, text, date, text) to authenticated;
