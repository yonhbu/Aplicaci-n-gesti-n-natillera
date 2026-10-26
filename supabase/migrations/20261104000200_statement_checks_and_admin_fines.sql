create table public.bank_statement_checks (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 cycle_id uuid not null,
 bank_account_id uuid not null,
 statement_date date not null check(isfinite(statement_date)),
 statement_balance numeric(18,2)not null check(statement_balance>=0 and statement_balance::text<>'NaN'),
 note text not null default '',
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 idempotency_key text not null,
 foreign key(workspace_id,cycle_id)references public.cycles(workspace_id,id),
 foreign key(workspace_id,bank_account_id)references public.bank_accounts(workspace_id,id),
 unique(workspace_id,idempotency_key)
);
alter table public.bank_statement_checks enable row level security;
create policy "admins read statement checks"on public.bank_statement_checks for select to authenticated using(public.current_user_is_workspace_admin(workspace_id));
revoke all on public.bank_statement_checks from public,anon,authenticated;
grant select on public.bank_statement_checks to authenticated;
create function public.phasea_immutable_statement()returns trigger language plpgsql set search_path=public,pg_temp as $$begin raise exception 'La comparacion se conserva; registre una nueva.';end$$;
create trigger phasea_immutable_statement before update or delete on public.bank_statement_checks for each row execute function public.phasea_immutable_statement();
revoke all on function public.phasea_immutable_statement()from public,anon,authenticated;

create function public.record_bank_statement_check(p_cycle_id uuid,p_bank_account_id uuid,p_idempotency_key text,p_statement_date date,p_statement_balance numeric,p_note text)returns public.bank_statement_checks
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; previous public.bank_statement_checks%rowtype;
begin
 select * into c from public.cycles where id=p_cycle_id for update;
 if c.id is null or auth.uid()is null or not public.current_user_is_workspace_admin(c.workspace_id)then raise exception 'No tiene permiso sobre este ciclo.';end if;
 if length(trim(coalesce(p_idempotency_key,'')))<8 then raise exception 'Clave de idempotencia invalida.';end if;
 select * into previous from public.bank_statement_checks where workspace_id=c.workspace_id and idempotency_key=trim(p_idempotency_key);
 if previous.id is not null then
   if previous.cycle_id=c.id and previous.bank_account_id=p_bank_account_id and previous.statement_date=p_statement_date and previous.statement_balance=p_statement_balance and previous.note=trim(coalesce(p_note,''))then return previous;end if;
   raise exception 'La comparacion ya tiene otro contenido.';
 end if;
 perform public.assert_money_2(p_statement_balance,'saldo del extracto',false);
 if p_statement_date is null or not isfinite(p_statement_date)or p_statement_date<c.starts_on or p_statement_date>public.fin_civil_today()then raise exception 'Fecha de extracto invalida.';end if;
 if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and workspace_id=c.workspace_id)then raise exception 'Cuenta bancaria no encontrada.';end if;
 insert into public.bank_statement_checks(workspace_id,cycle_id,bank_account_id,idempotency_key,statement_date,statement_balance,note,created_by)
 values(c.workspace_id,c.id,p_bank_account_id,trim(p_idempotency_key),p_statement_date,p_statement_balance,trim(coalesce(p_note,'')),auth.uid())returning * into previous;
 return previous;
end$$;

create function public.preview_bank_statement_check(p_cycle_id uuid,p_bank_account_id uuid default null)returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; s public.bank_statement_checks%rowtype; bank_amount numeric; physical numeric; other_banks numeric; unknown_amount numeric;
begin
 select * into c from public.cycles where id=p_cycle_id;
 if c.id is null or auth.uid()is null or not public.current_user_is_workspace_admin(c.workspace_id)then raise exception 'No tiene permiso sobre este ciclo.';end if;
 select * into s from public.bank_statement_checks where cycle_id=c.id and(p_bank_account_id is null or bank_account_id=p_bank_account_id)order by created_at desc,id desc limit 1;
 if s.id is null then return jsonb_build_object('state','empty');end if;
 select coalesce(sum(e.amount)filter(where e.bank_account_id=s.bank_account_id),0),
 coalesce(sum(e.amount)filter(where e.liquidity_location='cash'),0),
 coalesce(sum(e.amount)filter(where e.liquidity_location='bank'and e.bank_account_id<>s.bank_account_id),0),
 coalesce(sum(e.amount)filter(where e.liquidity_location='unknown'),0)
 into bank_amount,physical,other_banks,unknown_amount from public.ledger_entries e join public.financial_operations o on o.id=e.operation_id where e.cycle_id=c.id and e.account='cash'and o.effective_date<=s.statement_date;
 return jsonb_build_object('state','recorded','check',to_jsonb(s),'account_name',(select display_name from public.bank_accounts where id=s.bank_account_id),'account_balance',bank_amount,'physical_cash',physical,'other_banks',other_banks,'unknown',unknown_amount,'available',bank_amount+physical+other_banks,'difference',s.statement_balance-bank_amount);
end$$;

-- A fine is explicitly classified. Generic income retains its existing semantics.
create function public.record_admin_fine(p_cycle_id uuid,p_idempotency_key text,p_effective_date date,p_amount numeric,p_description text,p_liquidity_location text,p_bank_account_id uuid default null)returns public.financial_operations
language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.cycles%rowtype; previous public.financial_operations%rowtype; payload jsonb;
begin
 select * into c from public.cycles where id=p_cycle_id for update;
 if c.id is null or auth.uid()is null or not public.current_user_is_workspace_admin(c.workspace_id)then raise exception 'No tiene permiso sobre este ciclo.';end if;
 payload:=jsonb_build_object('amount',p_amount,'description',trim(p_description),'category','fine','liquidity_location',p_liquidity_location,'bank_account_id',p_bank_account_id);
 select * into previous from public.financial_operations where workspace_id=c.workspace_id and idempotency_key=trim(p_idempotency_key);
 if previous.id is not null then
  if previous.cycle_id=c.id and previous.operation_type='admin_fine_received'and previous.effective_date=p_effective_date and previous.payload=payload then return previous;end if;
  raise exception 'La clave de multa tiene otro contenido.';
 end if;
 if c.status<>'active'then raise exception 'El ciclo debe estar activo.';end if;
 perform public.assert_money_2(p_amount,'multa',true);
 if p_effective_date is null or not isfinite(p_effective_date)or p_effective_date<c.starts_on or p_effective_date>public.fin_civil_today()then raise exception 'Fecha de multa invalida.';end if;
 if nullif(trim(p_description),'')is null then raise exception 'La multa requiere motivo.';end if;
 if p_liquidity_location is null or p_liquidity_location not in('cash','bank')or(p_liquidity_location='cash'and p_bank_account_id is not null)or(p_liquidity_location='bank'and not exists(select 1 from public.bank_accounts where id=p_bank_account_id and workspace_id=c.workspace_id and status='active'))then raise exception 'Destino de multa invalido.';end if;
 return public.create_b_operation(c.workspace_id,c.id,p_idempotency_key,'admin_fine_received',p_effective_date,'cycles',c.id,payload,jsonb_build_array(jsonb_build_object('account','cash','amount',p_amount,'liquidity_location',p_liquidity_location,'bank_account_id',p_bank_account_id),jsonb_build_object('account','admin_payable','amount',-p_amount)));
end$$;

do $$declare definition text;begin
 select pg_get_functiondef('public.natillera_backup_tables()'::regprocedure)into definition;
 execute replace(definition,'''legacy_reconciliations''','''legacy_reconciliations'',''bank_statement_checks''');
end$$;
revoke all on function public.record_bank_statement_check(uuid,uuid,text,date,numeric,text),public.preview_bank_statement_check(uuid,uuid),public.record_admin_fine(uuid,text,date,numeric,text,text,uuid)from public,anon;
grant execute on function public.record_bank_statement_check(uuid,uuid,text,date,numeric,text),public.preview_bank_statement_check(uuid,uuid),public.record_admin_fine(uuid,text,date,numeric,text,text,uuid)to authenticated;
