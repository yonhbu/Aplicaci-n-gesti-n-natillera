-- Serialize the quote/commit with source writers that do not take a cycle lock.
-- Existing ledger and domain rows remain unmodified.
do $$declare definition text; name text; needle text;begin
 foreach name in array array['confirm_legacy_reconciliation','reverse_legacy_reconciliation']loop
  select pg_get_functiondef(p.oid)into definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname=name;
  needle:='select * into c from public.cycles where id=p_cycle_id for update;';
  if position(needle in definition)=0 then raise exception 'Funcion de conciliacion inesperada.';end if;
  definition:=replace(definition,needle,needle||E'\n  lock table public.financial_operations,public.ledger_entries,public.loan_contracts,public.loan_schedules,public.loan_payments,public.legacy_operational_import_batches in share row exclusive mode;');
  execute definition;
 end loop;
 select pg_get_functiondef('public.preview_legacy_reconciliation(uuid)'::regprocedure)into definition;
 definition:=replace(definition,'select s.* from public.loan_schedules s join','select s.*,l.legacy_id loan_code from public.loan_schedules s join');
 definition:=replace(definition,'''schedule_id'',r.id,','''schedule_id'',r.id,''loan_code'',r.loan_code,');
 definition:=replace(definition,'''net_cash'',r.net,','''loan_code'',r.legacy_id,''net_cash'',r.net,');
 execute definition;
end$$;
