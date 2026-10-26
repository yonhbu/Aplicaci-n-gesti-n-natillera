-- FIN-QA-009/008. Explicit applications; dated verified payments are preserved.
create table public.loan_payment_applications (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  cycle_id uuid not null references public.cycles(id),
  loan_id uuid not null references public.loan_contracts(id),
  payment_id uuid not null references public.loan_payments(id),
  schedule_id uuid references public.loan_schedules(id),
  capital_amount numeric(18,2) not null check(capital_amount>=0),
  interest_amount numeric(18,2) not null check(interest_amount>=0),
  source text not null check(source in ('regular','prepayment','verified_history')),
  rule_version text not null default 'fin-qa009-explicit-v1',
  created_at timestamptz not null default now(),
  check(capital_amount+interest_amount>0)
);
create unique index loan_application_payment_schedule on public.loan_payment_applications(payment_id,schedule_id) nulls not distinct;
alter table public.loan_payment_applications enable row level security;
create policy "workspace admins read loan applications" on public.loan_payment_applications for select to authenticated using(public.current_user_is_workspace_admin(workspace_id));
revoke all on public.loan_payment_applications from anon,authenticated;
grant select on public.loan_payment_applications to authenticated;

create view public.loan_schedule_progress with(security_invoker=true) as
select s.id,s.workspace_id,s.cycle_id,s.loan_id,s.installment_number,s.due_date,s.principal_due,s.interest_due,
  case when s.legacy_declared_paid then 'paid'
       when coalesce(a.capital,0)>=s.principal_due and coalesce(a.interest,0)>=s.interest_due and coalesce(a.capital,0)+coalesce(a.interest,0)>0 then 'paid'
       else s.status end status,
  s.legacy_source_key,s.legacy_declared_paid,
  coalesce(a.capital,0) principal_paid,coalesce(a.interest,0) interest_paid,
  s.status source_status
from public.loan_schedules s left join lateral (
  select sum(pa.capital_amount) capital,sum(pa.interest_amount) interest
  from public.loan_payment_applications pa join public.loan_payments p on p.id=pa.payment_id
  where pa.schedule_id=s.id and p.status='posted'
) a on true;
grant select on public.loan_schedule_progress to authenticated;

-- Internal application helper: never changes the payment, its split, or its ledger.
create function public.qa009_apply_verified_payment(p_payment_id uuid,p_source text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare p public.loan_payments%rowtype; s record; cap numeric(18,2); intr numeric(18,2); c numeric(18,2); i numeric(18,2);
begin
  select * into p from public.loan_payments where id=p_payment_id;
  if p.id is null or p.status<>'posted' or exists(select 1 from public.loan_payment_applications where payment_id=p.id) then return; end if;
  cap:=p.capital_amount; intr:=p.interest_amount;
  for s in select * from public.loan_schedule_progress where loan_id=p.loan_id and not legacy_declared_paid order by installment_number,id loop
    c:=least(cap,greatest(s.principal_due-s.principal_paid,0));
    i:=case when p.kind='prepayment' then 0 else least(intr,greatest(s.interest_due-s.interest_paid,0)) end;
    if c+i>0 then
      insert into public.loan_payment_applications(workspace_id,cycle_id,loan_id,payment_id,schedule_id,capital_amount,interest_amount,source)
      values(p.workspace_id,p.cycle_id,p.loan_id,p.id,s.id,c,i,p_source);
      cap:=cap-c; intr:=intr-i;
    end if;
  end loop;
  -- Non-installment interest on a full prepayment remains explicit, without closing a future interest quota.
  if cap+intr>0 then
    insert into public.loan_payment_applications(workspace_id,cycle_id,loan_id,payment_id,schedule_id,capital_amount,interest_amount,source)
    values(p.workspace_id,p.cycle_id,p.loan_id,p.id,null,cap,intr,p_source);
  end if;
end; $$;
revoke all on function public.qa009_apply_verified_payment(uuid,text) from public,anon,authenticated;

-- Only actual dated posted payments are projected. Boolean legacy declarations create no payment or cash.
do $$ declare p record; begin
  for p in select id from public.loan_payments where status='posted' order by payment_date,created_at,id loop
    perform public.qa009_apply_verified_payment(p.id,'verified_history');
  end loop;
end; $$;

create function public.quote_loan_payment(p_loan_id uuid,p_payment_date date,p_amount numeric)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.loan_contracts%rowtype; interest_due numeric(18,2); capital_due numeric(18,2); i numeric(18,2); c numeric(18,2);
begin
  select * into l from public.loan_contracts where id=p_loan_id;
  if l.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(l.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if l.status<>'active' then raise exception 'Solo se cobran prestamos activos desembolsados.'; end if;
  if p_payment_date is null or not isfinite(p_payment_date) or p_payment_date<l.start_date then raise exception 'Fecha de cobro invalida.'; end if;
  perform public.assert_money_2(p_amount,'pago',true);
  if exists(select 1 from public.loan_payments where loan_id=l.id and status='posted' and payment_date>p_payment_date) then raise exception 'Hay cobros posteriores: no se puede insertar un abono retroactivo sin conciliacion.'; end if;
  select coalesce(sum(greatest(s.interest_due-s.interest_paid,0)),0),coalesce(sum(greatest(s.principal_due-s.principal_paid,0)),0)
    into interest_due,capital_due from public.loan_schedule_progress s where s.loan_id=l.id and s.due_date<=p_payment_date and s.source_status<>'cancelled' and not s.legacy_declared_paid;
  i:=least(p_amount,interest_due); c:=p_amount-i;
  if c>capital_due then raise exception 'El pago excede las cuotas exigibles. Los abonos extraordinarios requieren definir reduccion de plazo o cuota.'; end if;
  return jsonb_build_object('loan_id',l.id,'payment_date',p_payment_date,'amount',p_amount,'capital_amount',c,'interest_amount',i,'rule_version','fin-qa009-interest-first-v1');
end; $$;

-- Replace only the API boundary; retain the existing cash/10-90/idempotency engine.
alter function public.record_loan_payment(uuid,text,date,numeric,numeric,numeric,text) rename to qa009_record_loan_payment_base;
revoke all on function public.qa009_record_loan_payment_base(uuid,text,date,numeric,numeric,numeric,text) from public,anon,authenticated;

create or replace function public.record_loan_payment(p_loan_id uuid,p_idempotency_key text,p_payment_date date,p_amount numeric,p_capital_amount numeric,p_interest_amount numeric,p_kind text default 'regular')
returns public.loan_payments language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.loan_contracts%rowtype; result public.loan_payments%rowtype; plan jsonb; existing boolean;
begin
  select * into l from public.loan_contracts where id=p_loan_id;
  if l.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(l.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform 1 from public.cycles where id=l.cycle_id for update;
  select * into l from public.loan_contracts where id=p_loan_id for update;
  existing:=exists(select 1 from public.loan_payments where workspace_id=l.workspace_id and idempotency_key=trim(p_idempotency_key));
  if not existing and coalesce(p_kind,'regular')='regular' and l.rate_unit='EA' and l.method='amortized' and l.settlement_agreement_code is distinct from 'P013_FIRST_MONTH' then
    plan:=public.quote_loan_payment(p_loan_id,p_payment_date,p_amount);
    if p_capital_amount is distinct from (plan->>'capital_amount')::numeric or p_interest_amount is distinct from (plan->>'interest_amount')::numeric then
      raise exception 'La aplicacion debe cubrir primero intereses exigibles y despues capital, desde la cuota mas antigua.';
    end if;
  end if;
  if not existing and p_kind='prepayment' then
    plan:=public.quote_loan_prepayment(p_loan_id,p_payment_date);
    if p_amount is distinct from (plan->>'total_due')::numeric or p_capital_amount is distinct from (plan->>'principal_due')::numeric or p_interest_amount is distinct from (plan->>'interest_due')::numeric then
      raise exception 'El prepago debe coincidir con la cotizacion efectiva del servidor.';
    end if;
  end if;
  result:=public.qa009_record_loan_payment_base(p_loan_id,p_idempotency_key,p_payment_date,p_amount,p_capital_amount,p_interest_amount,p_kind);
  perform public.qa009_apply_verified_payment(result.id,coalesce(p_kind,'regular'));
  return result;
end; $$;

create or replace function public.quote_loan_prepayment(p_loan_id uuid,p_quote_date date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.loan_contracts%rowtype; principal_due numeric(18,2); interest_paid numeric(18,2); interest_due numeric(18,2);
  covered date; cursor_date date; balance numeric; accrued numeric:=0; paid_uncovered numeric; s record; pay record; version text;
begin
  select * into l from public.loan_contracts where id=p_loan_id;
  if l.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(l.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if l.status<>'active' then raise exception 'Solo se cotizan prepagos de prestamos activos.'; end if;
  if p_quote_date is null or not isfinite(p_quote_date) or p_quote_date<l.start_date then raise exception 'Fecha de prepago invalida.'; end if;
  if exists(select 1 from public.loan_payments where loan_id=l.id and status='posted' and payment_date>p_quote_date) then raise exception 'Hay cobros posteriores: el prepago retroactivo requiere conciliacion.'; end if;
  select round(l.principal-coalesce(l.legacy_paid_capital_amount,0)-coalesce(sum(p.capital_amount),0),2),round(coalesce(l.legacy_paid_interest_amount,0)+coalesce(sum(p.interest_amount),0),2)
    into principal_due,interest_paid from public.loan_payments p where p.loan_id=l.id and p.status='posted';
  if l.settlement_agreement_code='P013_FIRST_MONTH' or l.rate_unit<>'EA' or l.method<>'amortized' then
    interest_due:=greatest(round(coalesce(l.prepayment_first_month_interest,0)-interest_paid,2),0);
    version:=case when l.settlement_agreement_code='P013_FIRST_MONTH' then 'P013_FIRST_MONTH' else 'contract-fixed-policy' end;
    covered:=null;
  else
    if coalesce(l.legacy_paid_interest_amount,0)>0 or exists(select 1 from public.loan_schedules where loan_id=l.id and legacy_declared_paid) then
      raise exception 'Los intereses historicos no tienen periodo verificado. Concilie la cobertura antes de cotizar el prepago EA.';
    end if;
    if exists(select 1 from public.loan_payment_applications a join public.loan_payments p on p.id=a.payment_id where a.loan_id=l.id and a.schedule_id is null and p.status='posted' and a.interest_amount>0) then
      raise exception 'Hay intereses sin periodo conciliado. Verifique su cobertura antes del prepago EA.';
    end if;
    covered:=l.start_date;
    for s in select * from public.loan_schedule_progress where loan_id=l.id and due_date<=p_quote_date order by installment_number,id loop
      if s.interest_paid>=s.interest_due then covered:=s.due_date; else exit; end if;
    end loop;
    select l.principal-coalesce(l.legacy_paid_capital_amount,0)-coalesce(sum(capital_amount),0) into balance from public.loan_payments where loan_id=l.id and status='posted' and payment_date<=covered;
    cursor_date:=covered;
    -- Capital changes within an uncovered period split accrual; a partial interest payment does not reset coverage.
    for pay in select payment_date,sum(capital_amount) capital from public.loan_payments where loan_id=l.id and status='posted' and payment_date>covered and payment_date<=p_quote_date group by payment_date order by payment_date loop
      accrued:=accrued+balance*(power(1+l.rate_value,(pay.payment_date-cursor_date)::numeric/365)-1);
      balance:=balance-pay.capital; cursor_date:=pay.payment_date;
    end loop;
    accrued:=accrued+balance*(power(1+l.rate_value,(p_quote_date-cursor_date)::numeric/365)-1);
    select coalesce(sum(p.interest_amount),0)-coalesce((select sum(a.interest_amount) from public.loan_payment_applications a join public.loan_schedules quota on quota.id=a.schedule_id join public.loan_payments pp on pp.id=a.payment_id where a.loan_id=l.id and pp.status='posted' and quota.due_date<=covered),0)
      into paid_uncovered from public.loan_payments p where p.loan_id=l.id and p.status='posted';
    interest_due:=greatest(round(accrued-paid_uncovered,2),0); version:='fin-qa008-ea-act365f-v1';
  end if;
  return jsonb_build_object('loan_id',l.id,'quote_date',p_quote_date,'principal_due',principal_due,'interest_due',interest_due,'total_due',round(principal_due+interest_due,2),'interest_covered_until',covered,'rule_version',version);
end; $$;

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
  return public.record_loan_payment(p_loan_id,p_idempotency_key,p_payment_date,(q->>'total_due')::numeric,(q->>'principal_due')::numeric,(q->>'interest_due')::numeric,'prepayment');
end; $$;

revoke all on function public.quote_loan_payment(uuid,date,numeric) from public,anon;
revoke all on function public.record_loan_payment(uuid,text,date,numeric,numeric,numeric,text) from public,anon;
grant execute on function public.quote_loan_payment(uuid,date,numeric) to authenticated;
grant execute on function public.record_loan_payment(uuid,text,date,numeric,numeric,numeric,text),public.quote_loan_prepayment(uuid,date),public.confirm_loan_prepayment(uuid,text,date) to authenticated;
