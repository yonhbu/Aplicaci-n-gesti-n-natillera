-- Fase A. No source amounts, source identities or statements are embedded here.
create table public.legacy_reconciliations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  cycle_id uuid not null unique,
  idempotency_key text not null,
  preview_hash text not null,
  snapshot jsonb not null,
  operation_ids uuid[] not null default '{}',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  reverse_key text,
  reverse_reason text,
  reversed_at timestamptz,
  foreign key(workspace_id,cycle_id) references public.cycles(workspace_id,id),
  unique(workspace_id,idempotency_key)
);
alter table public.legacy_reconciliations enable row level security;
create policy "admins read initial reconciliation" on public.legacy_reconciliations for select to authenticated using(public.current_user_is_workspace_admin(workspace_id));
revoke all on public.legacy_reconciliations from public,anon,authenticated;
grant select on public.legacy_reconciliations to authenticated;

-- Preserve the complete current allowlist rather than replacing earlier migrations.
do $$ declare expression text; begin
  select pg_get_constraintdef(oid) into expression from pg_constraint where conrelid='public.financial_operations'::regclass and conname='financial_operations_operation_type_check';
  alter table public.financial_operations drop constraint financial_operations_operation_type_check;
  execute 'alter table public.financial_operations add constraint financial_operations_operation_type_check check (('||substr(expression,8,length(expression)-8)||') or operation_type in (''legacy_loan_interest_correction'',''legacy_loan_cash_correction'',''legacy_fine_reclassification'',''admin_fine_received''))';
end $$;

create function public.reconciliation_balances(p_cycle_id uuid) returns jsonb
language sql stable security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(to_jsonb(b) order by account,liquidity_location,bank_account_id),'[]') from
  (select account,liquidity_location,bank_account_id,sum(amount) amount from public.ledger_entries where cycle_id=p_cycle_id group by 1,2,3) b;
$$;
revoke all on function public.reconciliation_balances(uuid) from public,anon,authenticated;

create function public.preview_legacy_reconciliation(p_cycle_id uuid) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; previous public.legacy_reconciliations%rowtype; r record; bank uuid; transfer_date date;
  items jsonb:='[]'; entries jsonb; before_balances jsonb; after_balances jsonb; snapshot jsonb; fine_ids jsonb; fines numeric; total_interest numeric:=0; net_cash numeric:=0; equity numeric; fingerprint text;
begin
  select * into c from public.cycles where id=p_cycle_id;
  if c.id is null or auth.uid() is null or not public.current_user_is_workspace_admin(c.workspace_id) then raise exception 'No tiene permiso sobre este ciclo.'; end if;
  select * into previous from public.legacy_reconciliations where cycle_id=c.id;
  if previous.id is not null then return jsonb_build_object('state',case when previous.reversed_at is null then 'applied' else 'reversed' end,'reconciliation_id',previous.id,'snapshot',previous.snapshot,'balances_now',public.reconciliation_balances(c.id)); end if;
  if c.status<>'active' or c.settlement_rules_version is distinct from 'fin03-2026' then raise exception 'La conciliacion requiere ciclo activo y FIN-03 aprobada.'; end if;
  if exists(select 1 from public.member_settlements where cycle_id=c.id and status<>'reversed') or exists(select 1 from public.loan_profit_period_distributions where cycle_id=c.id and status<>'reversed') or exists(select 1 from public.loan_profit_distributions where cycle_id=c.id and status<>'reversed') then raise exception 'Hay liquidaciones o repartos dependientes; requiere revision especifica.'; end if;
  if not exists(select 1 from public.legacy_operational_import_batches where cycle_id=c.id and status='imported') then raise exception 'No hay un lote inicial importado para conciliar.'; end if;
  if (select count(*) from public.financial_operations o where o.cycle_id=c.id and o.operation_type='liquidity_transfer' and o.payload->>'from_location'='unknown' and o.payload->>'to_location'='bank' and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=o.id))<>1 then raise exception 'Se requiere un unico traslado vigente del saldo inicial al banco.'; end if;
  select (o.payload->>'to_bank_account_id')::uuid,o.effective_date into bank,transfer_date from public.financial_operations o where o.cycle_id=c.id and o.operation_type='liquidity_transfer' and o.payload->>'from_location'='unknown' and o.payload->>'to_location'='bank' and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=o.id);
  if bank is null or not exists(select 1 from public.bank_accounts where id=bank and workspace_id=c.workspace_id and status='active') then raise exception 'Cuenta inicial no disponible.'; end if;
  if transfer_date>public.fin_civil_today() then raise exception 'El traslado inicial tiene fecha futura.'; end if;
  if exists(select 1 from public.loan_contracts l where l.cycle_id=c.id and l.legacy_id is not null and
     (l.legacy_paid_capital_amount<>(select coalesce(sum(principal_due),0) from public.loan_schedules where loan_id=l.id and legacy_declared_paid) or
      l.legacy_paid_interest_amount<>(select coalesce(sum(interest_due),0) from public.loan_schedules where loan_id=l.id and legacy_declared_paid))) then raise exception 'Las cuotas pagadas no coinciden con el capital e interes iniciales.'; end if;
  if exists(select 1 from public.loan_schedules where cycle_id=c.id and legacy_declared_paid and due_date>public.fin_civil_today()) then raise exception 'Hay cuotas iniciales pagadas con fecha futura; requiere revision.'; end if;
  for r in select s.* from public.loan_schedules s join public.loan_contracts l on l.id=s.loan_id where s.cycle_id=c.id and l.legacy_id is not null and s.legacy_declared_paid and s.interest_due>0 order by s.due_date,s.id loop
    entries:=jsonb_build_array(jsonb_build_object('account','legacy_migration_equity','amount',r.interest_due,'loan_id',r.loan_id),jsonb_build_object('account','admin_payable','amount',-round(r.interest_due*.10,2),'loan_id',r.loan_id),jsonb_build_object('account','member_loan_profit_fund','amount',-(r.interest_due-round(r.interest_due*.10,2)),'loan_id',r.loan_id));
    items:=items||jsonb_build_array(jsonb_build_object('part','A1','type','legacy_loan_interest_correction','date',r.due_date,'reference_table','loan_schedules','reference_id',r.id,'payload',jsonb_build_object('loan_id',r.loan_id,'schedule_id',r.id,'interest',r.interest_due,'date_basis','scheduled_due_date_not_actual_collection','cash_effect',false),'entries',entries));
    total_interest:=total_interest+r.interest_due;
  end loop;
  for r in select l.*,principal-legacy_paid_capital_amount-legacy_paid_interest_amount net from public.loan_contracts l where cycle_id=c.id and legacy_id is not null order by legacy_id,id loop
    net_cash:=net_cash+r.net;
    if r.net=0 then continue; end if;
    entries:=jsonb_build_array(jsonb_build_object('account','cash','amount',-r.net,'loan_id',r.id,'liquidity_location','bank','bank_account_id',bank),jsonb_build_object('account','legacy_migration_equity','amount',r.net,'loan_id',r.id));
    items:=items||jsonb_build_array(jsonb_build_object('part','A2','type','legacy_loan_cash_correction','date',transfer_date,'reference_table','loan_contracts','reference_id',r.id,'payload',jsonb_build_object('loan_id',r.id,'net_cash',r.net,'bank_account_id',bank,'date_basis','initial_bank_location_transfer'),'entries',entries));
  end loop;
  select coalesce(sum(e.amount),0) into equity from public.ledger_entries e where cycle_id=c.id and account='legacy_migration_equity';
  if total_interest+net_cash<=0 or equity+total_interest+net_cash<>0 then raise exception 'La contrapartida inicial no concilia con los prestamos; no se aplica un ajuste arbitrario.'; end if;
  select coalesce(jsonb_agg(distinct o.id order by o.id),'[]'),coalesce(-sum(e.amount),0) into fine_ids,fines from public.financial_operations o join public.ledger_entries e on e.operation_id=o.id and e.account='common_income' where o.cycle_id=c.id and o.operation_type='manual_income' and lower(o.payload->>'category')='multa' and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=o.id);
  if fines>0 then items:=items||jsonb_build_array(jsonb_build_object('part','A3','type','legacy_fine_reclassification','date',public.fin_civil_today(),'reference_table','cycles','reference_id',c.id,'payload',jsonb_build_object('amount',fines,'source_operation_ids',fine_ids),'entries',jsonb_build_array(jsonb_build_object('account','common_income','amount',fines),jsonb_build_object('account','admin_payable','amount',-fines)))); end if;
  before_balances:=public.reconciliation_balances(c.id);
  select coalesce(jsonb_agg(to_jsonb(t)order by account,liquidity_location,bank_account_id),'[]') into after_balances from(
    select account,liquidity_location,bank_account_id,sum(amount) amount from(
      select e.account,e.liquidity_location,e.bank_account_id,e.amount from public.ledger_entries e where e.cycle_id=c.id
      union all select e->>'account',coalesce(e->>'liquidity_location','unknown'),(e->>'bank_account_id')::uuid,(e->>'amount')::numeric from jsonb_array_elements(items) i cross join lateral jsonb_array_elements(i->'entries')e
    )a group by 1,2,3)t;
  -- Bind the quote to all ledger, domain and source rows; any intervening write invalidates it.
  select md5(coalesce(string_agg(x,'|'order by x),'')) into fingerprint from(
    select to_jsonb(o)::text x from public.financial_operations o where cycle_id=c.id union all
    select to_jsonb(e)::text from public.ledger_entries e where cycle_id=c.id union all
    select to_jsonb(l)::text from public.loan_contracts l where cycle_id=c.id union all
    select to_jsonb(s)::text from public.loan_schedules s where cycle_id=c.id union all
    select to_jsonb(b)::text from public.legacy_operational_import_batches b where cycle_id=c.id
  ) source;
  snapshot:=jsonb_build_object('state','ready','cycle',to_jsonb(c),'bank_account_id',bank,'transfer_date',transfer_date,'operations',items,'before',before_balances,'after',after_balances,'source_fingerprint',fingerprint,'historic_interest',total_interest,'net_cash_correction',net_cash,'fines',fines);
  return snapshot||jsonb_build_object('preview_hash',md5(snapshot::text));
end $$;

create function public.confirm_legacy_reconciliation(p_cycle_id uuid,p_idempotency_key text,p_preview_hash text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; previous public.legacy_reconciliations%rowtype; q jsonb; item jsonb; op public.financial_operations%rowtype; ids uuid[]:='{}'; bank uuid; step numeric; actual numeric;
begin
  select * into c from public.cycles where id=p_cycle_id for update;
  if c.id is null or auth.uid() is null or not public.current_user_is_workspace_admin(c.workspace_id) then raise exception 'No tiene permiso sobre este ciclo.'; end if;
  if length(trim(coalesce(p_idempotency_key,'')))<8 then raise exception 'Clave de idempotencia invalida.'; end if;
  select * into previous from public.legacy_reconciliations where cycle_id=c.id;
  if previous.id is not null then
    if previous.idempotency_key=trim(p_idempotency_key) and previous.preview_hash is distinct from p_preview_hash then raise exception 'La clave de confirmacion tiene otro hash.'; end if;
    return jsonb_build_object('state',case when previous.reversed_at is null then 'applied' else 'reversed' end,'reconciliation_id',previous.id,'operation_ids',previous.operation_ids);
  end if;
  q:=public.preview_legacy_reconciliation(c.id);
  if nullif(p_preview_hash,'') is null or p_preview_hash is distinct from q->>'preview_hash' then raise exception 'La conciliacion cambio; vuelva a previsualizar.'; end if;
  bank:=(q->>'bank_account_id')::uuid;
  for item in select * from jsonb_array_elements(q->'operations') loop
    op:=public.create_b_operation(c.workspace_id,c.id,trim(p_idempotency_key)||':'||(cardinality(ids)+1)::text,item->>'type',(item->>'date')::date,item->>'reference_table',(item->>'reference_id')::uuid,(item->'payload')||jsonb_build_object('reconciliation_key',trim(p_idempotency_key)),item->'entries');
    ids:=array_append(ids,op.id);
    -- Check every chronological bank cut, not merely the final balance.
    for step in select sum(delta)over(order by d) from(select o.effective_date d,sum(e.amount)delta from public.ledger_entries e join public.financial_operations o on o.id=e.operation_id where e.cycle_id=c.id and e.account='cash' and e.bank_account_id=bank group by o.effective_date)t loop
      if step<0 then raise exception 'La correccion dejaria el banco negativo en un corte.'; end if;
    end loop;
  end loop;
  select coalesce(sum(amount),0) into actual from public.ledger_entries where cycle_id=c.id and account='legacy_migration_equity';
  if actual<>0 then raise exception 'La contrapartida inicial no quedo en cero.'; end if;
  insert into public.legacy_reconciliations(workspace_id,cycle_id,idempotency_key,preview_hash,snapshot,operation_ids,created_by)values(c.workspace_id,c.id,trim(p_idempotency_key),p_preview_hash,q,ids,auth.uid())returning * into previous;
  return jsonb_build_object('state','applied','reconciliation_id',previous.id,'operation_ids',ids,'balances',public.reconciliation_balances(c.id));
end $$;

-- Prevent a generic undo from splitting an atomic reconciliation.
alter function public.reverse_financial_operation(uuid,text,date,text) rename to phasea_reverse_base;
revoke all on function public.phasea_reverse_base(uuid,text,date,text) from public,anon,authenticated;
create function public.reverse_financial_operation(p_operation_id uuid,p_idempotency_key text,p_effective_date date,p_reason text)returns public.financial_operations
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.financial_operations where id=p_operation_id and operation_type in('legacy_loan_interest_correction','legacy_loan_cash_correction','legacy_fine_reclassification'))then raise exception 'Use el reverso completo de la conciliacion.'; end if;
  return public.phasea_reverse_base(p_operation_id,p_idempotency_key,p_effective_date,p_reason);
end $$;

create function public.reverse_legacy_reconciliation(p_cycle_id uuid,p_idempotency_key text,p_reason text)returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; r public.legacy_reconciliations%rowtype; op public.financial_operations%rowtype; idx int;
begin
  select * into c from public.cycles where id=p_cycle_id for update;
  if c.id is null or auth.uid() is null or not public.current_user_is_workspace_admin(c.workspace_id) then raise exception 'No tiene permiso sobre este ciclo.'; end if;
  select * into r from public.legacy_reconciliations where cycle_id=c.id for update;
  if r.id is null then raise exception 'No hay conciliacion confirmada.'; end if;
  if length(trim(coalesce(p_idempotency_key,'')))<8 or nullif(trim(p_reason),'')is null then raise exception 'El reverso requiere clave y motivo.'; end if;
  if r.reversed_at is not null then
    if r.reverse_key=trim(p_idempotency_key)and r.reverse_reason=trim(p_reason)then return jsonb_build_object('state','reversed','reconciliation_id',r.id);end if;
    raise exception 'La conciliacion ya fue revertida.';
  end if;
  if exists(select 1 from public.financial_operations o where o.cycle_id=c.id and o.operation_type in('member_settlement_confirmed','loan_profit_period_confirmed','loan_profit_distribution_confirmed','admin_withdrawal') and not exists(select 1 from public.financial_operations rev where rev.reverses_operation_id=o.id))then raise exception 'Hay retiros, liquidaciones o repartos dependientes.';end if;
  for idx in reverse cardinality(r.operation_ids)..1 loop
    select * into op from public.financial_operations where id=r.operation_ids[idx];
    perform public.phasea_reverse_base(op.id,trim(p_idempotency_key)||':'||idx::text,op.effective_date,trim(p_reason));
  end loop;
  update public.legacy_reconciliations set reversed_at=now(),reverse_key=trim(p_idempotency_key),reverse_reason=trim(p_reason)where id=r.id;
  return jsonb_build_object('state','reversed','reconciliation_id',r.id,'balances',public.reconciliation_balances(c.id));
end $$;

-- Recognize dated non-cash interest in the existing chronological allocation engine.
do $$ declare name text; definition text; needle text:='''loan_payment'', ''loan_prepayment'', ''member_settlement_confirmed'''; begin
  foreach name in array array['loan_profit_shares','preview_loan_profit_periods'] loop
    select pg_get_functiondef(p.oid)into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=name;
    if position(needle in definition)=0 then raise exception 'Motor financiero inesperado: %',name;end if;
    execute replace(definition,needle,needle||', ''legacy_loan_interest_correction''');
  end loop;
end $$;

-- Expand the existing backup inventory; ordering supports restoration of the new tables.
do $$ declare definition text;begin
  select pg_get_functiondef('public.natillera_backup_tables()'::regprocedure)into definition;
  if position('''audit_events'''in definition)=0 then raise exception 'Inventario de respaldo inesperado.';end if;
  execute replace(definition,'''audit_events''','''audit_events'',''legacy_reconciliations''');
end $$;

revoke all on function public.preview_legacy_reconciliation(uuid),public.confirm_legacy_reconciliation(uuid,text,text),public.reverse_legacy_reconciliation(uuid,text,text),public.reverse_financial_operation(uuid,text,date,text) from public,anon;
grant execute on function public.preview_legacy_reconciliation(uuid),public.confirm_legacy_reconciliation(uuid,text,text),public.reverse_legacy_reconciliation(uuid,text,text),public.reverse_financial_operation(uuid,text,date,text) to authenticated;
