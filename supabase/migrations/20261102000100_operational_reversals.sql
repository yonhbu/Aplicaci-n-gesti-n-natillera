-- Correcciones operativas: deshacer con asientos inversos y entidades sincronizadas.
-- No borra movimientos ni cambia las reglas de intereses, premios o comisiones.
do $$ declare rule text; begin
  select pg_get_expr(conbin,conrelid) into rule from pg_constraint
    where conrelid='public.financial_operations'::regclass and conname='financial_operations_operation_type_check';
  alter table public.financial_operations drop constraint financial_operations_operation_type_check;
  execute format('alter table public.financial_operations add constraint financial_operations_operation_type_check check (%s or operation_type = %L)',rule,'polla_prize_cancelled');
end $$;

-- Solo lo invoca el flujo coordinado, despues de validar sus dependencias.
create function public.ops_reverse_prize_component(p_original_id uuid,p_key text,p_date date,p_reason text,p_prize_id uuid)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare original public.financial_operations%rowtype; result public.financial_operations%rowtype; entries jsonb;
begin
  select * into original from public.financial_operations where id=p_original_id for update;
  if original.id is null or original.operation_type not in ('polla_prize_awarded','polla_prize_credited','polla_prize_paid') then raise exception 'Componente de premio invalido.'; end if;
  if exists(select 1 from public.financial_operations where reverses_operation_id=original.id) then raise exception 'La operacion ya tiene reverso.'; end if;
  if p_date<original.effective_date then raise exception 'El reverso no puede ser anterior al registro.'; end if;
  select jsonb_agg(jsonb_build_object('account',account,'amount',-amount,'member_id',member_id,'loan_id',loan_id,
    'polla_activity_id',polla_activity_id,'prize_id',prize_id,'liquidity_location',liquidity_location,'bank_account_id',bank_account_id))
    into entries from public.ledger_entries where operation_id=original.id;
  result:=public.create_b_operation(original.workspace_id,original.cycle_id,p_key,'polla_prize_cancelled',p_date,
    'financial_operations',original.id,jsonb_build_object('prize_id',p_prize_id,'reason',trim(p_reason),'reverses_operation_id',original.id),entries);
  update public.financial_operations set reverses_operation_id=original.id where id=result.id returning * into result;
  return result;
end $$;
revoke all on function public.ops_reverse_prize_component(uuid,text,date,text,uuid) from public,anon,authenticated;

create function public.reverse_polla_prize(p_prize_id uuid,p_idempotency_key text,p_effective_date date,p_reason text)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.polla_prizes%rowtype; c public.member_capital_credits%rowtype; pay public.polla_prize_payments%rowtype;
  result public.financial_operations%rowtype; cycle_status text; member_key uuid;
begin
  select * into p from public.polla_prizes where id=p_prize_id;
  if p.id is null then raise exception 'Premio no encontrado.'; end if;
  if auth.uid() is null or not public.current_user_is_workspace_admin(p.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  select status into cycle_status from public.cycles where id=p.cycle_id for update;
  select * into p from public.polla_prizes where id=p_prize_id for update;
  select * into result from public.financial_operations where workspace_id=p.workspace_id and idempotency_key=trim(p_idempotency_key);
  if result.id is not null then
    if result.operation_type='polla_prize_cancelled' and result.payload->>'prize_id'=p.id::text and result.payload->>'reason'=trim(p_reason) and result.effective_date=p_effective_date then return result; end if;
    raise exception 'La clave de idempotencia del reverso ya existe con otro contenido.';
  end if;
  if cycle_status<>'active' then raise exception 'El ciclo debe estar activo para revertir.'; end if;
  if nullif(trim(p_idempotency_key),'') is null or nullif(trim(p_reason),'') is null then raise exception 'El reverso requiere clave y motivo.'; end if;
  if p_effective_date is null or not isfinite(p_effective_date) or p_effective_date>public.fin_civil_today() then raise exception 'Fecha de reverso invalida.'; end if;
  if p.status='reversed' then raise exception 'El premio ya fue revertido.'; end if;
  select member_id into member_key from public.cycle_members where id=p.winner_cycle_member_id;
  if exists(select 1 from public.member_settlement_prize_applications where prize_id=p.id)
     or exists(select 1 from public.member_settlements where cycle_member_id=p.winner_cycle_member_id and status<>'reversed') then
    raise exception 'El premio tiene una liquidacion dependiente; no se puede revertir por separado.';
  end if;
  if -(select coalesce(sum(amount),0) from public.ledger_entries where cycle_id=p.cycle_id and account='admin_payable')<p.admin_commission then
    raise exception 'La comision del premio ya se utilizo; debe resolverse ese retiro antes del reverso.';
  end if;
  select * into c from public.member_capital_credits where prize_id=p.id and reversed_at is null for update;
  select * into pay from public.polla_prize_payments where prize_id=p.id and status='posted' for update;
  if c.id is not null and -(select coalesce(sum(amount),0) from public.ledger_entries where cycle_id=p.cycle_id and member_id=member_key and account='savings_liability')<c.amount then
    raise exception 'El capital del premio ya se utilizo; no se puede revertir por separado.';
  end if;
  if pay.id is not null then
    perform public.ops_reverse_prize_component(pay.operation_id,trim(p_idempotency_key)||':payment',p_effective_date,p_reason,p.id);
    update public.polla_prize_payments set status='reversed' where id=pay.id;
  end if;
  if c.id is not null then
    result:=public.ops_reverse_prize_component(c.operation_id,trim(p_idempotency_key)||':capital',p_effective_date,p_reason,p.id);
    update public.member_capital_credits set reversed_at=now(),reversal_operation_id=result.id where id=c.id;
  end if;
  result:=public.ops_reverse_prize_component(p.award_operation_id,trim(p_idempotency_key),p_effective_date,p_reason,p.id);
  update public.polla_prizes set status='reversed',paid_operation_id=null where id=p.id;
  update public.polla_activities set status='open' where id=p.activity_id
    and not exists(select 1 from public.polla_prizes where activity_id=p.activity_id and status<>'reversed');
  return result;
end $$;
revoke all on function public.reverse_polla_prize(uuid,text,date,text) from public,anon;
grant execute on function public.reverse_polla_prize(uuid,text,date,text) to authenticated;

-- Mantiene el motor existente para pagos, aportes y movimientos bancarios.
alter function public.reverse_financial_operation(uuid,text,date,text) rename to ops_reverse_financial_operation_base;
revoke all on function public.ops_reverse_financial_operation_base(uuid,text,date,text) from public,anon,authenticated;
create function public.reverse_financial_operation(p_operation_id uuid,p_idempotency_key text,p_effective_date date,p_reason text)
returns public.financial_operations language plpgsql security definer set search_path=public,pg_temp as $$
declare original public.financial_operations%rowtype; p public.polla_prizes%rowtype; cycle_status text;
  cash_row record; available numeric; reopen boolean; result public.financial_operations%rowtype;
begin
  select * into original from public.financial_operations where id=p_operation_id;
  if original.id is null then raise exception 'Operacion original no encontrada.'; end if;
  if auth.uid() is null or not public.current_user_is_workspace_admin(original.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  select status into cycle_status from public.cycles where id=original.cycle_id for update;
  if original.operation_type='polla_prize_cancelled' then raise exception 'No se reversa un reverso.'; end if;
  if original.operation_type in ('polla_prize_awarded','polla_prize_credited') then
    select * into p from public.polla_prizes where award_operation_id=original.id or id=original.reference_id;
    return public.reverse_polla_prize(p.id,p_idempotency_key,p_effective_date,p_reason);
  end if;
  if exists(select 1 from public.financial_operations where workspace_id=original.workspace_id and idempotency_key=trim(p_idempotency_key)) then
    return public.ops_reverse_financial_operation_base(p_operation_id,p_idempotency_key,p_effective_date,p_reason);
  end if;
  if cycle_status<>'active' then raise exception 'El ciclo debe estar activo para revertir.'; end if;
  if p_effective_date is null or not isfinite(p_effective_date) or p_effective_date<original.effective_date or p_effective_date>public.fin_civil_today() then raise exception 'Fecha de reverso invalida.'; end if;
  if original.operation_type in ('loan_payment','loan_prepayment') then
    if exists(select 1 from public.loan_payments p1 join public.loan_payments p2 on p2.loan_id=p1.loan_id
      where p1.operation_id=original.id and p2.status='posted' and (p2.payment_date,p2.created_at,p2.id)>(p1.payment_date,p1.created_at,p1.id)) then
      raise exception 'Primero revierta los cobros posteriores de este prestamo.';
    end if;
    if exists(select 1 from public.loan_contracts l join public.member_settlements s on s.member_id=l.borrower_member_id and s.cycle_id=l.cycle_id
      where l.id=original.reference_id and s.status<>'reversed') then raise exception 'El cobro tiene una liquidacion dependiente; no se puede revertir por separado.'; end if;
  end if;
  if original.operation_type='polla_contribution' and exists(select 1 from public.polla_contributions pc join public.polla_prizes pp on pp.activity_id=pc.activity_id
      where pc.operation_id=original.id and pp.status<>'reversed') then raise exception 'Primero revierta el premio de esta polla antes de retirar sus aportes.'; end if;
  if original.operation_type='savings_contribution_linked' and exists(select 1 from public.savings_contributions sc join public.member_settlements s on s.cycle_member_id=sc.cycle_member_id
      where sc.id=original.reference_id and s.status<>'reversed') then raise exception 'El aporte tiene una liquidacion dependiente; no se puede revertir por separado.'; end if;
  for cash_row in select liquidity_location,bank_account_id,sum(amount) amount from public.ledger_entries where operation_id=original.id and account='cash' group by liquidity_location,bank_account_id having sum(amount)>0 loop
    if cash_row.liquidity_location='unknown' then
      select coalesce(sum(le.amount),0) into available from public.ledger_entries le join public.financial_operations fo on fo.id=le.operation_id
        where le.cycle_id=original.cycle_id and le.account='cash' and le.liquidity_location='unknown' and fo.effective_date<=p_effective_date;
    else available:=public.cash_available_at(original.cycle_id,p_effective_date,cash_row.liquidity_location,cash_row.bank_account_id); end if;
    if available<cash_row.amount then
      raise exception 'El dinero de este registro ya se utilizo; no hay saldo suficiente para revertirlo.';
    end if;
  end loop;
  reopen:=original.operation_type in ('loan_payment','loan_prepayment') and exists(select 1 from public.loan_contracts where id=original.reference_id and status='paid');
  result:=public.ops_reverse_financial_operation_base(p_operation_id,p_idempotency_key,p_effective_date,p_reason);
  if reopen then update public.loan_schedules set status='projected' where loan_id=original.reference_id and status='cancelled'; end if;
  return result;
end $$;
revoke all on function public.reverse_financial_operation(uuid,text,date,text) from public,anon;
grant execute on function public.reverse_financial_operation(uuid,text,date,text) to authenticated;

alter table public.polla_activities add column cancelled_at timestamptz,
  add column cancellation jsonb;
create function public.cancel_polla_activity(p_activity_id uuid,p_idempotency_key text,p_reason text)
returns public.polla_activities language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.polla_activities%rowtype; cycle_status text;
begin
  select * into a from public.polla_activities where id=p_activity_id;
  if a.id is null then raise exception 'Actividad no encontrada.'; end if;
  if auth.uid() is null or not public.current_user_is_workspace_admin(a.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  select status into cycle_status from public.cycles where id=a.cycle_id for update;
  select * into a from public.polla_activities where id=a.id for update;
  if a.cancelled_at is not null then
    if a.cancellation->>'key'=trim(p_idempotency_key) and a.cancellation->>'reason'=trim(p_reason) then return a; end if;
    raise exception 'Esta polla ya fue cancelada.';
  end if;
  if cycle_status<>'active' then raise exception 'El ciclo debe estar activo para revertir.'; end if;
  if nullif(trim(p_idempotency_key),'') is null or nullif(trim(p_reason),'') is null then raise exception 'El reverso requiere clave y motivo.'; end if;
  if exists(select 1 from public.polla_contributions where activity_id=a.id and status='posted')
    or exists(select 1 from public.polla_prizes where activity_id=a.id and status<>'reversed') then
    raise exception 'Primero revierta el premio y los aportes de esta polla.';
  end if;
  update public.polla_activities set cancelled_at=now(),status='closed',
    cancellation=jsonb_build_object('key',trim(p_idempotency_key),'reason',trim(p_reason),'name',a.name,'user',auth.uid()),
    name=a.name||' [cancelada '||a.id::text||']' where id=a.id returning * into a;
  return a;
end $$;
revoke all on function public.cancel_polla_activity(uuid,text,text) from public,anon;
grant execute on function public.cancel_polla_activity(uuid,text,text) to authenticated;

create function public.ops_guard_cancelled_polla() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.polla_activities where id=new.activity_id and cancelled_at is not null) then raise exception 'Esta polla fue cancelada; cree una nueva para registrar aportes o premios.'; end if;
  return new;
end $$;
create trigger ops_guard_cancelled_polla_contribution before insert on public.polla_contributions for each row execute function public.ops_guard_cancelled_polla();
create trigger ops_guard_cancelled_polla_prize before insert on public.polla_prizes for each row execute function public.ops_guard_cancelled_polla();
