-- No existing financial rows are changed by this migration.
-- New receipts settle a dedicated member liability; they are neither savings nor profit.
do $$
declare rule text;
begin
  select pg_get_expr(conbin,conrelid) into rule from pg_constraint
    where conrelid='public.financial_operations'::regclass and conname='financial_operations_operation_type_check';
  alter table public.financial_operations drop constraint financial_operations_operation_type_check;
  execute format('alter table public.financial_operations add constraint financial_operations_operation_type_check check ((%s) or operation_type in (%L,%L))',rule,'member_settlement_completion','cash_location_corrected');
  select pg_get_expr(conbin,conrelid) into rule from pg_constraint
    where conrelid='public.ledger_entries'::regclass and conname='ledger_entries_account_check';
  alter table public.ledger_entries drop constraint ledger_entries_account_check;
  execute format('alter table public.ledger_entries add constraint ledger_entries_account_check check ((%s) or account=%L)',rule,'settlement_completion_liability');
end $$;

alter function public.preview_member_settlement(uuid,date,numeric,numeric,numeric) rename to completion_preview_base;
revoke all on function public.completion_preview_base(uuid,date,numeric,numeric,numeric) from public,anon,authenticated;
create function public.preview_member_settlement(p_cycle_member_id uuid,p_cut_date date,p_annual_admin_fee numeric,p_penalty_amount numeric,p_other_discounts numeric default 0)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare snapshot jsonb; received numeric; receipts jsonb; net numeric;
begin
  snapshot:=public.completion_preview_base(p_cycle_member_id,p_cut_date,p_annual_admin_fee,p_penalty_amount,p_other_discounts)-'preview_hash';
  select coalesce(-sum(e.amount),0) into received
    from public.ledger_entries e join public.financial_operations o on o.id=e.operation_id
    where e.account='settlement_completion_liability' and e.member_id=(snapshot->>'member_id')::uuid
      and e.cycle_id=(snapshot->>'cycle_id')::uuid and o.effective_date<=p_cut_date;
  select coalesce(jsonb_agg(jsonb_build_object('operation_id',o.id,'amount',o.payload->'amount','effective_date',o.effective_date,'reference',o.payload->>'reference') order by o.effective_date,o.id),'[]')
    into receipts from public.financial_operations o
    where o.operation_type='member_settlement_completion' and o.reference_id=p_cycle_member_id and o.effective_date<=p_cut_date
      and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=o.id and r.effective_date<=p_cut_date);
  if received<0 then raise exception 'Los pagos complementarios requieren revision.';end if;
  net:=round((snapshot->>'net')::numeric+received,2);
  snapshot:=snapshot||jsonb_build_object('completion_received',received,'completion_items',receipts,'net',net);
  -- Preserve all cents of a supplementary payment, including any excess in the member's favour.
  if received>0 then snapshot:=snapshot||jsonb_build_object('transfer_amount',net,'rounding_adjustment',0);end if;
  return snapshot||jsonb_build_object('preview_hash',md5(snapshot::text));
end $$;

-- Extend the existing confirmation instead of replacing its financial rules or triggers.
do $$
declare definition text; needle text:='entries := jsonb_build_array(';
begin
  select pg_get_functiondef('public.confirm_member_settlement(uuid,text,date,numeric,numeric,numeric,text)'::regprocedure) into definition;
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Confirmacion de cuenta final inesperada.';end if;
  definition:=replace(definition,needle,needle||E'\n    jsonb_build_object(''account'',''settlement_completion_liability'',''amount'',coalesce((preview->>''completion_received'')::numeric,0),''member_id'',cm.member_id),');
  execute definition;
end $$;
alter function public.confirm_member_settlement(uuid,text,date,numeric,numeric,numeric,text) rename to completion_confirm_base;
revoke all on function public.completion_confirm_base(uuid,text,date,numeric,numeric,numeric,text) from public,anon,authenticated;
create function public.confirm_member_settlement(p_cycle_member_id uuid,p_idempotency_key text,p_cut_date date,p_annual_admin_fee numeric,p_penalty_amount numeric,p_other_discounts numeric,p_preview_hash text)
returns public.member_settlements language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.cycles where id=(select cycle_id from public.cycle_members where id=p_cycle_member_id) for update;
  return public.completion_confirm_base(p_cycle_member_id,p_idempotency_key,p_cut_date,p_annual_admin_fee,p_penalty_amount,p_other_discounts,p_preview_hash);
end $$;

create function public.record_settlement_completion(p_cycle_member_id uuid,p_idempotency_key text,p_received_date date,p_amount numeric,p_bank_account_id uuid,p_reference text,p_cut_date date,p_annual_admin_fee numeric,p_penalty_amount numeric,p_other_discounts numeric,p_preview_hash text)
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
  if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and workspace_id=cm.workspace_id and status='active')then raise exception 'Cuenta bancaria no disponible.';end if;
  quote:=public.preview_member_settlement(cm.id,p_cut_date,p_annual_admin_fee,p_penalty_amount,p_other_discounts);
  if nullif(trim(p_preview_hash),'')is null or quote->>'preview_hash' is distinct from trim(p_preview_hash)then raise exception 'La previsualizacion esta obsoleta; calcule de nuevo antes de confirmar.';end if;
  if (quote->>'net')::numeric>=0 then raise exception 'Esta cuenta final no tiene faltante; no registre un pago complementario.';end if;
  if exists(select 1 from public.financial_operations o where o.workspace_id=cm.workspace_id and o.operation_type='member_settlement_completion'and o.payload->>'reference'=trim(p_reference)and(o.payload->>'bank_account_id')::uuid=p_bank_account_id and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=o.id))then raise exception 'La referencia bancaria ya fue registrada.';end if;
  return public.create_b_operation(cm.workspace_id,cm.cycle_id,p_idempotency_key,'member_settlement_completion',p_received_date,'cycle_members',cm.id,payload,
    jsonb_build_array(jsonb_build_object('account','cash','amount',p_amount,'member_id',cm.member_id,'liquidity_location','bank','bank_account_id',p_bank_account_id),
      jsonb_build_object('account','settlement_completion_liability','amount',-p_amount,'member_id',cm.member_id)));
end $$;

-- Correct the location of a receipt and every already posted annulment, each on its own date.
-- This is a classification correction, never a new payment or an actual cash-to-bank transfer.
create function public.correct_cash_loan_location(p_operation_id uuid,p_bank_account_id uuid,p_idempotency_key text,p_reason text)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare original public.financial_operations%rowtype;source public.financial_operations%rowtype;prior public.financial_operations%rowtype;created public.financial_operations%rowtype;result public.financial_operations%rowtype;payload jsonb;amount numeric;idx int:=0;
begin
  perform 1 from public.cycles where id=(select cycle_id from public.financial_operations where id=p_operation_id)for update;
  select * into original from public.financial_operations where id=p_operation_id for update;
  if original.id is null or auth.uid()is null or not public.current_user_is_workspace_admin(original.workspace_id)then raise exception 'No tiene permiso sobre este cobro.';end if;
  payload:=jsonb_build_object('root_operation_id',original.id,'bank_account_id',p_bank_account_id,'reason',trim(p_reason),'correction_key',trim(p_idempotency_key));
  select * into prior from public.financial_operations where workspace_id=original.workspace_id and idempotency_key=trim(p_idempotency_key);
  if prior.id is not null then
    if prior.operation_type='cash_location_corrected'and prior.payload @> payload then return prior;end if;
    raise exception 'La correccion de ubicacion ya tiene otro contenido.';
  end if;
  if not exists(select 1 from public.cycles where id=original.cycle_id and status='active')then raise exception 'El ciclo debe estar activo.';end if;
  if original.operation_type not in('loan_payment','loan_prepayment')or nullif(trim(p_reason),'')is null then raise exception 'Seleccione un cobro e indique la evidencia de su ubicacion real.';end if;
  if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and workspace_id=original.workspace_id and status='active')then raise exception 'Cuenta bancaria no disponible.';end if;
  if exists(select 1 from public.financial_operations o where o.operation_type='cash_location_corrected'and o.payload->>'root_operation_id'=original.id::text and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=o.id))then raise exception 'Este cobro ya tiene ubicacion corregida.';end if;
  if exists(select 1 from public.ledger_entries where operation_id=original.id and account='cash'and liquidity_location<>'cash')
    or coalesce((select sum(e.amount)from public.ledger_entries e where e.operation_id=original.id and e.account='cash'),0)<=0 then raise exception 'El cobro no esta registrado integramente en efectivo.';end if;
  if exists(select 1 from public.member_settlements where cycle_id=original.cycle_id and status<>'reversed')then raise exception 'Hay cuentas finales confirmadas; revise dependencias antes de corregir.';end if;
  for source in select * from public.financial_operations where id=original.id or reverses_operation_id=original.id order by effective_date,created_at,id loop
    select coalesce(sum(e.amount),0) into amount from public.ledger_entries e where e.operation_id=source.id and e.account='cash'and e.liquidity_location='cash';
    if amount=0 then continue;end if;
    created:=public.create_b_operation(original.workspace_id,original.cycle_id,case when idx=0 then p_idempotency_key else trim(p_idempotency_key)||':'||idx end,'cash_location_corrected',source.effective_date,'financial_operations',source.id,payload||jsonb_build_object('source_operation_id',source.id),
      jsonb_build_array(jsonb_build_object('account','cash','amount',-amount,'liquidity_location','cash'),jsonb_build_object('account','cash','amount',amount,'liquidity_location','bank','bank_account_id',p_bank_account_id)));
    if idx=0 then result:=created;end if;idx:=idx+1;
  end loop;
  return result;
end $$;

alter function public.reverse_financial_operation(uuid,text,date,text)rename to completion_reverse_base;
revoke all on function public.completion_reverse_base(uuid,text,date,text)from public,anon,authenticated;
create function public.reverse_financial_operation(p_operation_id uuid,p_idempotency_key text,p_effective_date date,p_reason text)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare original public.financial_operations%rowtype;
begin
  perform 1 from public.cycles where id=(select cycle_id from public.financial_operations where id=p_operation_id)for update;
  select * into original from public.financial_operations where id=p_operation_id;
  if original.operation_type='member_settlement_completion'and exists(select 1 from public.member_settlements s where s.cycle_member_id=original.reference_id and s.status<>'reversed')then raise exception 'El pago complementario ya respalda una cuenta final confirmada.';end if;
  if original.operation_type='cash_location_corrected'then raise exception 'Anule el grupo completo de correccion de ubicacion.';end if;
  if exists(select 1 from public.financial_operations c where c.operation_type='cash_location_corrected'and c.payload->>'root_operation_id'=original.id::text and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=c.id))then raise exception 'Primero anule la correccion de ubicacion de este cobro.';end if;
  return public.completion_reverse_base(p_operation_id,p_idempotency_key,p_effective_date,p_reason);
end $$;
create function public.annul_cash_loan_location(p_operation_id uuid,p_idempotency_key text,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare original public.financial_operations%rowtype;correction public.financial_operations%rowtype;group_key text;
begin
  perform 1 from public.cycles where id=(select cycle_id from public.financial_operations where id=p_operation_id)for update;
  select * into original from public.financial_operations where id=p_operation_id;
  if original.id is null or auth.uid()is null or not public.current_user_is_workspace_admin(original.workspace_id)then raise exception 'No tiene permiso sobre este cobro.';end if;
  if nullif(trim(p_reason),'')is null or length(trim(coalesce(p_idempotency_key,'')))<8 then raise exception 'Indique clave y motivo de la anulacion.';end if;
  if not exists(select 1 from public.cycles where id=original.cycle_id and status='active')then raise exception 'El ciclo debe estar activo.';end if;
  if exists(select 1 from public.member_settlements where cycle_id=original.cycle_id and status<>'reversed')then raise exception 'Hay cuentas finales confirmadas; revise dependencias antes de anular.';end if;
  select c.payload->>'correction_key' into group_key from public.financial_operations c join public.financial_operations r on r.reverses_operation_id=c.id
    where c.operation_type='cash_location_corrected'and c.payload->>'root_operation_id'=original.id::text and r.idempotency_key=trim(p_idempotency_key)||':'||c.id::text limit 1;
  if group_key is null then
    select c.payload->>'correction_key' into group_key from public.financial_operations c
      where c.operation_type='cash_location_corrected'and c.reference_id=original.id
        and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=c.id)
      order by c.created_at desc,c.id desc limit 1;
  end if;
  if group_key is null then raise exception 'No hay correccion de ubicacion para anular.';end if;
  for correction in select * from public.financial_operations c where c.operation_type='cash_location_corrected'and c.payload->>'root_operation_id'=original.id::text and c.payload->>'correction_key'=group_key order by c.effective_date,c.created_at,c.id loop
    perform public.completion_reverse_base(correction.id,trim(p_idempotency_key)||':'||correction.id::text,correction.effective_date,trim(p_reason));
  end loop;
end $$;

revoke all on function public.preview_member_settlement(uuid,date,numeric,numeric,numeric),public.confirm_member_settlement(uuid,text,date,numeric,numeric,numeric,text),
 public.record_settlement_completion(uuid,text,date,numeric,uuid,text,date,numeric,numeric,numeric,text),public.correct_cash_loan_location(uuid,uuid,text,text),
 public.reverse_financial_operation(uuid,text,date,text),public.annul_cash_loan_location(uuid,text,text)from public,anon;
grant execute on function public.preview_member_settlement(uuid,date,numeric,numeric,numeric),public.confirm_member_settlement(uuid,text,date,numeric,numeric,numeric,text),
 public.record_settlement_completion(uuid,text,date,numeric,uuid,text,date,numeric,numeric,numeric,text),public.correct_cash_loan_location(uuid,uuid,text,text),
 public.reverse_financial_operation(uuid,text,date,text),public.annul_cash_loan_location(uuid,text,text)to authenticated;
notify pgrst,'reload schema';
