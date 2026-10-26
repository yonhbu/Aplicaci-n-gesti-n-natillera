-- FIN-QA-010. Rights are fixed at receipt time. Existing history is not rewritten.
create table public.bank_yield_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  cycle_id uuid not null references public.cycles(id),
  operation_id uuid not null unique references public.financial_operations(id),
  effective_date date not null,
  net_amount numeric(18,2) not null check (net_amount > 0),
  unassigned_amount numeric(18,2) not null default 0 check (unassigned_amount >= 0),
  state text not null check (state in ('frozen','pending_review')),
  source text not null check (source in ('receipt','historical_reconciliation')),
  evidence text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create table public.bank_yield_rights (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  cycle_id uuid not null references public.cycles(id),
  receipt_id uuid not null references public.bank_yield_receipts(id),
  cycle_member_id uuid not null references public.cycle_members(id),
  member_id uuid not null references public.members(id),
  amount numeric(18,2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  unique(receipt_id, cycle_member_id)
);
alter table public.bank_yield_receipts enable row level security;
alter table public.bank_yield_rights enable row level security;
create policy "workspace admins read fixed receipts" on public.bank_yield_receipts for select to authenticated using(public.current_user_is_workspace_admin(workspace_id));
create policy "workspace admins read fixed rights" on public.bank_yield_rights for select to authenticated using(public.current_user_is_workspace_admin(workspace_id));
revoke all on public.bank_yield_receipts, public.bank_yield_rights from anon, authenticated;
grant select on public.bank_yield_receipts, public.bank_yield_rights to authenticated;

create function public.qa010_lock_member_cycle() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform 1 from public.cycles where id=new.cycle_id for update;
  return new;
end; $$;
-- Acquire the cycle lock before the mode-validation trigger reads financial history.
create trigger a_qa010_member_cycle_lock before insert or update on public.cycle_members for each row execute function public.qa010_lock_member_cycle();

create function public.qa010_freeze_receipt() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare receipt_id uuid; cents bigint; pending boolean;
begin
  if new.operation_type <> 'bank_interest_received' then return new; end if;
  if not exists(select 1 from public.cycles where id=new.cycle_id and settlement_rules_version='fin03-2026') then return new; end if;
  perform 1 from public.cycles where id=new.cycle_id for update;
  cents := round((new.payload->>'net')::numeric*100);
  -- Backdated receipts cannot silently increase a right already settled.
  pending := exists(select 1 from public.member_settlements s where s.cycle_id=new.cycle_id and s.status<>'reversed' and s.cut_date>=new.effective_date);
  insert into public.bank_yield_receipts(workspace_id,cycle_id,operation_id,effective_date,net_amount,state,source,created_by)
  values(new.workspace_id,new.cycle_id,new.id,new.effective_date,cents/100.0,case when pending then 'pending_review' else 'frozen' end,'receipt',auth.uid()) returning id into receipt_id;
  if not pending then
    insert into public.bank_yield_rights(workspace_id,cycle_id,receipt_id,cycle_member_id,member_id,amount)
    with eligible as (
      select cm.id,cm.member_id,row_number() over(order by m.display_name,cm.id) rn,count(*) over() n
      from public.cycle_members cm join public.members m on m.id=cm.member_id
      where cm.cycle_id=new.cycle_id and cm.economic_mode='collective' and cm.participates_in_polla
        and cm.participation_start_month<=extract(month from new.effective_date)::int
        and not exists(select 1 from public.member_settlements s where s.cycle_member_id=cm.id and s.status<>'reversed' and s.cut_date<new.effective_date)
        and (cm.savings_status='active' or exists(select 1 from public.member_settlements s where s.cycle_member_id=cm.id and s.status<>'reversed'))
    ), shares as (
      select *, (floor(cents/n)+case when rn<=cents-floor(cents/n)*n then 1 else 0 end)/100.0 amount from eligible
    ) select new.workspace_id,new.cycle_id,receipt_id,id,member_id,amount from shares where amount>0;
  end if;
  update public.bank_yield_receipts r set unassigned_amount=r.net_amount-coalesce((select sum(br.amount) from public.bank_yield_rights br where br.receipt_id=r.id),0) where r.id=receipt_id;
  return new;
end; $$;
create trigger qa010_freeze_bank_receipt after insert on public.financial_operations for each row execute function public.qa010_freeze_receipt();

create or replace function public.bank_yield_shares(p_cycle_id uuid,p_cut_date date)
returns table(operation_id uuid,effective_date date,cycle_member_id uuid,member_id uuid,amount numeric)
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
  if exists(
    select 1 from public.financial_operations fo left join public.bank_yield_receipts r on r.operation_id=fo.id
    where fo.cycle_id=p_cycle_id and fo.operation_type='bank_interest_received' and fo.effective_date<=p_cut_date
      and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=fo.id)
      and (r.id is null or r.state<>'frozen')
  ) then raise exception 'Hay abonos Pibank historicos pendientes de conciliacion explicita; no se recalculan derechos ya liquidados.'; end if;
  return query select r.operation_id,r.effective_date,br.cycle_member_id,br.member_id,br.amount
    from public.bank_yield_receipts r join public.bank_yield_rights br on br.receipt_id=r.id
    where r.cycle_id=p_cycle_id and r.effective_date<=p_cut_date and r.state='frozen'
      and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=r.operation_id);
end; $$;

create or replace function public.preview_bank_yield_distribution(p_cycle_id uuid,p_cut_date date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; net numeric(18,2); paid numeric(18,2); already numeric(18,2); unassigned numeric(18,2);
  pending integer; unresolved integer; rights_total numeric(18,2); pool numeric(18,2); beneficiaries jsonb; snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into c from public.cycles where id=p_cycle_id;
  if c.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(c.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_cut_date is null or not isfinite(p_cut_date) then raise exception 'Fecha de corte invalida.'; end if;
  select round(coalesce(sum(le.amount),0),2) into net from public.financial_operations fo join public.ledger_entries le on le.operation_id=fo.id
    where fo.cycle_id=p_cycle_id and fo.operation_type='bank_interest_received' and fo.effective_date<=p_cut_date and le.account='cash'
      and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=fo.id);
  -- Confirmed amounts are authoritative, regardless of subsequent membership changes.
  select round(coalesce(sum((s.snapshot->>'bank_yield_share')::numeric),0),2) into paid from public.member_settlements s
    where s.cycle_id=p_cycle_id and s.status<>'reversed' and s.cut_date<=p_cut_date;
  select coalesce(sum(d.pool_amount),0) into already from public.bank_yield_distributions d where d.cycle_id=p_cycle_id and d.status='confirmed' and d.cut_date<=p_cut_date;
  select count(*) into pending from public.financial_operations fo left join public.bank_yield_receipts r on r.operation_id=fo.id
    where fo.cycle_id=p_cycle_id and fo.operation_type='bank_interest_received' and fo.effective_date<=p_cut_date
      and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=fo.id)
      and (r.id is null or r.state<>'frozen');
  select coalesce(sum(r.unassigned_amount),0) into unassigned from public.bank_yield_receipts r where r.cycle_id=p_cycle_id and r.effective_date<=p_cut_date and r.state='frozen'
    and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=r.operation_id);
  select coalesce(jsonb_agg(jsonb_build_object('cycle_member_id',x.cmid,'member_id',x.mid,'display_name',x.name,'amount',x.total) order by x.name,x.cmid),'[]'),coalesce(sum(x.total),0)
    into beneficiaries,rights_total from (
      select br.cycle_member_id cmid,br.member_id mid,m.display_name name,sum(br.amount) total
      from public.bank_yield_rights br join public.bank_yield_receipts r on r.id=br.receipt_id join public.members m on m.id=br.member_id
      where r.cycle_id=p_cycle_id and r.state='frozen' and r.effective_date<=p_cut_date
        and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=r.operation_id)
        and not exists(select 1 from public.member_settlements s where s.cycle_member_id=br.cycle_member_id and s.status<>'reversed' and s.cut_date>=r.effective_date and s.cut_date<=p_cut_date)
        and already=0
      group by br.cycle_member_id,br.member_id,m.display_name
    ) x;
  select count(*) into unresolved from public.fin03_member_mode_issues i where i.cycle_id=p_cycle_id and i.economic_mode='collective';
  pool:=greatest(net-paid-already-unassigned,0);
  snapshot:=jsonb_build_object('rule_version','fin-qa010-frozen-rights-v1','cycle_id',p_cycle_id,'cut_date',p_cut_date,
    'net_received',net,'recognized_in_withdrawals',paid,'already_distributed',already,'unassigned',unassigned,'savers_reserved',0,
    'pool',pool,'beneficiaries',beneficiaries,'beneficiary_count',jsonb_array_length(beneficiaries),
    'per_member',coalesce((select min((b->>'amount')::numeric) from jsonb_array_elements(beneficiaries) b),0),
    'per_member_max',coalesce((select max((b->>'amount')::numeric) from jsonb_array_elements(beneficiaries) b),0),
    'residual_to_admin',0,'shortfall',greatest(paid+already-net,0),'unresolved_members',unresolved,'unresolved_receipts',pending,
    'rights_mismatch',round(rights_total-pool,2),'confirmation_allowed',pool>0 and pending=0 and unresolved=0 and rights_total=pool and paid+already<=net and already=0);
  return snapshot||jsonb_build_object('preview_hash',md5(snapshot::text));
end; $$;

-- Controlled reconciliation records explicit evidence, not a redistribution based on today's members.
create function public.reconcile_bank_yield_receipt(p_operation_id uuid,p_rights jsonb,p_evidence text)
returns public.bank_yield_receipts language plpgsql security definer set search_path=public,pg_temp as $$
declare op public.financial_operations%rowtype; r public.bank_yield_receipts%rowtype; item jsonb; cm public.cycle_members%rowtype;
  total numeric(18,2):=0; net numeric(18,2); value numeric(18,2);
begin
  select * into op from public.financial_operations where id=p_operation_id;
  if op.id is null or op.operation_type<>'bank_interest_received' then raise exception 'Abono Pibank no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(op.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  perform 1 from public.cycles where id=op.cycle_id for update;
  if length(trim(coalesce(p_evidence,'')))<12 or jsonb_typeof(p_rights)<>'array' or p_rights is null then raise exception 'Indique derechos explicitos y evidencia de conciliacion.'; end if;
  if exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=op.id) then raise exception 'El abono fue revertido.'; end if;
  select * into r from public.bank_yield_receipts where operation_id=op.id;
  if r.id is not null then
    if r.state='frozen' then
      if r.source='historical_reconciliation' and r.evidence=trim(p_evidence)
        and coalesce((select jsonb_agg(jsonb_build_object('cycle_member_id',br.cycle_member_id,'amount',br.amount) order by br.cycle_member_id) from public.bank_yield_rights br where br.receipt_id=r.id),'[]')
          =coalesce((select jsonb_agg(jsonb_build_object('cycle_member_id',(j->>'cycle_member_id')::uuid,'amount',(j->>'amount')::numeric) order by (j->>'cycle_member_id')::uuid) from jsonb_array_elements(p_rights) j),'[]') then return r; end if;
      raise exception 'Los derechos ya estan congelados; una correccion requiere revision trazable.';
    end if;
    if exists(select 1 from public.bank_yield_rights where receipt_id=r.id) then raise exception 'Hay derechos existentes que no pueden reemplazarse.'; end if;
  end if;
  if exists(select 1 from public.bank_yield_distributions d where d.cycle_id=op.cycle_id and d.status='confirmed') then raise exception 'El ciclo ya tiene reparto confirmado.'; end if;
  select round(sum(amount),2) into net from public.ledger_entries where operation_id=op.id and account='cash';
  if r.id is null then
    insert into public.bank_yield_receipts(workspace_id,cycle_id,operation_id,effective_date,net_amount,state,source,evidence,created_by)
      values(op.workspace_id,op.cycle_id,op.id,op.effective_date,net,'pending_review','historical_reconciliation',trim(p_evidence),auth.uid()) returning * into r;
  end if;
  for item in select * from jsonb_array_elements(p_rights) loop
    select * into cm from public.cycle_members where id=(item->>'cycle_member_id')::uuid and cycle_id=op.cycle_id;
    if cm.id is null then raise exception 'Participacion fuera del ciclo.'; end if;
    if cm.economic_mode<>'collective' or not cm.participates_in_polla then raise exception 'La conciliacion Pibank requiere una participacion colectiva verificada.'; end if;
    perform public.assert_money_2((item->>'amount')::numeric,'derecho Pibank',true);
    value:=(item->>'amount')::numeric;
    insert into public.bank_yield_rights(workspace_id,cycle_id,receipt_id,cycle_member_id,member_id,amount)
      values(op.workspace_id,op.cycle_id,r.id,cm.id,cm.member_id,value);
    total:=total+value;
    if exists(select 1 from public.member_settlements s where s.cycle_member_id=cm.id and s.status<>'reversed' and s.cut_date>=op.effective_date
      and coalesce((s.snapshot->>'bank_yield_share')::numeric,0)<(select coalesce(sum(br.amount),0) from public.bank_yield_rights br join public.bank_yield_receipts rr on rr.id=br.receipt_id where br.cycle_member_id=cm.id and rr.effective_date<=s.cut_date
        and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=rr.operation_id))) then
      raise exception 'La conciliacion aumentaria un derecho ya liquidado; requiere correccion financiera explicita.';
    end if;
  end loop;
  if total>net then raise exception 'Los derechos superan el neto recibido.'; end if;
  update public.bank_yield_receipts set state='frozen',source='historical_reconciliation',evidence=trim(p_evidence),created_by=auth.uid(),unassigned_amount=net-total where id=r.id returning * into r;
  return r;
end; $$;

create function public.qa010_guard_distribution() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare preview jsonb;
begin
  perform 1 from public.cycles where id=new.cycle_id for update;
  preview:=public.preview_bank_yield_distribution(new.cycle_id,new.cut_date);
  if not (preview->>'confirmation_allowed')::boolean or new.pool_amount<>(preview->>'pool')::numeric or new.preview_hash is distinct from preview->>'preview_hash' then
    raise exception 'El reparto no concilia con lo recibido, los derechos congelados y las liquidaciones confirmadas.';
  end if;
  return new;
end; $$;
create trigger qa010_guard_distribution before insert on public.bank_yield_distributions for each row execute function public.qa010_guard_distribution();

revoke all on function public.qa010_lock_member_cycle(),public.qa010_freeze_receipt(),public.qa010_guard_distribution() from public,anon,authenticated;
revoke all on function public.bank_yield_shares(uuid,date) from public,anon,authenticated;
revoke all on function public.reconcile_bank_yield_receipt(uuid,jsonb,text) from public,anon;
grant execute on function public.reconcile_bank_yield_receipt(uuid,jsonb,text) to authenticated;
