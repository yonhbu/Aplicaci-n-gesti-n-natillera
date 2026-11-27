-- Metadata only: no contributions, operations, ledger or settlement amounts are created.
begin;
create table public.polla_historical_rights (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.workspaces(id),
 activity_id uuid not null references public.polla_activities(id),
 contribution_id uuid not null references public.polla_contributions(id),
 cycle_member_id uuid not null references public.cycle_members(id),
 amount numeric(18,2) not null check(amount>0 and amount<=10000),
 eligible_on date not null,
 evidence text not null check(length(trim(evidence)) between 10 and 1000),
 confirmed_by uuid not null references auth.users(id),
 confirmed_at timestamptz not null default now(),
 batch_key text not null,
 preview_hash text not null,
 unique(activity_id,cycle_member_id)
);
alter table public.polla_historical_rights enable row level security;
create policy rights_read on public.polla_historical_rights for select to authenticated
 using(public.current_user_is_workspace_admin(workspace_id));
revoke all on public.polla_historical_rights from public, anon, authenticated;
grant select on public.polla_historical_rights to authenticated;

create function public.polla_verified_amount(p_activity uuid,p_member uuid) returns numeric
language sql stable security definer set search_path=public,pg_temp as $$
 select coalesce((select sum(amount) from public.polla_contributions where activity_id=p_activity and cycle_member_id=p_member and status='posted'),0)
 + coalesce((select sum(r.amount) from public.polla_historical_rights r join public.polla_contributions c on c.id=r.contribution_id where r.activity_id=p_activity and r.cycle_member_id=p_member and c.status='posted'),0);
$$;
revoke all on function public.polla_verified_amount(uuid,uuid) from public,anon,authenticated;

create function public.canonical_polla_right_rows(p_rows jsonb) returns jsonb
language sql immutable set search_path=public,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('cycle_member_id',cycle_member_id,'contribution_id',contribution_id,'amount',amount,'eligible_on',eligible_on,'evidence',trim(evidence)) order by cycle_member_id),'[]')
 from jsonb_to_recordset(p_rows) as x(cycle_member_id uuid,contribution_id uuid,amount numeric,eligible_on date,evidence text);
$$;
revoke all on function public.canonical_polla_right_rows(jsonb) from public,anon,authenticated;

create function public.preview_polla_historical_rights(p_activity_id uuid,p_rows jsonb) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.polla_activities; r record; m public.cycle_members; c public.polla_contributions; total numeric; snap jsonb;
begin
 select * into a from public.polla_activities where id=p_activity_id;
 if a.id is null or not public.current_user_is_workspace_admin(a.workspace_id) then raise exception 'Sin permiso de conciliación.'; end if;
 if a.status<>'open' or a.cancelled_at is not null or exists(select 1 from public.polla_prizes where activity_id=a.id and status<>'reversed') then raise exception 'La actividad ya tiene premio o está cancelada/cerrada.'; end if;
 if p_rows is null or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 100 then raise exception 'Indique atribuciones respaldadas.'; end if;
 p_rows:=public.canonical_polla_right_rows(p_rows);
 if (select count(*)<>count(distinct x->>'cycle_member_id') from jsonb_array_elements(p_rows) x) then raise exception 'Derecho duplicado.'; end if;
 for r in select * from jsonb_to_recordset(p_rows) as x(cycle_member_id uuid,contribution_id uuid,amount numeric,eligible_on date,evidence text) loop
  select * into m from public.cycle_members where id=r.cycle_member_id;
  select * into c from public.polla_contributions where id=r.contribution_id;
  if m.id is null or m.cycle_id<>a.cycle_id or not m.participates_in_polla or m.economic_mode='fixed_yield' then raise exception 'Socio sin participación verificable en Polla.'; end if;
  if c.id is null or c.activity_id<>a.id or c.status<>'posted' or not c.legacy_collective or c.cycle_member_id is not null then raise exception 'Recaudo colectivo original no disponible.'; end if;
  if not exists(select 1 from public.financial_operations o where o.id=c.operation_id and o.workspace_id=a.workspace_id and o.cycle_id=a.cycle_id)
     or coalesce((select -sum(l.amount) from public.ledger_entries l where l.operation_id=c.operation_id and l.cycle_id=a.cycle_id and l.account='polla_pool'),0)<>c.amount
     or exists(select 1 from public.financial_operations o where o.reverses_operation_id=c.operation_id) then raise exception 'El recaudo colectivo no concilia con su operación contable.'; end if;
  if r.amount is null or r.amount<=0 or r.amount<>round(r.amount,2) or r.amount+public.polla_verified_amount(a.id,m.id)>10000 then raise exception 'Importe inválido o derecho ya reconocido.'; end if;
  if exists(select 1 from public.polla_historical_rights where activity_id=a.id and cycle_member_id=m.id) then raise exception 'Derecho duplicado.'; end if;
  if r.eligible_on is null or extract(year from r.eligible_on)<>a.period_year or extract(month from r.eligible_on)<>a.period_month
    or a.period_month not between m.participation_start_month and m.participation_end_month
    or exists(select 1 from public.member_settlements s where s.cycle_member_id=m.id and s.status<>'reversed' and s.cut_date<r.eligible_on)
    or (m.savings_status<>'active' and not exists(select 1 from public.member_settlements s where s.cycle_member_id=m.id and s.status<>'reversed')) then raise exception 'Período efectivo sin soporte o posterior al retiro.'; end if;
  if r.evidence is null or length(trim(r.evidence)) not between 10 and 1000 then raise exception 'Falta respaldo individual de verificación.'; end if;
 end loop;
 if exists(select 1 from jsonb_to_recordset(p_rows) as x(contribution_id uuid,amount numeric) group by contribution_id having sum(amount)+coalesce((select sum(h.amount) from public.polla_historical_rights h where h.contribution_id=x.contribution_id),0)>(select amount from public.polla_contributions where id=x.contribution_id)) then raise exception 'Las atribuciones superan el recaudo colectivo disponible.'; end if;
 select coalesce(sum(x.amount),0) into total from jsonb_to_recordset(p_rows) as x(amount numeric);
 snap:=jsonb_build_object('activity_id',a.id,'rows',p_rows,'total',total,'existing',(select coalesce(jsonb_agg(to_jsonb(h) order by id),'[]') from public.polla_historical_rights h where h.activity_id=a.id),'sources',(select jsonb_agg(to_jsonb(src) order by src.id) from public.polla_contributions src where src.activity_id=a.id),'members',(select jsonb_agg(to_jsonb(cm) order by cm.id) from public.cycle_members cm where cm.cycle_id=a.cycle_id),'settlements',(select coalesce(jsonb_agg(to_jsonb(s) order by id),'[]') from public.member_settlements s where s.cycle_id=a.cycle_id));
 return jsonb_build_object('total',total,'rows',p_rows,'preview_hash',md5(snap::text),'ledger_delta',0);
end; $$;

create function public.confirm_polla_historical_rights(p_activity_id uuid,p_rows jsonb,p_preview_hash text,p_key text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare a public.polla_activities; preview jsonb; prior jsonb;
begin
 select * into a from public.polla_activities where id=p_activity_id for update;
 if a.id is null or not public.current_user_is_workspace_admin(a.workspace_id) then raise exception 'Sin permiso de conciliación.'; end if;
 if p_key is null or length(trim(p_key)) not between 8 and 100 then raise exception 'Clave de confirmación inválida.'; end if;
 p_rows:=public.canonical_polla_right_rows(p_rows);
 select jsonb_agg(jsonb_build_object('cycle_member_id',cycle_member_id,'contribution_id',contribution_id,'amount',amount,'eligible_on',eligible_on,'evidence',evidence) order by cycle_member_id) into prior from public.polla_historical_rights where activity_id=a.id and batch_key=p_key;
 if prior is not null then
  if prior=(select jsonb_agg(x order by x->>'cycle_member_id') from jsonb_array_elements(p_rows) x) then return jsonb_build_object('confirmed',true,'replayed',true); end if;
  raise exception 'Clave usada con otro contenido.';
 end if;
 perform 1 from public.polla_contributions where activity_id=a.id for update;
 perform 1 from public.cycle_members where cycle_id=a.cycle_id for update;
 preview:=public.preview_polla_historical_rights(a.id,p_rows);
 if p_preview_hash is distinct from preview->>'preview_hash' then raise exception 'La previsualización cambió; revise nuevamente.'; end if;
 insert into public.polla_historical_rights(workspace_id,activity_id,contribution_id,cycle_member_id,amount,eligible_on,evidence,confirmed_by,batch_key,preview_hash)
 select a.workspace_id,a.id,x.contribution_id,x.cycle_member_id,x.amount,x.eligible_on,x.evidence,auth.uid(),p_key,p_preview_hash from jsonb_to_recordset(p_rows) as x(cycle_member_id uuid,contribution_id uuid,amount numeric,eligible_on date,evidence text);
 insert into public.polla_participants(workspace_id,cycle_id,activity_id,cycle_member_id)
 select a.workspace_id,a.cycle_id,a.id,x.cycle_member_id from jsonb_to_recordset(p_rows) as x(cycle_member_id uuid) on conflict(activity_id,cycle_member_id) do nothing;
 return jsonb_build_object('confirmed',true,'total',preview->'total','ledger_delta',0);
end; $$;
revoke all on function public.preview_polla_historical_rights(uuid,jsonb),public.confirm_polla_historical_rights(uuid,jsonb,text,text) from public,anon;
grant execute on function public.preview_polla_historical_rights(uuid,jsonb),public.confirm_polla_historical_rights(uuid,jsonb,text,text) to authenticated;

create function public.protect_polla_rights_source() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
 if exists(select 1 from public.polla_historical_rights where contribution_id=old.id) then raise exception 'El recaudo respalda derechos históricos confirmados; requiere revisión antes de corregirlo.'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end; $$;
create trigger protect_rights_source before update or delete on public.polla_contributions for each row execute function public.protect_polla_rights_source();

-- Existing financial behavior preserved; verified metadata adds eligibility only.
create or replace function public.award_polla_prize_to_capital(
  p_activity_id uuid,
  p_winner_cycle_member_id uuid,
  p_idempotency_key text,
  p_gross_amount numeric,
  p_awarded_at date
)
returns public.polla_prizes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prize public.polla_prizes%rowtype;
begin
  perform 1 from public.polla_activities where id=p_activity_id and public.current_user_is_workspace_admin(workspace_id) for update;
  if not found then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if public.polla_verified_amount(p_activity_id,p_winner_cycle_member_id) < 10000 then
    raise exception 'El ganador no tiene pagada completa la polla de esta actividad ($10.000).';
  end if;
  prize := public.award_polla_prize(p_activity_id, p_winner_cycle_member_id, p_idempotency_key, p_gross_amount, p_awarded_at);
  if prize.status = 'pending_payment'
     and prize.legacy_payment_status <> 'historical_payment_unverified'
     and not exists (select 1 from public.member_settlements s where s.cycle_member_id = p_winner_cycle_member_id and s.status <> 'reversed') then
    perform public.credit_polla_prize_to_capital(prize.id, trim(p_idempotency_key) || ':capital', p_awarded_at);
  end if;
  select * into prize from public.polla_prizes where id = prize.id;
  return prize;
end;
$$;

-- Existing financial behavior preserved; verified metadata adds eligibility only.
create or replace function public.fin04_validate_polla_prize()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.legacy_id is null and exists (select 1 from public.cycles c where c.id = new.cycle_id and c.settlement_rules_version = 'fin03-2026') then
      if public.polla_verified_amount(new.activity_id,new.winner_cycle_member_id) < 10000 then
        raise exception 'El ganador no tiene pagada completa la polla de esta actividad ($10.000).';
      end if;
      if exists (select 1 from public.polla_prizes pp where pp.activity_id = new.activity_id and pp.status <> 'reversed') then
        raise exception 'Esta polla ya tiene premio asignado.';
      end if;
    end if;
  elsif old.legacy_payment_status = 'historical_payment_unverified'
        and new.legacy_payment_status = 'historical_payment_unverified'
        and new.status is distinct from old.status
        and new.status <> 'reversed' then
    raise exception 'Premio historico sin verificar: confirme primero si se entrego antes de liquidarlo, acreditarlo o pagarlo.';
  end if;
  return new;
end;
$$;

-- Existing financial behavior preserved; verified metadata adds eligibility only.
create or replace function public.fin03_validate_polla_contribution()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  paid numeric(18,2);
begin
  if new.cycle_member_id is null or new.status <> 'posted' then return new; end if;
  -- FIN-07: solo en ciclos con reglas 2026; los ciclos historicos conservan su politica.
  if not exists (select 1 from public.cycles c where c.id = new.cycle_id and c.settlement_rules_version = 'fin03-2026') then return new; end if;
  -- Enforce the existing FIN-03 modality; preserve historical cycles and prior rows.
  if exists (select 1 from public.cycle_members cm where cm.id = new.cycle_member_id and cm.economic_mode = 'fixed_yield') then
    raise exception 'Este socio solo ahorra al 12 %% EA y no participa en polla.';
  end if;
  if exists (select 1 from public.polla_prizes pp where pp.activity_id = new.activity_id and pp.status <> 'reversed') then
    raise exception 'Esta polla ya se jugo: no recibe mas aportes.';
  end if;
  if exists (
    select 1 from public.member_settlements s
    where s.cycle_member_id = new.cycle_member_id and s.status <> 'reversed' and s.cut_date < new.paid_date
  ) then
    raise exception 'El socio ya se retiro: solo conserva las pollas que pago antes de su retiro.';
  end if;
  select round(coalesce(sum(pc.amount), 0), 2) into paid from public.polla_contributions pc
  where pc.activity_id = new.activity_id and pc.cycle_member_id = new.cycle_member_id and pc.status = 'posted' and pc.id is distinct from new.id;
  if paid + new.amount + coalesce((select sum(amount) from public.polla_historical_rights where activity_id=new.activity_id and cycle_member_id=new.cycle_member_id),0) > 10000 then
    raise exception 'El aporte de polla es de $10.000 por actividad; este socio ya tiene %.', paid;
  end if;
  return new;
end;
$$;

create function public.polla_reconciliation_matrix(p_cycle_id uuid) returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
declare w uuid; rows jsonb; pool numeric; linked numeric;
begin
 select workspace_id into w from public.cycles where id=p_cycle_id;
 if w is null or not public.current_user_is_workspace_admin(w) then raise exception 'Sin permiso de conciliación.'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('activity_id',a.id,'month',a.period_month,'name',a.name,'cancelled',a.cancelled_at is not null,
 'collected',(select coalesce(sum(amount),0) from public.polla_contributions where activity_id=a.id and status='posted'),
 'collective',(select coalesce(sum(amount),0) from public.polla_contributions where activity_id=a.id and status='posted' and legacy_collective),
 'verified_rights',(select count(*) from public.polla_historical_rights where activity_id=a.id),
 'individual_members',(select count(distinct cycle_member_id) from public.polla_contributions where activity_id=a.id and status='posted'),
 'gross_prizes',(select coalesce(sum(gross_amount),0) from public.polla_prizes where activity_id=a.id and status<>'reversed'),
 'ledger_pool',(select coalesce(-sum(amount),0) from public.ledger_entries where cycle_id=p_cycle_id and polla_activity_id=a.id and account='polla_pool')) order by a.period_month,a.id),'[]') into rows from public.polla_activities a where a.cycle_id=p_cycle_id and a.period_year=2026;
 select coalesce(-sum(amount),0),coalesce(-sum(amount) filter(where polla_activity_id in(select id from public.polla_activities where cycle_id=p_cycle_id and period_year=2026)),0) into pool,linked from public.ledger_entries where cycle_id=p_cycle_id and account='polla_pool';
 return jsonb_build_object('activities',rows,'cycle_ledger_pool',pool,'unassigned_or_other_year_pool',pool-linked,'cut_scope','ledger completo; período de actividad separado de fecha efectiva');
end; $$;
revoke all on function public.polla_reconciliation_matrix(uuid) from public,anon;
grant execute on function public.polla_reconciliation_matrix(uuid) to authenticated;
do $$ declare definition text;
begin
 select pg_get_functiondef('public.natillera_backup_tables()'::regprocedure) into definition;
 if not ('polla_historical_rights'=any(public.natillera_backup_tables())) then
  definition:=replace(definition,'''polla_contributions'',','''polla_contributions'',''polla_historical_rights'',');
  execute definition;
 end if;
 if not ('polla_historical_rights'=any(public.natillera_backup_tables())) then raise exception 'Falta inventario de recuperación de derechos.'; end if;
end $$;
notify pgrst, 'reload schema';
commit;
