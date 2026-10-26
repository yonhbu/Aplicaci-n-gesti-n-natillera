-- A settlement extinguishes debt, never creates another cash receipt.
-- Keep original financial operations, entries, snapshots and payment amounts intact.
create view public.loan_settlement_effects with(security_invoker=true) as
select a.id,a.workspace_id,a.cycle_id,a.loan_id,a.settlement_id,a.principal_amount,a.interest_amount,
 s.cut_date effective_date,s.status settlement_status,
 case when s.status='reversed' then coalesce(r.reversal_date,s.cut_date) else r.reversal_date end reversal_date
from public.member_settlement_debt_applications a
join public.member_settlements s on s.id=a.settlement_id
left join lateral(select min(o.effective_date) reversal_date from public.financial_operations o where o.reverses_operation_id=s.operation_id)r on true;
revoke all on public.loan_settlement_effects from public,anon;
grant select on public.loan_settlement_effects to authenticated;

create function public.loan_remaining_principal_at(p_loan_id uuid,p_cut_date date)
returns numeric language sql stable security invoker set search_path=public,pg_temp as $$
 select round(l.principal-l.legacy_paid_capital_amount
  -coalesce((select sum(p.capital_amount) from public.loan_payments p where p.loan_id=l.id and p.payment_date<=p_cut_date
    and (p.status='posted' or exists(select 1 from public.financial_operations r where r.reverses_operation_id=p.operation_id and r.effective_date>p_cut_date))
    and not exists(select 1 from public.financial_operations r where r.reverses_operation_id=p.operation_id and r.effective_date<=p_cut_date)),0)
  -coalesce((select sum(a.principal_amount) from public.loan_settlement_effects a where a.loan_id=l.id and a.effective_date<=p_cut_date and(a.reversal_date is null or a.reversal_date>p_cut_date)),0),2)
 from public.loan_contracts l where l.id=p_loan_id
$$;
revoke all on function public.loan_remaining_principal_at(uuid,date) from public,anon;
grant execute on function public.loan_remaining_principal_at(uuid,date) to authenticated;

create function public.settlement_close_satisfied_loan() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare cut date; remaining numeric;
begin
 select cut_date into cut from public.member_settlements where id=new.settlement_id and status<>'reversed';
 if cut is null then return new;end if;
 perform 1 from public.loan_contracts where id=new.loan_id for update;
 remaining:=public.loan_remaining_principal_at(new.loan_id,cut);
 if remaining<0 then raise exception 'La compensacion excede el capital pendiente del prestamo.';end if;
 if remaining=0 then
  if exists(select 1 from public.loan_payments where loan_id=new.loan_id and status='posted' and payment_date>cut)then raise exception 'La compensacion tiene cobros posteriores; requiere conciliacion.';end if;
  update public.loan_contracts set status='paid',cancelled_at=cut where id=new.loan_id and status='active';
 end if;
 return new;
end $$;
revoke all on function public.settlement_close_satisfied_loan() from public,anon,authenticated;
create trigger settlement_close_satisfied_loan after insert on public.member_settlement_debt_applications
 for each row execute function public.settlement_close_satisfied_loan();

-- Defence in depth if an old/stale caller or incorrect status tries to collect again.
-- Exact retries never insert a payment, and remain handled by the existing idempotency engine.
create function public.settlement_guard_loan_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
 perform 1 from public.cycles where id=(select cycle_id from public.loan_contracts where id=new.loan_id) for update;
 perform 1 from public.loan_contracts where id=new.loan_id for update;
 if exists(select 1 from public.loan_settlement_effects a where a.loan_id=new.loan_id and(a.reversal_date is null or a.reversal_date>new.payment_date)) then
  raise exception 'El prestamo tiene una compensacion de liquidacion; no se puede cobrar otra vez.';
 end if;
 return new;
end $$;
revoke all on function public.settlement_guard_loan_receipt() from public,anon,authenticated;
create trigger settlement_guard_loan_receipt before insert on public.loan_payments
 for each row execute function public.settlement_guard_loan_receipt();

-- Read-only schedule overlay. Original instalments and actual applications remain unchanged.
-- Extinguished future interest is CANCELLED, never described as interest paid.
create or replace view public.loan_schedule_progress with(security_invoker=true) as
select s.id,s.workspace_id,s.cycle_id,s.loan_id,s.installment_number,s.due_date,s.principal_due,s.interest_due,
 case when s.legacy_declared_paid then 'paid'
      when coalesce(a.capital,0)>=s.principal_due and coalesce(a.interest,0)>=s.interest_due and coalesce(a.capital,0)+coalesce(a.interest,0)>0 then 'paid'
      when c.closed then 'cancelled' else s.status end status,
 s.legacy_source_key,s.legacy_declared_paid,coalesce(a.capital,0) principal_paid,coalesce(a.interest,0) interest_paid,s.status source_status,
 coalesce(c.closed,false) and not s.legacy_declared_paid
   and not(coalesce(a.capital,0)>=s.principal_due and coalesce(a.interest,0)>=s.interest_due and coalesce(a.capital,0)+coalesce(a.interest,0)>0) closed_by_settlement
from public.loan_schedules s
left join lateral(select sum(pa.capital_amount)capital,sum(pa.interest_amount)interest
 from public.loan_payment_applications pa join public.loan_payments p on p.id=pa.payment_id where pa.schedule_id=s.id and p.status='posted')a on true
left join lateral(select l.status='paid' and exists(select 1 from public.loan_settlement_effects e where e.loan_id=l.id and e.principal_amount>0 and e.reversal_date is null)closed
 from public.loan_contracts l where l.id=s.loan_id)c on true;

-- Repair only derived closure metadata where recorded satisfaction proves zero debt.
-- No entry, receipt, historical amount, schedule or settlement snapshot is rewritten.
update public.loan_contracts l set status='paid',cancelled_at=a.cut
from(select loan_id,max(effective_date)cut from public.loan_settlement_effects where reversal_date is null group by loan_id)a
where l.id=a.loan_id and l.status='active' and public.loan_remaining_principal_at(l.id,a.cut)=0
 and not exists(select 1 from public.loan_payments p where p.loan_id=l.id and p.status='posted' and p.payment_date>a.cut);
notify pgrst,'reload schema';
