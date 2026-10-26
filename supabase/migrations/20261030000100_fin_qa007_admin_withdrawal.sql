-- FIN-QA-007: reserve projected EA obligations and debit an explicit liquidity source.
create function public.preview_admin_withdrawal(p_cycle_id uuid,p_effective_date date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; preview jsonb; balance numeric(18,2); reserve numeric(18,2); current_fund numeric(18,2); frozen numeric(18,2); covered numeric(18,2); unresolved boolean;
begin
  select * into c from public.cycles where id=p_cycle_id;
  if c.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(c.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_effective_date is null or not isfinite(p_effective_date) or p_effective_date<c.starts_on or p_effective_date>public.fin_civil_today() then raise exception 'Fecha de retiro invalida.'; end if;
  select greatest(-coalesce(sum(le.amount),0),0) into balance from public.ledger_entries le join public.financial_operations fo on fo.id=le.operation_id
    where le.cycle_id=c.id and le.account='admin_payable' and fo.effective_date<=p_effective_date;
  preview:=public.preview_loan_profit_periods(c.id,c.closes_on);
  if exists(select 1 from public.loan_profit_period_distributions where cycle_id=c.id and status='confirmed' and cut_date=c.closes_on) then
    reserve:=0; -- Coverage was already debited when the closing distribution was confirmed.
  else
    select greatest(-coalesce(sum(le.amount),0),0) into current_fund from public.ledger_entries le join public.financial_operations fo on fo.id=le.operation_id
      where le.cycle_id=c.id and le.account='member_loan_profit_fund' and fo.effective_date<=p_effective_date;
    select coalesce(sum((s.snapshot->>'loan_profit_frozen')::numeric),0),coalesce(sum((s.snapshot->>'loan_profit_ea_charge')::numeric),0)
      into frozen,covered from public.member_settlements s where s.cycle_id=c.id and s.status<>'reversed' and s.cut_date<=p_effective_date;
    reserve:=greatest(coalesce((preview->>'shortfall')::numeric,0),public.fin_ea_accrued(c.id,c.closes_on)-covered-greatest(current_fund-frozen,0),0);
  end if;
  unresolved:=coalesce((preview->>'unresolved_settlements')::numeric,0)>0 or coalesce((preview->>'unverified_fund_sources')::numeric,0)>0;
  return jsonb_build_object('cycle_id',c.id,'effective_date',p_effective_date,'admin_balance',balance,'ea_reserve',round(reserve,2),
    'available',case when unresolved then 0 else greatest(round(balance-reserve,2),0) end,'needs_review',unresolved,'reserve_through',c.closes_on,'rule_version','fin-qa007-reserve-through-close-v1');
end; $$;

create function public.withdraw_admin_payable(p_cycle_id uuid,p_idempotency_key text,p_effective_date date,p_amount numeric,p_description text,p_liquidity_location text,p_bank_account_id uuid)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; op public.financial_operations%rowtype; available jsonb; payload jsonb;
begin
  select * into c from public.cycles where id=p_cycle_id for update;
  if c.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(c.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if nullif(trim(coalesce(p_idempotency_key,'')),'') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  payload:=jsonb_build_object('amount',p_amount,'description',trim(coalesce(p_description,'')),'liquidity_location',p_liquidity_location,'bank_account_id',p_bank_account_id);
  select * into op from public.financial_operations where workspace_id=c.workspace_id and idempotency_key=trim(p_idempotency_key);
  if op.id is not null then
    if op.cycle_id=c.id and op.operation_type='admin_withdrawal' and op.effective_date=p_effective_date and op.payload=payload then return op; end if;
    raise exception 'La clave de idempotencia del retiro ya existe con otro contenido.';
  end if;
  perform public.assert_money_2(p_amount,'retiro administracion',true);
  if length(trim(coalesce(p_description,'')))=0 then raise exception 'Indique comprobante o detalle del retiro.'; end if;
  if p_liquidity_location is null or p_liquidity_location not in ('bank','cash') or (p_liquidity_location='bank' and p_bank_account_id is null) or (p_liquidity_location='cash' and p_bank_account_id is not null) then raise exception 'Seleccione banco con cuenta o efectivo como origen del retiro.'; end if;
  if p_liquidity_location='bank' and not exists(select 1 from public.bank_accounts where id=p_bank_account_id and workspace_id=c.workspace_id and status='active') then raise exception 'Cuenta bancaria no encontrada.'; end if;
  available:=public.preview_admin_withdrawal(c.id,p_effective_date);
  if p_amount>(available->>'available')::numeric then raise exception 'El retiro supera el saldo libre despues de reservar el 12 %% EA hasta el cierre.'; end if;
  if public.cash_available_at(c.id,p_effective_date,p_liquidity_location,p_bank_account_id)<p_amount then raise exception 'No hay liquidez suficiente en el origen seleccionado.'; end if;
  return public.create_b_operation(c.workspace_id,c.id,p_idempotency_key,'admin_withdrawal',p_effective_date,'admin_withdrawals',null,payload,
    jsonb_build_array(jsonb_build_object('account','admin_payable','amount',p_amount),
      jsonb_build_object('account','cash','amount',-p_amount,'liquidity_location',p_liquidity_location,'bank_account_id',p_bank_account_id)));
end; $$;

-- The old signature permits only a retry of an already recorded historical withdrawal.
create or replace function public.withdraw_admin_payable(p_cycle_id uuid,p_idempotency_key text,p_effective_date date,p_amount numeric,p_description text)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; op public.financial_operations%rowtype;
begin
  select * into c from public.cycles where id=p_cycle_id;
  if not public.current_user_is_workspace_admin(c.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  select * into op from public.financial_operations where workspace_id=c.workspace_id and idempotency_key=trim(p_idempotency_key);
  if op.id is not null and op.cycle_id=c.id and op.operation_type='admin_withdrawal' and op.effective_date=p_effective_date and op.payload=jsonb_build_object('amount',p_amount,'description',coalesce(p_description,'')) then return op; end if;
  raise exception 'Seleccione banco con cuenta o efectivo como origen del retiro.';
end; $$;
revoke all on function public.preview_admin_withdrawal(uuid,date),public.withdraw_admin_payable(uuid,text,date,numeric,text,text,uuid) from public,anon;
grant execute on function public.preview_admin_withdrawal(uuid,date),public.withdraw_admin_payable(uuid,text,date,numeric,text,text,uuid) to authenticated;
