-- Bind a visible EA quotation to confirmation while preserving older RPC callers.
-- Also upgrade draft installations whose member lock had run after mode validation.
drop trigger if exists qa010_member_cycle_lock on public.cycle_members;
drop trigger if exists a_qa010_member_cycle_lock on public.cycle_members;
create trigger a_qa010_member_cycle_lock before insert or update on public.cycle_members
for each row execute function public.qa010_lock_member_cycle();
alter table public.loan_payments add column calculation_snapshot jsonb;
alter function public.quote_loan_prepayment(uuid,date) rename to qa008_quote_loan_prepayment_base;
revoke all on function public.qa008_quote_loan_prepayment_base(uuid,date) from public,anon,authenticated;
create function public.quote_loan_prepayment(p_loan_id uuid,p_quote_date date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare q jsonb;
begin
  q:=public.qa008_quote_loan_prepayment_base(p_loan_id,p_quote_date);
  return q||jsonb_build_object('quote_hash',md5(q::text));
end; $$;
revoke all on function public.quote_loan_prepayment(uuid,date) from public,anon;
grant execute on function public.quote_loan_prepayment(uuid,date) to authenticated;

create or replace function public.confirm_loan_prepayment(p_loan_id uuid,p_idempotency_key text,p_payment_date date)
returns public.loan_payments language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.loan_contracts%rowtype; q jsonb; p public.loan_payments%rowtype;
begin
  select * into l from public.loan_contracts where id=p_loan_id;
  if l.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(l.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform 1 from public.cycles where id=l.cycle_id for update;
  perform 1 from public.loan_contracts where id=l.id for update;
  select * into p from public.loan_payments where workspace_id=l.workspace_id and idempotency_key=trim(p_idempotency_key);
  if p.id is not null then
    if p.loan_id=l.id and p.payment_date=p_payment_date and p.kind='prepayment' then return p; end if;
    raise exception 'La clave de idempotencia del cobro ya existe con otro contenido.';
  end if;
  q:=public.quote_loan_prepayment(p_loan_id,p_payment_date);
  p:=public.record_loan_payment(p_loan_id,p_idempotency_key,p_payment_date,(q->>'total_due')::numeric,(q->>'principal_due')::numeric,(q->>'interest_due')::numeric,'prepayment');
  update public.loan_payments set calculation_snapshot=q where id=p.id returning * into p;
  return p;
end; $$;

create function public.confirm_loan_prepayment(p_loan_id uuid,p_idempotency_key text,p_payment_date date,p_quote_hash text)
returns public.loan_payments language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.loan_contracts%rowtype; q jsonb; p public.loan_payments%rowtype;
begin
  select * into l from public.loan_contracts where id=p_loan_id;
  if l.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(l.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform 1 from public.cycles where id=l.cycle_id for update;
  perform 1 from public.loan_contracts where id=l.id for update;
  select * into p from public.loan_payments where workspace_id=l.workspace_id and idempotency_key=trim(p_idempotency_key);
  if p.id is not null then
    if p.loan_id=l.id and p.payment_date=p_payment_date and p.kind='prepayment' and p.calculation_snapshot->>'quote_hash'=p_quote_hash then return p; end if;
    raise exception 'La clave de idempotencia del cobro ya existe con otro contenido.';
  end if;
  q:=public.quote_loan_prepayment(p_loan_id,p_payment_date);
  if p_quote_hash is null or p_quote_hash is distinct from q->>'quote_hash' then raise exception 'La cotizacion cambio. Vuelva a calcular antes de confirmar el prepago.'; end if;
  return public.confirm_loan_prepayment(p_loan_id,p_idempotency_key,p_payment_date);
end; $$;
revoke all on function public.confirm_loan_prepayment(uuid,text,date,text) from public,anon;
grant execute on function public.confirm_loan_prepayment(uuid,text,date,text) to authenticated;
