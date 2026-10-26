-- Explicit destination for new receipts. The existing payment and quote rules remain authoritative.
create or replace function public.record_located_loan_payment(p_loan_id uuid,p_idempotency_key text,p_payment_date date,p_amount numeric,p_capital_amount numeric,p_interest_amount numeric,p_kind text,p_bank_account_id uuid,p_quote_hash text default null)
returns public.loan_payments language plpgsql security definer set search_path=public,pg_temp as $$
declare loan public.loan_contracts%rowtype;previous public.loan_payments%rowtype;payment public.loan_payments%rowtype;original_bank uuid;location_key text;
begin
  perform 1 from public.cycles where id=(select cycle_id from public.loan_contracts where id=p_loan_id)for update;
  select * into loan from public.loan_contracts where id=p_loan_id for update;
  if loan.id is null or auth.uid()is null or not public.current_user_is_workspace_admin(loan.workspace_id)then raise exception 'No tiene permiso sobre este prestamo.';end if;
  if p_bank_account_id is not null and not exists(select 1 from public.bank_accounts where id=p_bank_account_id and workspace_id=loan.workspace_id and status='active')then raise exception 'Cuenta bancaria no disponible.';end if;
  location_key:=trim(p_idempotency_key)||':bank';
  select * into previous from public.loan_payments where workspace_id=loan.workspace_id and idempotency_key=trim(p_idempotency_key);
  if previous.id is not null then
    select(p.payload->>'bank_account_id')::uuid into original_bank from public.financial_operations p
      where p.workspace_id=loan.workspace_id and p.reference_id=previous.operation_id and p.idempotency_key=location_key and p.operation_type='cash_location_corrected';
    if original_bank is distinct from p_bank_account_id then raise exception 'El destino del cobro no coincide con el intento original.';end if;
  end if;
  if p_quote_hash is not null then
    if p_kind is distinct from 'prepayment'or p_amount is not null or p_capital_amount is not null or p_interest_amount is not null then raise exception 'El pago total debe usar exclusivamente su cotizacion.';end if;
    payment:=public.confirm_loan_prepayment(p_loan_id,p_idempotency_key,p_payment_date,p_quote_hash);
  else
    payment:=public.record_loan_payment(p_loan_id,p_idempotency_key,p_payment_date,p_amount,p_capital_amount,p_interest_amount,p_kind);
  end if;
  if p_bank_account_id is not null and previous.id is null then
    if coalesce((select sum(amount)from public.ledger_entries where operation_id=payment.operation_id and account='cash'and liquidity_location='cash'),0)<>payment.amount then raise exception 'La ubicacion original del cobro requiere revision.';end if;
    perform public.create_b_operation(loan.workspace_id,loan.cycle_id,location_key,'cash_location_corrected',p_payment_date,'financial_operations',payment.operation_id,
      jsonb_build_object('root_operation_id',payment.operation_id,'source_operation_id',payment.operation_id,'bank_account_id',p_bank_account_id,'reason','Destino seleccionado al registrar el cobro','correction_key',location_key),
      jsonb_build_array(jsonb_build_object('account','cash','amount',-payment.amount,'liquidity_location','cash','loan_id',loan.id),
        jsonb_build_object('account','cash','amount',payment.amount,'liquidity_location','bank','bank_account_id',p_bank_account_id,'loan_id',loan.id)));
  end if;
  return payment;
end $$;
revoke all on function public.record_located_loan_payment(uuid,text,date,numeric,numeric,numeric,text,uuid,text)from public,anon;
grant execute on function public.record_located_loan_payment(uuid,text,date,numeric,numeric,numeric,text,uuid,text)to authenticated;

-- A new bank receipt is annulled in one transaction from its chosen destination.
-- Historical location corrections keep their dedicated group undo.
alter function public.reverse_financial_operation(uuid,text,date,text)rename to receipt_destination_reverse_base;
revoke all on function public.receipt_destination_reverse_base(uuid,text,date,text)from public,anon,authenticated;
create function public.reverse_financial_operation(p_operation_id uuid,p_idempotency_key text,p_effective_date date,p_reason text)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare original public.financial_operations%rowtype;destination public.financial_operations%rowtype;
begin
  perform 1 from public.cycles where id=(select cycle_id from public.financial_operations where id=p_operation_id)for update;
  select * into original from public.financial_operations where id=p_operation_id;
  if original.operation_type in('loan_payment','loan_prepayment')then
    select * into destination from public.financial_operations c
      where c.operation_type='cash_location_corrected'and c.reference_id=original.id and c.idempotency_key=original.idempotency_key||':bank'
        and c.payload->>'reason'='Destino seleccionado al registrar el cobro'
        and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=c.id);
    if destination.id is not null then
      perform public.completion_reverse_base(destination.id,trim(p_idempotency_key)||':location',p_effective_date,p_reason);
    end if;
  end if;
  return public.receipt_destination_reverse_base(p_operation_id,p_idempotency_key,p_effective_date,p_reason);
end $$;
revoke all on function public.reverse_financial_operation(uuid,text,date,text)from public,anon;
grant execute on function public.reverse_financial_operation(uuid,text,date,text)to authenticated;
notify pgrst,'reload schema';
