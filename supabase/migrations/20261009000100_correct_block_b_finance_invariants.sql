alter table public.loan_contracts
  add column if not exists scheduled_payment numeric(18,8),
  add column if not exists prepayment_first_month_interest numeric(18,2),
  add column if not exists cancelled_at date;

alter table public.loan_payments
  add column if not exists status text not null default 'posted' check (status in ('posted', 'reversed'));

alter table public.polla_contributions
  add column if not exists status text not null default 'posted' check (status in ('posted', 'reversed'));

alter table public.polla_prize_payments
  add column if not exists status text not null default 'posted' check (status in ('posted', 'reversed'));

drop index if exists financial_operations_single_reversal_idx;
create unique index financial_operations_single_reversal_idx
  on public.financial_operations(reverses_operation_id)
  where reverses_operation_id is not null;

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
    'reversal'
  ));

create or replace function public.assert_money_2(p_value numeric, p_label text, p_positive boolean default false)
returns void
language plpgsql
as $$
begin
  if p_value is null or p_value::text = 'NaN' or p_value <> round(p_value, 2) then
    raise exception '% debe tener maximo dos decimales y ser finito.', p_label;
  end if;
  if p_positive and p_value <= 0 then
    raise exception '% debe ser mayor que cero.', p_label;
  end if;
  if not p_positive and p_value < 0 then
    raise exception '% no puede ser negativo.', p_label;
  end if;
end;
$$;

create or replace function public.assert_b_ledger_balanced(entries jsonb)
returns void
language plpgsql
as $$
declare
  total numeric;
  count_entries integer;
begin
  select count(*), coalesce(sum((entry->>'amount')::numeric), 0)
  into count_entries, total
  from jsonb_array_elements(entries) as entry;

  if count_entries < 2 then
    raise exception 'La operacion financiera necesita al menos dos partidas.';
  end if;

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
  target_cycle public.cycles%rowtype;
  entry jsonb;
  entry_amount numeric;
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
    if entry_amount = 0 then
      continue;
    end if;
    if entry_amount is null or entry_amount::text = 'NaN' or entry_amount <> round(entry_amount, 2) then
      raise exception 'Importe de partida invalido.';
    end if;
    insert into public.ledger_entries (
      operation_id, workspace_id, cycle_id, account, amount, member_id, loan_id, polla_activity_id, prize_id
    ) values (
      created.id,
      p_workspace_id,
      p_cycle_id,
      entry->>'account',
      entry_amount,
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

create or replace function public.loan_schedule_preview(
  p_principal numeric,
  p_method text,
  p_rate_unit text,
  p_rate_value numeric,
  p_term_months integer,
  p_start_date date
)
returns table (
  installment_number integer,
  due_date date,
  principal_due numeric,
  interest_due numeric,
  total_due numeric
)
language plpgsql
stable
as $$
declare
  i integer;
  previous_date date := p_start_date;
  current_due date;
  outstanding numeric := p_principal;
  interest numeric;
  capital numeric;
  payment numeric;
begin
  perform public.assert_money_2(p_principal, 'principal', true);
  if p_rate_value is null or p_rate_value::text = 'NaN' or p_rate_value < 0 then
    raise exception 'Tasa invalida.';
  end if;
  if p_method not in ('amortized', 'fixed_interest', 'interest_only') then
    raise exception 'Metodo de prestamo invalido.';
  end if;
  if p_rate_unit not in ('EA', 'MONTHLY_FIXED') then
    raise exception 'Unidad de tasa invalida.';
  end if;
  if p_term_months is null or p_term_months < 1 or p_term_months > 120 then
    raise exception 'Plazo invalido.';
  end if;
  if p_start_date is null or p_start_date in ('infinity'::date, '-infinity'::date) then
    raise exception 'Fecha de inicio invalida.';
  end if;

  if p_method = 'amortized' and p_rate_unit = 'MONTHLY_FIXED' and p_rate_value > 0 then
    payment := p_principal * p_rate_value / (1 - power(1 + p_rate_value, -p_term_months));
  elsif p_method = 'amortized' then
    payment := p_principal / p_term_months;
  else
    payment := null;
  end if;

  for i in 1..p_term_months loop
    current_due := (p_start_date + (i || ' month')::interval)::date;
    interest := case
      when p_rate_unit = 'MONTHLY_FIXED' then round(
        case when p_method = 'fixed_interest' then p_principal else outstanding end * p_rate_value,
        2
      )
      else round(outstanding * (power(1 + p_rate_value, greatest(0, current_due - previous_date)::numeric / 365) - 1), 2)
    end;

    if p_method = 'interest_only' and i < p_term_months then
      capital := 0;
    elsif p_method = 'fixed_interest' then
      capital := round(p_principal / p_term_months, 2);
    elsif p_method = 'amortized' and i < p_term_months then
      capital := round(coalesce(payment, 0) - interest, 2);
      if capital < 0 then
        capital := 0;
      end if;
    else
      capital := round(outstanding, 2);
    end if;

    if i = p_term_months then
      capital := round(outstanding, 2);
    end if;

    installment_number := i;
    due_date := current_due;
    principal_due := capital;
    interest_due := interest;
    total_due := round(capital + interest, 2);
    return next;

    outstanding := outstanding - capital;
    previous_date := current_due;
  end loop;
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
  borrower public.members%rowtype;
  referrer public.members%rowtype;
  existing public.loan_contracts%rowtype;
  created public.loan_contracts%rowtype;
  first_row record;
  scheduled numeric;
begin
  if actor is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if target_cycle.status <> 'active' then raise exception 'No se crean prestamos en ciclos cerrados.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;

  perform public.assert_money_2(p_principal, 'principal', true);
  if p_rate_value is null or p_rate_value::text = 'NaN' or p_rate_value < 0 then raise exception 'Tasa invalida.'; end if;
  if p_start_date is null or p_start_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de inicio invalida.'; end if;

  if p_borrower_member_id is not null then
    select * into borrower from public.members where workspace_id = target_cycle.workspace_id and id = p_borrower_member_id;
    if borrower.id is null then raise exception 'Deudor no pertenece al workspace del ciclo.'; end if;
  end if;

  if p_referred_by_member_id is not null then
    select * into referrer from public.members where workspace_id = target_cycle.workspace_id and id = p_referred_by_member_id;
    if referrer.id is null then raise exception 'Referido no pertenece al workspace del ciclo.'; end if;
  end if;

  select * into existing from public.loan_contracts
  where workspace_id = target_cycle.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.cycle_id = target_cycle.id
      and existing.borrower_member_id is not distinct from p_borrower_member_id
      and coalesce(existing.external_borrower_name, '') = coalesce(nullif(trim(coalesce(p_external_borrower_name, '')), ''), '')
      and existing.referred_by_member_id is not distinct from p_referred_by_member_id
      and existing.principal = p_principal
      and existing.method = p_method
      and existing.rate_unit = p_rate_unit
      and existing.rate_value = p_rate_value
      and existing.term_months = p_term_months
      and existing.start_date = p_start_date then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del contrato ya existe con otro contenido.';
  end if;

  select total_due into scheduled
  from public.loan_schedule_preview(p_principal, p_method, p_rate_unit, p_rate_value, p_term_months, p_start_date)
  where installment_number = 1;

  insert into public.loan_contracts (
    workspace_id, cycle_id, borrower_member_id, external_borrower_name, referred_by_member_id,
    principal, method, rate_unit, rate_value, term_months, start_date, idempotency_key, created_by,
    scheduled_payment
  ) values (
    target_cycle.workspace_id, target_cycle.id, p_borrower_member_id, nullif(trim(coalesce(p_external_borrower_name, '')), ''),
    p_referred_by_member_id, p_principal, p_method, p_rate_unit, p_rate_value, p_term_months, p_start_date, trim(p_idempotency_key), actor,
    scheduled
  ) returning * into created;

  for first_row in
    select * from public.loan_schedule_preview(p_principal, p_method, p_rate_unit, p_rate_value, p_term_months, p_start_date)
  loop
    insert into public.loan_schedules (workspace_id, cycle_id, loan_id, installment_number, due_date, principal_due, interest_due)
    values (created.workspace_id, created.cycle_id, created.id, first_row.installment_number, first_row.due_date, first_row.principal_due, first_row.interest_due);
  end loop;

  update public.loan_contracts
  set prepayment_first_month_interest = (select interest_due from public.loan_schedules where loan_id = created.id and installment_number = 1)
  where id = created.id
  returning * into created;

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
  select * into loan from public.loan_contracts where id = p_loan_id for update;
  if loan.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(loan.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_disbursed_date is null or p_disbursed_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de desembolso invalida.'; end if;

  if loan.status <> 'draft' or loan.disbursed_operation_id is not null then
    if loan.disbursed_operation_id is null then raise exception 'El prestamo no esta disponible para desembolso.'; end if;
    select * into op from public.financial_operations where id = loan.disbursed_operation_id;
    if op.idempotency_key = trim(p_idempotency_key)
      and op.effective_date = p_disbursed_date
      and op.payload = jsonb_build_object('loan_id', loan.id, 'principal', loan.principal) then
      return loan;
    end if;
    raise exception 'El prestamo ya fue desembolsado con otra operacion.';
  end if;

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
    jsonb_build_object('loan_id', loan.id, 'amount', p_amount, 'capital', p_capital_amount, 'interest', p_interest_amount, 'kind', coalesce(p_kind, 'regular'), 'admin', admin, 'member_fund', fund),
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
    loan.workspace_id, loan.cycle_id, loan.id, op.id, trim(p_idempotency_key), p_payment_date, p_amount, p_capital_amount, p_interest_amount, coalesce(p_kind, 'regular')
  ) returning * into created;

  if round(outstanding - p_capital_amount, 2) = 0 then
    update public.loan_contracts set status = 'paid', cancelled_at = p_payment_date where id = loan.id;
    update public.loan_schedules set status = 'cancelled' where loan_id = loan.id and status = 'projected';
  end if;

  return created;
end;
$$;

create or replace function public.quote_loan_prepayment(p_loan_id uuid, p_quote_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  loan public.loan_contracts%rowtype;
  principal_due numeric(18,2);
  first_interest numeric(18,2);
  interest_collected numeric(18,2);
  interest_due numeric(18,2);
begin
  select * into loan from public.loan_contracts where id = p_loan_id;
  if loan.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(loan.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if loan.status <> 'active' then raise exception 'Solo se cotizan prepagos de prestamos activos.'; end if;

  select round(loan.principal - coalesce(sum(lp.capital_amount) filter (where lp.status = 'posted'), 0), 2),
         round(coalesce(sum(lp.interest_amount) filter (where lp.status = 'posted'), 0), 2)
  into principal_due, interest_collected
  from public.loan_payments lp
  where lp.loan_id = loan.id;

  first_interest := coalesce(loan.prepayment_first_month_interest, 0);
  interest_due := greatest(round(first_interest - interest_collected, 2), 0);

  return jsonb_build_object(
    'loan_id', loan.id,
    'quote_date', p_quote_date,
    'principal_due', principal_due,
    'interest_due', interest_due,
    'total_due', round(principal_due + interest_due, 2),
    'rule_version', 'B-2026-10-09'
  );
end;
$$;

create or replace function public.confirm_loan_prepayment(p_loan_id uuid, p_idempotency_key text, p_payment_date date)
returns public.loan_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  quote jsonb;
begin
  quote := public.quote_loan_prepayment(p_loan_id, p_payment_date);
  return public.record_loan_payment(
    p_loan_id,
    p_idempotency_key,
    p_payment_date,
    (quote->>'total_due')::numeric,
    (quote->>'principal_due')::numeric,
    (quote->>'interest_due')::numeric,
    'prepayment'
  );
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
begin
  if actor is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target from public.cycle_members cm where cm.id = p_cycle_member_id for update;
  if target.id is null then raise exception 'Socio del ciclo no encontrado.'; end if;
  select * into target_cycle from public.cycles where id = target.cycle_id;
  if target_cycle.status <> 'active' then raise exception 'El ciclo no esta activo.'; end if;
  if not public.current_user_is_workspace_admin(target.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_amount is null or p_amount::text = 'NaN' or p_amount <= 0 or p_amount <> round(p_amount, 2) then
    raise exception 'El aporte debe ser finito, positivo y con maximo dos decimales.';
  end if;
  if p_effective_date is null or p_effective_date in ('infinity'::date, '-infinity'::date) then raise exception 'La fecha efectiva debe ser una fecha finita.'; end if;
  if p_applied_year <> target_cycle.year then raise exception 'El ano aplicado no corresponde al ciclo.'; end if;
  if p_applied_month < target.participation_start_month or p_applied_month > target.participation_end_month then raise exception 'El mes aplicado esta fuera del rango de participacion del socio.'; end if;
  if not target.participates_in_savings then raise exception 'El socio no esta habilitado para aportes de ahorro en este ciclo.'; end if;

  select * into existing from public.savings_contributions sc
  where sc.workspace_id = target.workspace_id and sc.idempotency_key = trim(p_idempotency_key)
  for update;

  if existing.id is not null then
    if existing.cycle_member_id = p_cycle_member_id
      and existing.amount = p_amount
      and existing.effective_date = p_effective_date
      and existing.applied_year = p_applied_year
      and existing.applied_month = p_applied_month
      and existing.method = p_method
      and existing.source = coalesce(p_source, 'manual') then
      perform public.link_existing_savings_contribution_to_ledger(existing.id);
      return existing;
    end if;
    raise exception 'La clave de idempotencia ya existe con otro contenido.';
  end if;

  insert into public.savings_contributions (
    workspace_id, cycle_id, member_id, cycle_member_id, idempotency_key, amount,
    effective_date, applied_year, applied_month, method, source, actor_user_id
  ) values (
    target.workspace_id, target.cycle_id, target.member_id, target.id, trim(p_idempotency_key), p_amount,
    p_effective_date, p_applied_year, p_applied_month, p_method, coalesce(p_source, 'manual'), actor
  )
  returning * into created;

  perform public.link_existing_savings_contribution_to_ledger(created.id);
  return created;
end;
$$;

create or replace function public.create_polla_activity(
  p_cycle_id uuid,
  p_period_year integer,
  p_period_month integer,
  p_name text
)
returns public.polla_activities
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  created public.polla_activities%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if target_cycle.status <> 'active' then raise exception 'No se crean actividades en ciclos cerrados.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_period_year <> target_cycle.year then raise exception 'El periodo de polla no corresponde al ciclo.'; end if;
  if p_period_month < 1 or p_period_month > 12 then raise exception 'Mes de polla invalido.'; end if;

  insert into public.polla_activities (workspace_id, cycle_id, period_year, period_month, name)
  values (target_cycle.workspace_id, target_cycle.id, p_period_year, p_period_month, trim(p_name))
  returning * into created;

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
  member_row public.cycle_members%rowtype;
  existing public.polla_contributions%rowtype;
  op public.financial_operations%rowtype;
  created public.polla_contributions%rowtype;
begin
  select * into activity from public.polla_activities where id = p_activity_id for update;
  if activity.id is null then raise exception 'Actividad no encontrada.'; end if;
  if activity.status <> 'open' then raise exception 'La actividad no esta abierta para aportes.'; end if;
  if not public.current_user_is_workspace_admin(activity.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  select * into member_row from public.cycle_members where id = p_cycle_member_id;
  if member_row.id is null or member_row.workspace_id <> activity.workspace_id or member_row.cycle_id <> activity.cycle_id then
    raise exception 'Participante no pertenece al mismo ciclo de la actividad.';
  end if;
  perform public.assert_money_2(p_amount, 'aporte polla', true);
  if p_paid_date is null or p_paid_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de aporte de polla invalida.'; end if;

  select * into existing from public.polla_contributions
  where workspace_id = activity.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.activity_id = activity.id
      and existing.cycle_member_id = p_cycle_member_id
      and existing.amount = p_amount
      and existing.paid_date = p_paid_date then
      return existing;
    end if;
    raise exception 'La clave de idempotencia de polla ya existe con otro contenido.';
  end if;

  op := public.create_b_operation(
    activity.workspace_id, activity.cycle_id, p_idempotency_key, 'polla_contribution', p_paid_date,
    'polla_activities', activity.id,
    jsonb_build_object('activity_id', activity.id, 'cycle_member_id', p_cycle_member_id, 'amount', p_amount),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'amount', p_amount, 'polla_activity_id', activity.id),
      jsonb_build_object('account', 'polla_pool', 'amount', -p_amount, 'polla_activity_id', activity.id)
    )
  );

  insert into public.polla_participants (workspace_id, cycle_id, activity_id, cycle_member_id)
  values (activity.workspace_id, activity.cycle_id, activity.id, p_cycle_member_id)
  on conflict (activity_id, cycle_member_id) do nothing;

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
  winner public.cycle_members%rowtype;
  existing public.polla_prizes%rowtype;
  op public.financial_operations%rowtype;
  created public.polla_prizes%rowtype;
  commission numeric(18,2) := 5000;
  net numeric(18,2);
begin
  select * into activity from public.polla_activities where id = p_activity_id for update;
  if activity.id is null then raise exception 'Actividad no encontrada.'; end if;
  if not public.current_user_is_workspace_admin(activity.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  select * into winner from public.cycle_members where id = p_winner_cycle_member_id;
  if winner.id is null or winner.workspace_id <> activity.workspace_id or winner.cycle_id <> activity.cycle_id then
    raise exception 'Ganador no pertenece al mismo ciclo de la actividad.';
  end if;
  perform public.assert_money_2(p_gross_amount, 'premio bruto', true);
  if p_awarded_at is null or p_awarded_at in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de premio invalida.'; end if;
  if p_gross_amount < commission then raise exception 'Falta regla para premios menores que la comision fija.'; end if;
  if not exists (select 1 from public.polla_participants pp where pp.activity_id = activity.id and pp.cycle_member_id = p_winner_cycle_member_id) then
    raise exception 'El ganador no tiene derecho registrado en esta actividad.';
  end if;

  select * into existing from public.polla_prizes
  where workspace_id = activity.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.activity_id = activity.id
      and existing.winner_cycle_member_id = p_winner_cycle_member_id
      and existing.gross_amount = p_gross_amount
      and existing.awarded_at = p_awarded_at then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del premio ya existe con otro contenido.';
  end if;

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
  select * into prize from public.polla_prizes where id = p_prize_id for update;
  if prize.id is null then raise exception 'Premio no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(prize.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;

  select * into existing from public.polla_prize_payments
  where workspace_id = prize.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.prize_id = prize.id and existing.amount = prize.net_amount and existing.paid_date = p_paid_date then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del pago de premio ya existe con otro contenido.';
  end if;

  if prize.status <> 'pending_payment' then raise exception 'El premio no esta pendiente de pago.'; end if;
  if p_paid_date is null or p_paid_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de pago de premio invalida.'; end if;

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
    jsonb_build_object('amount', p_amount, 'kind', p_kind, 'description', coalesce(p_description, '')),
    case when p_kind = 'income' then
      jsonb_build_array(
        jsonb_build_object('account', 'cash', 'amount', p_amount),
        jsonb_build_object('account', 'common_income', 'amount', -p_amount)
      )
    else
      jsonb_build_array(
        jsonb_build_object('account', 'common_expense', 'amount', p_amount),
        jsonb_build_object('account', 'cash', 'amount', -p_amount)
      )
    end
  );
end;
$$;

create or replace function public.withdraw_admin_payable(
  p_cycle_id uuid,
  p_idempotency_key text,
  p_effective_date date,
  p_amount numeric,
  p_description text
)
returns public.financial_operations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  payable numeric(18,2);
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_amount, 'retiro administracion', true);
  select round(0 - coalesce(sum(amount), 0), 2) into payable
  from public.ledger_entries
  where workspace_id = target_cycle.workspace_id and cycle_id = target_cycle.id and account = 'admin_payable';
  if p_amount > payable then raise exception 'El retiro supera la administracion por pagar.'; end if;

  return public.create_b_operation(
    target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'admin_withdrawal', p_effective_date,
    'admin_withdrawals', null,
    jsonb_build_object('amount', p_amount, 'description', coalesce(p_description, '')),
    jsonb_build_array(
      jsonb_build_object('account', 'admin_payable', 'amount', p_amount),
      jsonb_build_object('account', 'cash', 'amount', -p_amount)
    )
  );
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
  entry jsonb;
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
  if original.operation_type = 'loan_disbursement'
    and exists (select 1 from public.loan_payments where loan_id = original.reference_id and status = 'posted') then
    raise exception 'Antes debe reversar los cobros dependientes del prestamo.';
  end if;
  if original.operation_type = 'polla_prize_awarded'
    and exists (
      select 1
      from public.polla_prizes pp
      join public.polla_prize_payments pay on pay.prize_id = pp.id and pay.status = 'posted'
      where pp.award_operation_id = original.id
    ) then
    raise exception 'Antes debe reversar el pago dependiente del premio.';
  end if;

  select jsonb_agg(jsonb_build_object(
    'account', le.account,
    'amount', -le.amount,
    'member_id', le.member_id,
    'loan_id', le.loan_id,
    'polla_activity_id', le.polla_activity_id,
    'prize_id', le.prize_id
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

revoke insert, update, delete on public.polla_activities, public.polla_participants from anon, authenticated;
grant execute on function public.create_polla_activity(uuid, integer, integer, text) to authenticated;
grant execute on function public.quote_loan_prepayment(uuid, date) to authenticated;
grant execute on function public.confirm_loan_prepayment(uuid, text, date) to authenticated;
grant execute on function public.record_manual_cash_movement(uuid, text, date, numeric, text, text) to authenticated;
grant execute on function public.withdraw_admin_payable(uuid, text, date, numeric, text) to authenticated;
grant execute on function public.reverse_financial_operation(uuid, text, date, text) to authenticated;

revoke execute on function public.create_b_operation(uuid, uuid, text, text, date, text, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.assert_b_ledger_balanced(jsonb) from public, anon, authenticated;
revoke execute on function public.assert_money_2(numeric, text, boolean) from public, anon, authenticated;
