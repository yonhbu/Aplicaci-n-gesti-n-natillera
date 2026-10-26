-- FIN-08: auditoria de publicacion.
-- P0 Pagos de utilidades (y entrega de premios a retirados) validan liquidez real dentro de la transaccion.
-- P0 Correccion coordinada: un reparto aun no pagado se puede deshacer con asientos compensatorios; despues
--    se corrige o revierte el cobro de origen y se vuelve a calcular. No se borran operaciones.
-- Lo ya pagado a socios no se deshace automaticamente (requiere politica de recuperacion).

do $$
declare
  def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'financial_operations_operation_type_check';
  if def is not null and def not like '%loan_profit_period_reversed%' then
    execute 'alter table public.financial_operations drop constraint financial_operations_operation_type_check';
    execute 'alter table public.financial_operations add constraint financial_operations_operation_type_check '
      || replace(def, '''loan_profit_period_paid''::text', '''loan_profit_period_paid''::text, ''loan_profit_period_reversed''::text, ''bank_yield_distribution_reversed''::text');
  end if;
end;
$$;

alter table public.bank_yield_distributions add column if not exists reversed_operation_id uuid references public.financial_operations(id);
alter table public.bank_yield_distributions add column if not exists reversal_reason text;
alter table public.loan_profit_period_distributions add column if not exists reversed_operation_id uuid references public.financial_operations(id);
alter table public.loan_profit_period_distributions add column if not exists reversal_reason text;

create or replace function public.pay_loan_profit_allocation(p_allocation_id uuid, p_idempotency_key text, p_paid_date date, p_liquidity_location text, p_bank_account_id uuid, p_reference text)
returns public.loan_profit_period_allocations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  alloc public.loan_profit_period_allocations%rowtype;
  dist public.loan_profit_period_distributions%rowtype;
  op public.financial_operations%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into alloc from public.loan_profit_period_allocations where id = p_allocation_id for update;
  if alloc.id is null then raise exception 'Asignacion no encontrada.'; end if;
  select * into dist from public.loan_profit_period_distributions where id = alloc.distribution_id for update;
  if not public.current_user_is_workspace_admin(dist.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if alloc.paid_operation_id is not null then return alloc; end if;
  if dist.status = 'reversed' then raise exception 'El reparto fue revertido.'; end if;
  if alloc.amount <= 0 then raise exception 'Este socio no tiene utilidad por pagar.'; end if;
  if p_liquidity_location not in ('bank', 'cash') or (p_liquidity_location = 'bank' and p_bank_account_id is null) then raise exception 'Indique de donde sale el dinero.'; end if;
  if p_paid_date is null or p_paid_date < dist.cut_date then raise exception 'Fecha de pago invalida.'; end if;
  -- FIN-08: liquidez real en la ubicacion elegida, con bloqueo del ciclo para pagos concurrentes.
  perform 1 from public.cycles where id = dist.cycle_id for update;
  if public.cash_available_at(dist.cycle_id, p_paid_date, p_liquidity_location, p_bank_account_id) < alloc.amount then
    raise exception 'No hay dinero suficiente en % para pagar % a este socio.', case when p_liquidity_location = 'bank' then 'esa cuenta' else 'efectivo' end, alloc.amount;
  end if;
  op := public.create_b_operation(
    dist.workspace_id, dist.cycle_id, p_idempotency_key, 'loan_profit_period_paid', p_paid_date,
    'loan_profit_period_allocations', alloc.id,
    jsonb_build_object('allocation_id', alloc.id, 'distribution_id', dist.id, 'member_id', alloc.member_id, 'amount', alloc.amount, 'reference', coalesce(p_reference, '')),
    jsonb_build_array(
      jsonb_build_object('account', 'utility_distribution_payable', 'amount', alloc.amount, 'member_id', alloc.member_id),
      jsonb_build_object('account', 'cash', 'amount', -alloc.amount, 'liquidity_location', p_liquidity_location, 'bank_account_id', p_bank_account_id, 'member_id', alloc.member_id)
    )
  );
  update public.loan_profit_period_allocations
  set paid_operation_id = op.id, paid_date = p_paid_date, paid_reference = nullif(trim(coalesce(p_reference, '')), ''), paid_location = p_liquidity_location
  where id = alloc.id returning * into alloc;
  if not exists (select 1 from public.loan_profit_period_allocations a where a.distribution_id = dist.id and a.amount > 0 and a.paid_operation_id is null) then
    update public.loan_profit_period_distributions set status = 'paid', paid_date = p_paid_date where id = dist.id;
  end if;
  return alloc;
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
  if not exists (select 1 from public.member_settlements s where s.cycle_member_id = prize.winner_cycle_member_id and s.status <> 'reversed') then
    raise exception 'Los premios de polla se acreditan al capital del ganador; solo se entregan en pago a socios que ya liquidaron su ahorro.';
  end if;
  if prize.legacy_payment_status = 'historical_payment_unverified' then
    raise exception 'Premio historico sin verificar: confirme primero que no se pago antes de registrar el pago.';
  end if;
  if p_paid_date is null or p_paid_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de pago de premio invalida.'; end if;
  perform 1 from public.cycles where id = prize.cycle_id for update;
  if (select coalesce(sum(le.amount), 0) from public.ledger_entries le
      join public.financial_operations fo on fo.id = le.operation_id
      where fo.cycle_id = prize.cycle_id and le.account = 'cash' and fo.effective_date <= p_paid_date) < prize.net_amount then
    raise exception 'No hay dinero suficiente en la natillera para entregar este premio.';
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
  update public.polla_prizes set status = 'paid', paid_operation_id = op.id, legacy_payment_status = 'paid_verified' where id = prize.id;
  return created;
end;
$$;

create or replace function public.reverse_loan_profit_periods(p_distribution_id uuid, p_idempotency_key text, p_reason text)
returns public.loan_profit_period_distributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dist public.loan_profit_period_distributions%rowtype;
  op public.financial_operations%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into dist from public.loan_profit_period_distributions where id = p_distribution_id for update;
  if dist.id is null then raise exception 'Reparto no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(dist.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if dist.status = 'reversed' then return dist; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Indique el motivo de la correccion.'; end if;
  if exists (select 1 from public.loan_profit_period_allocations a where a.distribution_id = dist.id and a.paid_operation_id is not null) then
    raise exception 'Ya se pago utilidad a uno o mas socios: no se puede deshacer el reparto sin una politica de recuperacion.';
  end if;
  if exists (select 1 from public.member_settlements s where s.cycle_id = dist.cycle_id and s.status <> 'reversed' and s.cut_date >= dist.cut_date) then
    raise exception 'Ya hay liquidaciones de cierre que dependen de este reparto.';
  end if;
  op := public.create_b_operation(
    dist.workspace_id, dist.cycle_id, p_idempotency_key, 'loan_profit_period_reversed', dist.cut_date,
    'loan_profit_period_distributions', dist.id,
    jsonb_build_object('distribution_id', dist.id, 'reason', trim(p_reason), 'reverses_operation_id', dist.operation_id),
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'account', le.account, 'amount', -le.amount, 'member_id', le.member_id, 'loan_id', le.loan_id, 'prize_id', le.prize_id,
        'liquidity_location', case when le.account = 'cash' then le.liquidity_location end,
        'bank_account_id', case when le.account = 'cash' then le.bank_account_id end))), '[]'::jsonb)
      from public.ledger_entries le where le.operation_id = dist.operation_id)
  );
  update public.loan_profit_period_distributions set status = 'reversed', reversed_operation_id = op.id, reversal_reason = trim(p_reason)
  where id = dist.id returning * into dist;
  return dist;
end;
$$;

create or replace function public.reverse_bank_yield_distribution(p_distribution_id uuid, p_idempotency_key text, p_reason text)
returns public.bank_yield_distributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dist public.bank_yield_distributions%rowtype;
  op public.financial_operations%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into dist from public.bank_yield_distributions where id = p_distribution_id for update;
  if dist.id is null then raise exception 'Reparto no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(dist.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if dist.status = 'reversed' then return dist; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Indique el motivo de la correccion.'; end if;
  if exists (select 1 from public.member_settlements s where s.cycle_id = dist.cycle_id and s.status <> 'reversed'
             and s.cut_date >= dist.cut_date and coalesce((s.snapshot->>'bank_yield_fund')::numeric, 0) > 0) then
    raise exception 'Ya se liquido el fondo Pibank de uno o mas socios: no se puede deshacer el reparto.';
  end if;
  op := public.create_b_operation(
    dist.workspace_id, dist.cycle_id, p_idempotency_key, 'bank_yield_distribution_reversed', dist.cut_date,
    'bank_yield_distributions', dist.id,
    jsonb_build_object('distribution_id', dist.id, 'reason', trim(p_reason), 'reverses_operation_id', dist.operation_id),
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'account', le.account, 'amount', -le.amount, 'member_id', le.member_id, 'loan_id', le.loan_id, 'prize_id', le.prize_id,
        'liquidity_location', case when le.account = 'cash' then le.liquidity_location end,
        'bank_account_id', case when le.account = 'cash' then le.bank_account_id end))), '[]'::jsonb)
      from public.ledger_entries le where le.operation_id = dist.operation_id)
  );
  -- Los abonos individuales se retiran; el historial queda en la operacion original, la compensatoria y el snapshot.
  delete from public.member_capital_credits where distribution_id = dist.id;
  update public.bank_yield_distributions set status = 'reversed', reversed_operation_id = op.id, reversal_reason = trim(p_reason)
  where id = dist.id returning * into dist;
  return dist;
end;
$$;

revoke all on function public.reverse_loan_profit_periods(uuid, text, text) from public, anon;
revoke all on function public.reverse_bank_yield_distribution(uuid, text, text) from public, anon;
grant execute on function public.reverse_loan_profit_periods(uuid, text, text) to authenticated;
grant execute on function public.reverse_bank_yield_distribution(uuid, text, text) to authenticated;
grant execute on function public.pay_loan_profit_allocation(uuid, text, date, text, uuid, text) to authenticated;
