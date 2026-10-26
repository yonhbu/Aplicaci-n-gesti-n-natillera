-- FIN-RECON: additive capabilities. No historical balances or applied migrations are rewritten.
-- Personal funds are a separate asset/liability pair: never available to loans, savings or profit payments.
do $$ declare rule text; begin
 select pg_get_expr(conbin,conrelid) into rule from pg_constraint where conrelid='public.financial_operations'::regclass and conname='financial_operations_operation_type_check';
 alter table public.financial_operations drop constraint financial_operations_operation_type_check;
 execute format('alter table public.financial_operations add constraint financial_operations_operation_type_check check ((%s) or operation_type in (%L,%L))',rule,'personal_funds_received','personal_funds_returned');
 select pg_get_expr(conbin,conrelid) into rule from pg_constraint where conrelid='public.ledger_entries'::regclass and conname='ledger_entries_account_check';
 alter table public.ledger_entries drop constraint ledger_entries_account_check;
 execute format('alter table public.ledger_entries add constraint ledger_entries_account_check check ((%s) or account in (%L,%L))',rule,'personal_bank_cash','personal_funds_payable');
end $$;

create function public.assert_personal_funds_nonnegative(p_cycle_id uuid,p_bank_account_id uuid,p_owner text) returns void
language plpgsql security definer set search_path=public,pg_temp as $$ begin
 if exists(select 1 from(
   select sum(sum(e.amount))over(order by o.effective_date) balance
   from public.ledger_entries e join public.financial_operations o on o.id=e.operation_id
   left join public.financial_operations original on original.id=o.reverses_operation_id
   where e.cycle_id=p_cycle_id and e.account='personal_bank_cash'
     and coalesce(original.payload,o.payload)->>'bank_account_id'=p_bank_account_id::text
     and coalesce(original.payload,o.payload)->>'owner'=p_owner
   group by o.effective_date)t where balance<0)then
   raise exception 'El retiro supera el dinero personal documentado; revise el exceso antes de clasificarlo.';
 end if;
end $$;
revoke all on function public.assert_personal_funds_nonnegative(uuid,uuid,text) from public,anon,authenticated;

create function public.record_personal_funds(p_cycle_id uuid,p_bank_account_id uuid,p_idempotency_key text,p_effective_date date,p_amount numeric,p_direction text,p_reference text,p_note text,p_verified boolean)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype;previous public.financial_operations%rowtype;result public.financial_operations%rowtype;body jsonb;kind text;delta numeric;
begin
 select * into c from public.cycles where id=p_cycle_id for update;
 if c.id is null or auth.uid()is null or not public.current_user_is_workspace_admin(c.workspace_id)then raise exception 'No tiene permiso sobre este ciclo.';end if;
 body:=jsonb_build_object('bank_account_id',p_bank_account_id,'owner',auth.uid()::text,'amount',p_amount,'direction',p_direction,'reference',trim(p_reference),'note',trim(p_note),'verified',p_verified);
 kind:=case when p_direction='in' then 'personal_funds_received' when p_direction='out' then 'personal_funds_returned' else null end;
 select * into previous from public.financial_operations where workspace_id=c.workspace_id and idempotency_key=trim(p_idempotency_key);
 if previous.id is not null then
   if previous.cycle_id=c.id and previous.operation_type=kind and previous.effective_date=p_effective_date and previous.payload=body then return previous;end if;
   raise exception 'La clave del movimiento personal tiene otro contenido.';
 end if;
 if c.status<>'active' or p_effective_date is null or not isfinite(p_effective_date)or p_effective_date<c.starts_on or p_effective_date>least(c.closes_on,public.fin_civil_today())then raise exception 'Fecha o ciclo del movimiento personal invalido.';end if;
 if kind is null or p_verified is distinct from true or nullif(trim(p_reference),'')is null or nullif(trim(p_note),'')is null then raise exception 'Indique direccion, referencia, motivo y verificacion del movimiento personal.';end if;
 perform public.assert_money_2(p_amount,'movimiento personal',true);
 if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and workspace_id=c.workspace_id and status='active')then raise exception 'Cuenta bancaria no disponible.';end if;
 if exists(select 1 from public.financial_operations o where o.cycle_id=c.id and o.operation_type=kind and o.payload->>'bank_account_id'=p_bank_account_id::text and o.payload->>'owner'=auth.uid()::text and o.payload->>'reference'=trim(p_reference)and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=o.id))then raise exception 'La referencia personal ya fue registrada.';end if;
 delta:=case when p_direction='in' then p_amount else -p_amount end;
 result:=public.create_b_operation(c.workspace_id,c.id,p_idempotency_key,kind,p_effective_date,'bank_accounts',p_bank_account_id,body,
   jsonb_build_array(jsonb_build_object('account','personal_bank_cash','amount',delta),jsonb_build_object('account','personal_funds_payable','amount',-delta)));
 perform public.assert_personal_funds_nonnegative(c.id,p_bank_account_id,auth.uid()::text);
 return result;
end $$;
revoke all on function public.record_personal_funds(uuid,uuid,text,date,numeric,text,text,text,boolean) from public,anon;
grant execute on function public.record_personal_funds(uuid,uuid,text,date,numeric,text,text,text,boolean)to authenticated;

alter function public.reverse_financial_operation(uuid,text,date,text)rename to fin_recon_reverse_base;
revoke all on function public.fin_recon_reverse_base(uuid,text,date,text)from public,anon,authenticated;
create function public.reverse_financial_operation(p_operation_id uuid,p_idempotency_key text,p_effective_date date,p_reason text)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare original public.financial_operations%rowtype;result public.financial_operations%rowtype;
begin
 perform 1 from public.cycles where id=(select cycle_id from public.financial_operations where id=p_operation_id)for update;
 select * into original from public.financial_operations where id=p_operation_id;
 result:=public.fin_recon_reverse_base(p_operation_id,p_idempotency_key,p_effective_date,p_reason);
 if original.operation_type in('personal_funds_received','personal_funds_returned')then
   perform public.assert_personal_funds_nonnegative(original.cycle_id,(original.payload->>'bank_account_id')::uuid,original.payload->>'owner');
 end if;
 return result;
end $$;
revoke all on function public.reverse_financial_operation(uuid,text,date,text)from public,anon;
grant execute on function public.reverse_financial_operation(uuid,text,date,text)to authenticated;

-- A NULL bank now explicitly denotes cash; all existing bank calls keep their payload/idempotence.
create or replace function public.record_settlement_completion(p_cycle_member_id uuid,p_idempotency_key text,p_received_date date,p_amount numeric,p_bank_account_id uuid,p_reference text,p_cut_date date,p_annual_admin_fee numeric,p_penalty_amount numeric,p_other_discounts numeric,p_preview_hash text)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare cm public.cycle_members%rowtype;c public.cycles%rowtype;prior public.financial_operations%rowtype;payload jsonb;quote jsonb;
begin
  select * into c from public.cycles where id=(select cycle_id from public.cycle_members where id=p_cycle_member_id) for update;
  select * into cm from public.cycle_members where id=p_cycle_member_id for update;
  if cm.id is null or auth.uid()is null or not public.current_user_is_workspace_admin(cm.workspace_id)then raise exception 'No tiene permiso sobre este socio.';end if;
  payload:=jsonb_build_object('amount',p_amount,'reference',trim(p_reference),'bank_account_id',p_bank_account_id,'cycle_member_id',cm.id,'cut_date',p_cut_date,'annual_admin_fee',p_annual_admin_fee,'penalty',p_penalty_amount,'other_discounts',p_other_discounts,'preview_hash',p_preview_hash);
  select * into prior from public.financial_operations where workspace_id=cm.workspace_id and idempotency_key=trim(p_idempotency_key);
  if prior.id is not null then
    if prior.operation_type='member_settlement_completion'and prior.reference_id=cm.id and prior.effective_date=p_received_date and prior.payload=payload then return prior;end if;
    raise exception 'La clave del pago complementario tiene otro contenido.';
  end if;
  perform public.assert_money_2(p_amount,'pago complementario',true);
  if c.status<>'active' or cm.savings_status<>'active' or exists(select 1 from public.member_settlements where cycle_member_id=cm.id and status<>'reversed')then raise exception 'La cuenta final ya no admite pagos complementarios.';end if;
  if p_received_date is null or not isfinite(p_received_date)or p_received_date<c.starts_on or p_received_date>public.fin_civil_today()or p_received_date>p_cut_date or p_cut_date>public.fin_civil_today()then raise exception 'Fecha del pago complementario invalida; debe estar recibida al corte.';end if;
  if nullif(trim(p_reference),'')is null or length(trim(p_reference))>500 then raise exception 'Indique la referencia del dinero recibido.';end if;
  if p_bank_account_id is not null and not exists(select 1 from public.bank_accounts where id=p_bank_account_id and workspace_id=cm.workspace_id and status='active')then raise exception 'Cuenta bancaria no disponible.';end if;
  quote:=public.preview_member_settlement(cm.id,p_cut_date,p_annual_admin_fee,p_penalty_amount,p_other_discounts);
  if nullif(trim(p_preview_hash),'')is null or quote->>'preview_hash' is distinct from trim(p_preview_hash)then raise exception 'La previsualizacion esta obsoleta; calcule de nuevo antes de confirmar.';end if;
  if (quote->>'net')::numeric>=0 then raise exception 'Esta cuenta final no tiene faltante; no registre un pago complementario.';end if;
  if exists(select 1 from public.financial_operations o where o.workspace_id=cm.workspace_id and o.operation_type='member_settlement_completion'and o.payload->>'reference'=trim(p_reference)and(o.payload->>'bank_account_id')::uuid is not distinct from p_bank_account_id and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=o.id))then raise exception 'La referencia bancaria ya fue registrada.';end if;
  return public.create_b_operation(cm.workspace_id,cm.cycle_id,p_idempotency_key,'member_settlement_completion',p_received_date,'cycle_members',cm.id,payload,
    jsonb_build_array(jsonb_build_object('account','cash','amount',p_amount,'member_id',cm.member_id,'liquidity_location',case when p_bank_account_id is null then 'cash' else 'bank' end,'bank_account_id',p_bank_account_id),
      jsonb_build_object('account','settlement_completion_liability','amount',-p_amount,'member_id',cm.member_id)));
end $$;


notify pgrst,'reload schema';
