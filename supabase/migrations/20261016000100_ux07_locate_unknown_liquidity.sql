-- UX-07: ubicar en banco o efectivo el dinero migrado sin ubicación (liquidity_location = 'unknown').
create or replace function public.locate_unknown_liquidity(
  p_cycle_id uuid,
  p_idempotency_key text,
  p_effective_date date,
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
  unknown_available numeric(18,2);
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform public.assert_money_2(p_amount, 'ubicacion de liquidez', true);
  if p_to_location not in ('bank', 'cash') then raise exception 'Ubicacion destino invalida.'; end if;
  if (p_to_location = 'bank' and p_to_bank_account_id is null) or (p_to_location = 'cash' and p_to_bank_account_id is not null) then
    raise exception 'Cuenta y ubicacion no son coherentes.';
  end if;

  select round(coalesce(sum(le.amount), 0), 2) into unknown_available
  from public.ledger_entries le
  join public.financial_operations fo on fo.id = le.operation_id
  where le.cycle_id = p_cycle_id and le.account = 'cash' and le.liquidity_location = 'unknown'
    and fo.effective_date <= p_effective_date;
  if unknown_available < p_amount then raise exception 'El monto supera el dinero sin ubicar a esa fecha.'; end if;

  return public.create_b_operation(
    target_cycle.workspace_id, target_cycle.id, p_idempotency_key, 'liquidity_transfer', p_effective_date,
    'liquidity_locations', null,
    jsonb_build_object('from_location', 'unknown', 'to_location', p_to_location, 'to_bank_account_id', p_to_bank_account_id, 'amount', p_amount, 'reference', coalesce(p_reference, '')),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'amount', -p_amount, 'liquidity_location', 'unknown'),
      jsonb_build_object('account', 'cash', 'amount', p_amount, 'liquidity_location', p_to_location, 'bank_account_id', p_to_bank_account_id)
    )
  );
end;
$$;

revoke all on function public.locate_unknown_liquidity(uuid, text, date, text, uuid, numeric, text) from public;
grant execute on function public.locate_unknown_liquidity(uuid, text, date, text, uuid, numeric, text) to authenticated;
