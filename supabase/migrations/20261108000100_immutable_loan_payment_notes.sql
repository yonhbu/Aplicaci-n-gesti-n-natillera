-- Optional receipt annotation. No financial rule, historical receipt or ledger is rewritten.
alter table public.loan_payments add column note text
  check (note is null or (char_length(note)<=500 and note !~ '[[:cntrl:]]'));

-- The wrapper supplies insert-only context while the existing financial RPC owns
-- the receipt/ledger transaction. All later note edits, including null -> text,
-- are forbidden; reversals may still change the receipt status normally.
create function public.loan_payment_note_guard() returns trigger
language plpgsql set search_path=public,pg_temp as $$
declare context jsonb;
begin
  if tg_op='UPDATE' then
    if new.note is distinct from old.note then raise exception 'La nota del cobro es inmutable.'; end if;
  else
    context:=nullif(current_setting('natillera.loan_payment_note',true),'')::jsonb;
    if context->>'loan_id'=new.loan_id::text and context->>'key'=new.idempotency_key then
      new.note:=context->>'note';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.loan_payment_note_guard() from public,anon,authenticated;
create trigger loan_payment_note_guard before insert or update on public.loan_payments
for each row execute function public.loan_payment_note_guard();

create function public.record_noted_loan_payment(
  p_loan_id uuid,p_idempotency_key text,p_payment_date date,p_amount numeric,
  p_capital_amount numeric,p_interest_amount numeric,p_kind text,p_bank_account_id uuid,
  p_quote_hash text default null,p_note text default null)
returns public.loan_payments language plpgsql security definer set search_path=public,pg_temp as $$
declare loan public.loan_contracts%rowtype; previous public.loan_payments%rowtype;
  payment public.loan_payments%rowtype; canonical_note text; previous_context text;
begin
  perform 1 from public.cycles where id=(select cycle_id from public.loan_contracts where id=p_loan_id) for update;
  select * into loan from public.loan_contracts where id=p_loan_id for update;
  if loan.id is null or auth.uid() is null or not public.current_user_is_workspace_admin(loan.workspace_id) then
    raise exception 'No tiene permiso sobre este prestamo.';
  end if;
  if char_length(p_note)>500 or p_note ~ '[[:cntrl:]]' then
    raise exception 'La nota debe tener maximo 500 caracteres y no contener caracteres de control.';
  end if;
  canonical_note:=nullif(btrim(p_note),'');
  select * into previous from public.loan_payments where workspace_id=loan.workspace_id and idempotency_key=btrim(p_idempotency_key);
  if previous.id is not null and previous.note is distinct from canonical_note then
    raise exception 'La clave de idempotencia del cobro ya existe con otra nota.';
  end if;
  previous_context:=current_setting('natillera.loan_payment_note',true);
  perform set_config('natillera.loan_payment_note',jsonb_build_object('loan_id',p_loan_id,'key',btrim(p_idempotency_key),'note',canonical_note)::text,true);
  payment:=public.record_located_loan_payment(p_loan_id,p_idempotency_key,p_payment_date,p_amount,p_capital_amount,p_interest_amount,p_kind,p_bank_account_id,p_quote_hash);
  perform set_config('natillera.loan_payment_note',coalesce(previous_context,''),true);
  return payment;
end $$;
revoke all on function public.record_noted_loan_payment(uuid,text,date,numeric,numeric,numeric,text,uuid,text,text) from public,anon;
grant execute on function public.record_noted_loan_payment(uuid,text,date,numeric,numeric,numeric,text,uuid,text,text) to authenticated;

create function public.confirm_noted_loan_prepayment(
  p_loan_id uuid,p_idempotency_key text,p_payment_date date,p_quote_hash text,
  p_bank_account_id uuid default null,p_note text default null)
returns public.loan_payments language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_quote_hash is null or btrim(p_quote_hash)='' then
    raise exception 'La cotizacion cambio. Vuelva a calcular antes de confirmar el prepago.';
  end if;
  return public.record_noted_loan_payment(p_loan_id,p_idempotency_key,p_payment_date,null,null,null,'prepayment',p_bank_account_id,p_quote_hash,p_note);
end $$;
revoke all on function public.confirm_noted_loan_prepayment(uuid,text,date,text,uuid,text) from public,anon;
grant execute on function public.confirm_noted_loan_prepayment(uuid,text,date,text,uuid,text) to authenticated;
notify pgrst,'reload schema';
