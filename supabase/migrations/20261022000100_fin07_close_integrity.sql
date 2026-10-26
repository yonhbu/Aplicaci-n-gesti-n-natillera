-- FIN-07: auditoria FIN-05 + FIN-06.
-- 1. Faltante del 12 % EA: lo cubre el administrador con su fondo acumulado (decision del administrador). Si tampoco alcanza, se bloquea.
-- 2. Orden de cierre en servidor: la liquidacion final no se confirma sin los repartos obligatorios del ciclo.
-- 3. Pago de utilidades por beneficiario, con operacion, fecha, medio y referencia propios.
-- 4. Solo cobros verificables alimentan el reparto; otros creditos al fondo se informan y bloquean hasta conciliar.
-- 5. Validaciones de polla solo en ciclos con reglas 2026 (las pruebas y ciclos historicos conservan su politica).
-- 6. Informe de dependencias para correcciones; el reverso coordinado sigue pendiente.

alter table public.loan_profit_period_allocations add column if not exists paid_operation_id uuid references public.financial_operations(id);
alter table public.loan_profit_period_allocations add column if not exists paid_date date;
alter table public.loan_profit_period_allocations add column if not exists paid_reference text;
alter table public.loan_profit_period_allocations add column if not exists paid_location text;

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
  if paid + new.amount > 10000 then
    raise exception 'El aporte de polla es de $10.000 por actividad; este socio ya tiene %.', paid;
  end if;
  return new;
end;
$$;

create or replace function public.fin04_validate_polla_prize()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.legacy_id is null and exists (select 1 from public.cycles c where c.id = new.cycle_id and c.settlement_rules_version = 'fin03-2026') then
      if (select coalesce(sum(pc.amount), 0) from public.polla_contributions pc
          where pc.activity_id = new.activity_id and pc.cycle_member_id = new.winner_cycle_member_id and pc.status = 'posted') < 10000 then
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

create or replace function public.loan_profit_shares(p_cycle_id uuid, p_cut_date date)
returns table (operation_id uuid, effective_date date, cycle_member_id uuid, member_id uuid, amount numeric, kind text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  op record;
  reserved numeric(18,2) := 0;
  need numeric(18,2);
  take numeric(18,2);
  coll_cents numeric;
begin
  for op in
    select fo.id as op_id, fo.effective_date as op_date, round(-sum(le.amount), 2) as fund
    from public.financial_operations fo
    join public.ledger_entries le on le.operation_id = fo.id and le.account = 'member_loan_profit_fund'
    where fo.cycle_id = p_cycle_id
      and fo.effective_date <= p_cut_date
      and fo.operation_type in ('loan_payment', 'loan_prepayment', 'member_settlement_confirmed')
      and not exists (select 1 from public.financial_operations rev where rev.reverses_operation_id = fo.id)
    group by fo.id, fo.effective_date
    having -sum(le.amount) > 0
    order by fo.effective_date, fo.id
  loop
    -- FIN-06: el 12 % EA ya cubierto por retirados (descontado de su parte congelada) cuenta como reservado.
    need := greatest(0, public.fin_ea_accrued(p_cycle_id, op.op_date) - reserved - coalesce((
      select sum(coalesce((s.snapshot->>'loan_profit_ea_charge')::numeric, 0)) from public.member_settlements s
      where s.cycle_id = p_cycle_id and s.status <> 'reversed' and s.cut_date < op.op_date
    ), 0));
    take := least(op.fund, need);
    reserved := reserved + take;
    if take > 0 then
      operation_id := op.op_id; effective_date := op.op_date; cycle_member_id := null; member_id := null; amount := take; kind := 'ea_reserve';
      return next;
    end if;
    coll_cents := round((op.fund - take) * 100);
    if coll_cents > 0 then
      return query
      with el as (
        select cm.id as cmid, cm.member_id as mid,
               row_number() over (order by m.display_name, cm.id) as rn,
               count(*) over () as n
        from public.cycle_members cm
        join public.members m on m.id = cm.member_id
        where cm.cycle_id = p_cycle_id
          and cm.economic_mode = 'collective'
          and cm.participates_in_loan_profit
          and cm.participation_start_month <= extract(month from op.op_date)::integer
          and not exists (
            select 1 from public.member_settlements s
            where s.cycle_member_id = cm.id and s.status <> 'reversed' and s.cut_date < op.op_date
          )
          and (cm.savings_status = 'active' or exists (
            select 1 from public.member_settlements s2 where s2.cycle_member_id = cm.id and s2.status <> 'reversed'
          ))
      )
      select op.op_id, op.op_date, el.cmid, el.mid,
             round((floor(coll_cents / el.n) + case when el.rn <= coll_cents - floor(coll_cents / el.n) * el.n then 1 else 0 end) / 100.0, 2),
             'collective'::text
      from el;
      if not found then
        operation_id := op.op_id; effective_date := op.op_date; cycle_member_id := null; member_id := null; amount := round(coll_cents / 100.0, 2); kind := 'no_beneficiary';
        return next;
      end if;
    end if;
  end loop;
end;
$$;

create or replace function public.preview_loan_profit_periods(p_cycle_id uuid, p_cut_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  fund_total numeric(18,2);
  ea_reserved numeric(18,2);
  ea_total numeric(18,2);
  deficit numeric(18,2);
  no_beneficiary numeric(18,2);
  frozen_total numeric(18,2);
  active_pool numeric(18,2);
  shortfall numeric(18,2);
  admin_available numeric(18,2);
  admin_cover numeric(18,2);
  remaining numeric(18,2);
  unverified_sources numeric(18,2);
  unresolved integer;
  old_distributions integer;
  beneficiaries jsonb;
  snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_cut_date is null or p_cut_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de corte invalida.'; end if;

  create temporary table if not exists fin05_shares (operation_id uuid, effective_date date, cycle_member_id uuid, member_id uuid, amount numeric, kind text) on commit drop;
  delete from fin05_shares;
  insert into fin05_shares select * from public.loan_profit_shares(p_cycle_id, p_cut_date);

  select round(coalesce(sum(amount), 0), 2) into fund_total from fin05_shares;
  select round(coalesce(sum(amount) filter (where kind = 'ea_reserve'), 0), 2),
         round(coalesce(sum(amount) filter (where kind = 'no_beneficiary'), 0), 2)
  into ea_reserved, no_beneficiary from fin05_shares;
  ea_total := public.fin_ea_accrued(p_cycle_id, p_cut_date);
  -- FIN-06: descontar el 12 % EA que ya cubrieron los retirados con su parte congelada.
  deficit := greatest(0, ea_total - ea_reserved - coalesce((
    select sum(coalesce((s.snapshot->>'loan_profit_ea_charge')::numeric, 0)) from public.member_settlements s
    where s.cycle_id = p_cycle_id and s.status <> 'reversed' and s.cut_date < target_cycle.closes_on
  ), 0));

  create temporary table if not exists fin05_members (cycle_member_id uuid, member_id uuid, display_name text, share numeric(18,2), frozen boolean, frozen_amount numeric(18,2), unresolved boolean, final_amount numeric(18,2)) on commit drop;
  delete from fin05_members;
  insert into fin05_members
  select cm.id, cm.member_id, m.display_name,
         round(coalesce((select sum(sh.amount) from fin05_shares sh where sh.cycle_member_id = cm.id and sh.kind = 'collective'), 0), 2),
         st.id is not null and st.cut_date < target_cycle.closes_on,
         case when st.id is not null and st.cut_date < target_cycle.closes_on then coalesce((st.snapshot->>'loan_profit_frozen')::numeric, null) end,
         st.id is not null and st.cut_date < target_cycle.closes_on and not (st.snapshot ? 'loan_profit_frozen'),
         0
  from public.cycle_members cm
  join public.members m on m.id = cm.member_id
  left join lateral (
    select ms.id, ms.cut_date, ms.snapshot from public.member_settlements ms
    where ms.cycle_member_id = cm.id and ms.status <> 'reversed' order by ms.cut_date limit 1
  ) st on true
  where cm.cycle_id = p_cycle_id and cm.economic_mode = 'collective' and cm.participates_in_loan_profit;

  update fin05_members set final_amount = coalesce(frozen_amount, share) where frozen;
  select round(coalesce(sum(final_amount) filter (where frozen), 0), 2), round(coalesce(sum(share) filter (where not frozen), 0), 2)
  into frozen_total, active_pool from fin05_members;
  shortfall := greatest(0, deficit - active_pool);
  -- FIN-07: el faltante del 12 % EA lo cubre el administrador con su fondo acumulado (comisiones, multas, 10 % de intereses).
  select round(-coalesce(sum(le.amount), 0), 2) into admin_available
  from public.ledger_entries le join public.financial_operations fo on fo.id = le.operation_id
  where fo.cycle_id = p_cycle_id and le.account = 'admin_payable' and fo.effective_date <= p_cut_date;
  admin_cover := least(shortfall, greatest(0, admin_available));
  remaining := shortfall - admin_cover;
  -- Creditos al fondo de socios que no vienen de cobros verificables: se informan y no se reparten.
  select round(coalesce(-sum(le.amount), 0), 2) into unverified_sources
  from public.ledger_entries le join public.financial_operations fo on fo.id = le.operation_id
  where fo.cycle_id = p_cycle_id and le.account = 'member_loan_profit_fund' and le.amount < 0 and fo.effective_date <= p_cut_date
    and fo.operation_type not in ('loan_payment', 'loan_prepayment', 'member_settlement_confirmed');

  -- Descuento a prorrata del 12 % EA devengado despues del ultimo cobro, solo sobre socios activos.
  with base as (
    select cycle_member_id, display_name, round(share * 100) as sc,
           row_number() over (order by display_name, cycle_member_id) as rn
    from fin05_members where not frozen
  ), target as (
    select greatest(0, round(active_pool * 100) - round(least(deficit, active_pool) * 100)) as tc, nullif(round(active_pool * 100), 0) as pc
  ), alloc as (
    select b.cycle_member_id, b.rn, floor(b.sc * t.tc / t.pc) as cents, t.tc from base b cross join target t where t.pc is not null
  ), rem as (
    select a.*, a.tc - sum(a.cents) over () as remainder from alloc a
  )
  update fin05_members fm set final_amount = round((r.cents + case when r.rn <= r.remainder then 1 else 0 end) / 100.0, 2)
  from rem r where fm.cycle_member_id = r.cycle_member_id;

  select count(*) filter (where unresolved) into unresolved from fin05_members;
  select count(*) into old_distributions from public.loan_profit_distributions d where d.cycle_id = p_cycle_id and d.status <> 'reversed';

  select coalesce(jsonb_agg(jsonb_build_object('cycle_member_id', cycle_member_id, 'member_id', member_id, 'display_name', display_name,
            'share', share, 'amount', final_amount, 'frozen_at_withdrawal', frozen) order by display_name, cycle_member_id), '[]'::jsonb)
  into beneficiaries from fin05_members;

  snapshot := jsonb_build_object(
    'rule_version', 'fin05-loan-profit-periods-2026',
    'cycle_id', p_cycle_id,
    'cut_date', p_cut_date,
    'fund_total', fund_total,
    'ea_obligation', ea_total,
    'ea_reserved_chronological', ea_reserved,
    'ea_after_last_collection', deficit,
    'shortfall', shortfall,
    'admin_available', admin_available,
    'admin_cover', admin_cover,
    'remaining_shortfall', remaining,
    'unverified_fund_sources', unverified_sources,
    'undistributed_kept_in_fund', no_beneficiary,
    'no_beneficiary', no_beneficiary,
    'frozen_total', frozen_total,
    'active_total', round(coalesce((select sum(final_amount) from fin05_members where not frozen), 0), 2),
    'collective_total', round(coalesce((select sum(final_amount) from fin05_members), 0), 2),
    'unresolved_settlements', unresolved,
    'previous_distributions', old_distributions,
    'beneficiaries', beneficiaries,
    'confirmation_allowed', remaining = 0 and unverified_sources = 0 and unresolved = 0 and old_distributions = 0
      and not exists (select 1 from public.loan_profit_period_distributions d where d.cycle_id = p_cycle_id and d.status <> 'reversed')
  );
  return snapshot || jsonb_build_object('preview_hash', md5(snapshot::text));
end;
$$;

create or replace function public.confirm_loan_profit_periods(p_cycle_id uuid, p_cut_date date, p_idempotency_key text, p_preview_hash text)
returns public.loan_profit_period_distributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  existing public.loan_profit_period_distributions%rowtype;
  created public.loan_profit_period_distributions%rowtype;
  preview jsonb;
  b jsonb;
  entries jsonb;
  collective numeric(18,2);
  ea numeric(18,2);
  op public.financial_operations%rowtype;
  cover numeric(18,2);
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id for update;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  select * into existing from public.loan_profit_period_distributions where workspace_id = target_cycle.workspace_id and idempotency_key = trim(p_idempotency_key);
  if existing.id is not null then
    if existing.cycle_id = p_cycle_id and existing.preview_hash = p_preview_hash then return existing; end if;
    raise exception 'La clave de idempotencia del reparto ya existe con otro contenido.';
  end if;
  if target_cycle.settlement_rules_version is distinct from 'fin03-2026' then raise exception 'Active primero las reglas financieras 2026 del ciclo.'; end if;
  if p_cut_date <> target_cycle.closes_on then raise exception 'La utilidad de prestamos se reparte con corte en el cierre (%).', target_cycle.closes_on; end if;
  if public.fin_civil_today() < target_cycle.closes_on then raise exception 'Todavia no es la fecha de cierre (%).', target_cycle.closes_on; end if;

  preview := public.preview_loan_profit_periods(p_cycle_id, p_cut_date);
  if preview->>'preview_hash' <> p_preview_hash then raise exception 'Los datos cambiaron desde el calculo. Vuelva a calcular.'; end if;
  if not (preview->>'confirmation_allowed')::boolean then
    raise exception 'No se puede confirmar: el 12 %% EA no alcanza ni con el fondo del administrador, hay creditos al fondo sin cobro verificable, liquidaciones sin derecho congelado o ya existe un reparto.';
  end if;
  collective := (preview->>'collective_total')::numeric;
  ea := (preview->>'ea_obligation')::numeric;
  cover := coalesce((preview->>'admin_cover')::numeric, 0);

  insert into public.loan_profit_period_distributions (workspace_id, cycle_id, idempotency_key, cut_date, preview_hash, snapshot, fund_total, ea_obligation, collective_total, created_by)
  values (target_cycle.workspace_id, p_cycle_id, trim(p_idempotency_key), p_cut_date, p_preview_hash, preview, (preview->>'fund_total')::numeric, ea, collective, auth.uid())
  returning * into created;

  -- El fondo de socios cubre el 12 % EA (contra savings_yield_expense) y el resto queda por pagar a cada socio A.
  entries := jsonb_build_array(jsonb_build_object('account', 'member_loan_profit_fund', 'amount', collective + ea - cover));
  if cover > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'admin_payable', 'amount', cover));
  end if;
  if ea > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'savings_yield_expense', 'amount', -ea));
  end if;
  for b in select * from jsonb_array_elements(preview->'beneficiaries') loop
    if (b->>'amount')::numeric > 0 then
      entries := entries || jsonb_build_array(jsonb_build_object('account', 'utility_distribution_payable', 'amount', -(b->>'amount')::numeric, 'member_id', (b->>'member_id')::uuid));
    end if;
  end loop;
  op := public.create_b_operation(
    target_cycle.workspace_id, p_cycle_id, p_idempotency_key, 'loan_profit_period_confirmed', p_cut_date,
    'loan_profit_period_distributions', created.id,
    jsonb_build_object('distribution_id', created.id, 'collective_total', collective, 'ea_obligation', ea, 'admin_cover', cover),
    entries
  );
  update public.loan_profit_period_distributions set operation_id = op.id where id = created.id returning * into created;
  for b in select * from jsonb_array_elements(preview->'beneficiaries') loop
    insert into public.loan_profit_period_allocations (distribution_id, cycle_id, cycle_member_id, member_id, amount, frozen_at_withdrawal)
    values (created.id, p_cycle_id, (b->>'cycle_member_id')::uuid, (b->>'member_id')::uuid, (b->>'amount')::numeric, (b->>'frozen_at_withdrawal')::boolean);
  end loop;
  return created;
end;
$$;

create or replace function public.pay_loan_profit_allocation(p_allocation_id uuid, p_idempotency_key text, p_paid_date date, p_liquidity_location text, p_bank_account_id uuid, p_reference text)
returns public.loan_profit_period_allocations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  alloc public.loan_profit_period_allocations%rowtype;
  dist public.loan_profit_period_distributions%rowtype;
  op public.financial_operations%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into alloc from public.loan_profit_period_allocations where id = p_allocation_id for update;
  if alloc.id is null then raise exception 'Asignacion no encontrada.'; end if;
  select * into dist from public.loan_profit_period_distributions where id = alloc.distribution_id for update;
  if not public.current_user_is_workspace_admin(dist.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if alloc.paid_operation_id is not null then return alloc; end if;
  if dist.status = 'reversed' then raise exception 'El reparto fue revertido.'; end if;
  if alloc.amount <= 0 then raise exception 'Este socio no tiene utilidad por pagar.'; end if;
  if p_liquidity_location not in ('bank', 'cash') or (p_liquidity_location = 'bank' and p_bank_account_id is null) then raise exception 'Indique de donde sale el dinero.'; end if;
  if p_paid_date is null or p_paid_date < dist.cut_date then raise exception 'Fecha de pago invalida.'; end if;
  op := public.create_b_operation(
    dist.workspace_id, dist.cycle_id, p_idempotency_key, 'loan_profit_period_paid', p_paid_date,
    'loan_profit_period_allocations', alloc.id,
    jsonb_build_object('allocation_id', alloc.id, 'distribution_id', dist.id, 'member_id', alloc.member_id, 'amount', alloc.amount, 'reference', coalesce(p_reference, '')),
    jsonb_build_array(
      jsonb_build_object('account', 'utility_distribution_payable', 'amount', alloc.amount, 'member_id', alloc.member_id),
      jsonb_build_object('account', 'cash', 'amount', -alloc.amount, 'liquidity_location', p_liquidity_location, 'bank_account_id', p_bank_account_id, 'member_id', alloc.member_id)
    )
  );
  update public.loan_profit_period_allocations
  set paid_operation_id = op.id, paid_date = p_paid_date, paid_reference = nullif(trim(coalesce(p_reference, '')), ''), paid_location = p_liquidity_location
  where id = alloc.id returning * into alloc;
  if not exists (select 1 from public.loan_profit_period_allocations a where a.distribution_id = dist.id and a.amount > 0 and a.paid_operation_id is null) then
    update public.loan_profit_period_distributions set status = 'paid', paid_date = p_paid_date where id = dist.id;
  end if;
  return alloc;
end;
$$;

-- El pago en lote ahora registra un pago por beneficiario.
create or replace function public.pay_loan_profit_periods(p_distribution_id uuid, p_idempotency_key text, p_paid_date date, p_liquidity_location text, p_bank_account_id uuid, p_reference text)
returns public.loan_profit_period_distributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dist public.loan_profit_period_distributions%rowtype;
  a record;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into dist from public.loan_profit_period_distributions where id = p_distribution_id;
  if dist.id is null then raise exception 'Reparto no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(dist.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  for a in select id from public.loan_profit_period_allocations where distribution_id = dist.id and amount > 0 and paid_operation_id is null order by id loop
    perform public.pay_loan_profit_allocation(a.id, trim(p_idempotency_key) || ':' || a.id, p_paid_date, p_liquidity_location, p_bank_account_id, p_reference);
  end loop;
  select * into dist from public.loan_profit_period_distributions where id = p_distribution_id;
  return dist;
end;
$$;

-- Orden de cierre: la liquidacion final (corte en el cierre) exige los repartos obligatorios confirmados.
create or replace function public.fin07_enforce_close_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
begin
  select * into target_cycle from public.cycles where id = new.cycle_id;
  if target_cycle.settlement_rules_version is distinct from 'fin03-2026' or new.cut_date < target_cycle.closes_on then return new; end if;
  if (exists (select 1 from public.financial_operations fo where fo.cycle_id = new.cycle_id and fo.operation_type in ('loan_payment', 'loan_prepayment'))
      or exists (select 1 from public.cycle_members cm where cm.cycle_id = new.cycle_id and cm.economic_mode = 'fixed_yield'))
     and not exists (select 1 from public.loan_profit_period_distributions d where d.cycle_id = new.cycle_id and d.status <> 'reversed') then
    raise exception 'Primero confirme el reparto de utilidad de prestamos del cierre (financia el 12 %% EA).';
  end if;
  if exists (select 1 from public.financial_operations fo where fo.cycle_id = new.cycle_id and fo.operation_type = 'bank_interest_received')
     and not exists (select 1 from public.bank_yield_distributions d where d.cycle_id = new.cycle_id and d.status = 'confirmed') then
    raise exception 'Primero confirme el reparto de rendimientos Pibank del cierre.';
  end if;
  return new;
end;
$$;
drop trigger if exists fin07_enforce_close_order on public.member_settlements;
create trigger fin07_enforce_close_order before insert on public.member_settlements
  for each row execute function public.fin07_enforce_close_order();

-- Informe de dependencias de una operacion antes de intentar corregirla.
create or replace function public.financial_operation_dependencies(p_operation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  target public.financial_operations%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target from public.financial_operations where id = p_operation_id;
  if target.id is null then raise exception 'Operacion no encontrada.'; end if;
  if not public.current_user_is_workspace_admin(target.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  return jsonb_build_object(
    'operation_id', target.id,
    'operation_type', target.operation_type,
    'effective_date', target.effective_date,
    'bank_yield_distributions', (select count(*) from public.bank_yield_distributions d where d.cycle_id = target.cycle_id and d.status = 'confirmed' and d.cut_date >= target.effective_date),
    'loan_profit_distributions', (select count(*) from public.loan_profit_period_distributions d where d.cycle_id = target.cycle_id and d.status <> 'reversed' and d.cut_date >= target.effective_date),
    'settlements_after', (select count(*) from public.member_settlements s where s.cycle_id = target.cycle_id and s.status <> 'reversed' and s.cut_date >= target.effective_date),
    'paid_allocations', (select count(*) from public.loan_profit_period_allocations a join public.loan_profit_period_distributions d on d.id = a.distribution_id
                         where d.cycle_id = target.cycle_id and a.paid_operation_id is not null and d.cut_date >= target.effective_date),
    'capital_credits', (select count(*) from public.member_capital_credits cc where cc.prize_id = target.reference_id or cc.operation_id = target.id)
  );
end;
$$;

revoke all on function public.pay_loan_profit_allocation(uuid, text, date, text, uuid, text) from public, anon;
grant execute on function public.pay_loan_profit_allocation(uuid, text, date, text, uuid, text) to authenticated;
grant execute on function public.pay_loan_profit_periods(uuid, text, date, text, uuid, text) to authenticated;
revoke all on function public.financial_operation_dependencies(uuid) from public, anon;
grant execute on function public.financial_operation_dependencies(uuid) to authenticated;
grant execute on function public.preview_loan_profit_periods(uuid, date) to authenticated;
grant execute on function public.confirm_loan_profit_periods(uuid, date, text, text) to authenticated;
