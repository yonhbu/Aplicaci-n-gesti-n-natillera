-- FIN-04: correcciones de la auditoria de FIN-03.
-- P0 Pibank en cuenta propia (member_bank_yield_payable), no en savings_liability.
-- P0 Reparto Pibank solo al cierre oficial y con reglas activadas tras conciliacion.
-- P0 Modalidades coherentes protegidas en servidor para ciclos activados.
-- P0 Una sola validacion de ganador para cualquier camino de asignacion (trigger en polla_prizes).
-- P0 Premios historicos sin verificar fuera de las liquidaciones y bloqueados en cualquier cambio de estado.
-- P0 Reversos bloqueados cuando existen derechos derivados.
-- P1 Ciclos existentes vuelven a reglas anteriores hasta activarlas con conciliacion previa.

create or replace function public.fin_civil_today()
returns date
language sql
stable
as $$
  -- Override solo para pruebas SQL (set local natillera.civil_today); los clientes REST no pueden fijarlo.
  select coalesce(nullif(current_setting('natillera.civil_today', true), '')::date, (now() at time zone 'America/Bogota')::date)
$$;

do $$
declare
  def text;
begin
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'ledger_entries_account_check';
  if def is not null and def not like '%member_bank_yield_payable%' then
    execute 'alter table public.ledger_entries drop constraint ledger_entries_account_check';
    execute 'alter table public.ledger_entries add constraint ledger_entries_account_check '
      || replace(def, '''legacy_migration_equity''::text', '''legacy_migration_equity''::text, ''member_bank_yield_payable''::text');
  end if;
  select pg_get_constraintdef(oid) into def from pg_constraint where conname = 'financial_operations_operation_type_check';
  if def is not null and def not like '%bank_yield_settled%' then
    execute 'alter table public.financial_operations drop constraint financial_operations_operation_type_check';
    execute 'alter table public.financial_operations add constraint financial_operations_operation_type_check '
      || replace(def, '''admin_fee_recognized''::text', '''admin_fee_recognized''::text, ''bank_yield_settled''::text');
  end if;
end;
$$;

-- P1: ningun ciclo queda con reglas nuevas sin conciliacion. Se activan con activate_fin_rules_2026.
create table if not exists public.fin_rules_activations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  rules_version text not null,
  activated_by uuid not null,
  activated_at timestamptz not null default now(),
  checks jsonb not null,
  unique (cycle_id, rules_version)
);
alter table public.fin_rules_activations enable row level security;
drop policy if exists "workspace admins read fin rules activations" on public.fin_rules_activations;
create policy "workspace admins read fin rules activations" on public.fin_rules_activations for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
grant select on public.fin_rules_activations to authenticated;

update public.cycles c set settlement_rules_version = null
where c.settlement_rules_version = 'fin03-2026'
  and not exists (select 1 from public.fin_rules_activations a where a.cycle_id = c.id);

create or replace function public.fin_rules_activation_checks(p_cycle_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'close_date_ok', (select c.year <> 2026 or c.closes_on = date '2026-12-05' from public.cycles c where c.id = p_cycle_id),
    'incompatible_modes', (select count(*) from public.cycle_members cm where cm.cycle_id = p_cycle_id
        and cm.participates_in_polla is distinct from cm.participates_in_loan_profit),
    'retired_without_settlement', (select count(*) from public.fin03_member_mode_issues i where i.cycle_id = p_cycle_id and i.economic_mode = 'collective'),
    'settlements_without_bank_share', (select count(*) from public.member_settlements s where s.cycle_id = p_cycle_id and s.status <> 'reversed' and not (s.snapshot ? 'bank_yield_share')),
    'polla_over_quota', (select count(*) from (
        select pc.activity_id, pc.cycle_member_id from public.polla_contributions pc
        where pc.cycle_id = p_cycle_id and pc.status = 'posted' and pc.cycle_member_id is not null
        group by pc.activity_id, pc.cycle_member_id having sum(pc.amount) > 10000) x),
    'confirmed_bank_distributions', (select count(*) from public.bank_yield_distributions d where d.cycle_id = p_cycle_id and d.status = 'confirmed')
  )
$$;
revoke all on function public.fin_rules_activation_checks(uuid) from public, anon;
grant execute on function public.fin_rules_activation_checks(uuid) to authenticated;

create or replace function public.activate_fin_rules_2026(p_cycle_id uuid)
returns public.fin_rules_activations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  checks jsonb;
  created public.fin_rules_activations%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id for update;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  select * into created from public.fin_rules_activations where cycle_id = p_cycle_id and rules_version = 'fin03-2026';
  if created.id is not null then return created; end if;
  checks := public.fin_rules_activation_checks(p_cycle_id);
  if not (checks->>'close_date_ok')::boolean then raise exception 'La fecha de cierre 2026 debe ser el 5 de diciembre.'; end if;
  if (checks->>'incompatible_modes')::int > 0 then raise exception 'Hay % socios con polla y utilidad de prestamos distintas. Elija su modalidad antes de activar.', checks->>'incompatible_modes'; end if;
  if (checks->>'retired_without_settlement')::int > 0 then raise exception 'Hay % socios de polla retirados sin liquidacion.', checks->>'retired_without_settlement'; end if;
  if (checks->>'settlements_without_bank_share')::int > 0 then raise exception 'Hay % liquidaciones anteriores sin rendimiento Pibank conciliado.', checks->>'settlements_without_bank_share'; end if;
  if (checks->>'polla_over_quota')::int > 0 then raise exception 'Hay % aportes de polla por encima de $10.000 por actividad.', checks->>'polla_over_quota'; end if;
  if (checks->>'confirmed_bank_distributions')::int > 0 then raise exception 'Ya hay un reparto Pibank confirmado con reglas anteriores.'; end if;
  update public.cycles set settlement_rules_version = 'fin03-2026' where id = p_cycle_id;
  insert into public.fin_rules_activations (workspace_id, cycle_id, rules_version, activated_by, checks)
  values (target_cycle.workspace_id, p_cycle_id, 'fin03-2026', auth.uid(), checks)
  returning * into created;
  return created;
end;
$$;
revoke all on function public.activate_fin_rules_2026(uuid) from public, anon;
grant execute on function public.activate_fin_rules_2026(uuid) to authenticated;

create or replace function public.fix_cycle_close_date(p_cycle_id uuid, p_closes_on date)
returns public.cycles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id for update;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_closes_on is null or p_closes_on <= target_cycle.starts_on then raise exception 'Fecha de cierre invalida.'; end if;
  if exists (select 1 from public.member_settlements s where s.cycle_id = p_cycle_id and s.status <> 'reversed')
     or exists (select 1 from public.bank_yield_distributions d where d.cycle_id = p_cycle_id and d.status = 'confirmed') then
    raise exception 'Ya hay liquidaciones o repartos: la fecha de cierre no se puede cambiar sin conciliacion manual.';
  end if;
  update public.cycles set closes_on = p_closes_on where id = p_cycle_id returning * into target_cycle;
  return target_cycle;
end;
$$;
revoke all on function public.fix_cycle_close_date(uuid, date) from public, anon;
grant execute on function public.fix_cycle_close_date(uuid, date) to authenticated;

-- P0 / P1 Modalidades: en ciclos activados, polla y utilidad van juntas y no cambian despues del primer abono Pibank.
create or replace function public.fin03_set_economic_mode()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  activated boolean;
begin
  if tg_op = 'INSERT' then
    if new.economic_mode is null then
      new.economic_mode := case when new.participates_in_polla then 'collective' else 'fixed_yield' end;
    end if;
  elsif new.economic_mode is distinct from old.economic_mode then
    new.participates_in_polla := new.economic_mode = 'collective';
  elsif new.participates_in_polla is distinct from old.participates_in_polla then
    new.economic_mode := case when new.participates_in_polla then 'collective' else 'fixed_yield' end;
  end if;

  select c.settlement_rules_version = 'fin03-2026' into activated from public.cycles c where c.id = new.cycle_id;
  if coalesce(activated, false) then
    new.participates_in_polla := new.economic_mode = 'collective';
    new.participates_in_loan_profit := new.economic_mode = 'collective';
    if tg_op = 'UPDATE' and new.economic_mode is distinct from old.economic_mode and exists (
      select 1 from public.financial_operations fo where fo.cycle_id = new.cycle_id and fo.operation_type = 'bank_interest_received'
    ) then
      raise exception 'La modalidad no se puede cambiar despues del primer abono Pibank del ciclo.';
    end if;
  end if;
  return new;
end;
$$;

-- P0 Toda asignacion de premio (cualquier RPC) exige polla completa y un solo premio por actividad.
create or replace function public.fin04_validate_polla_prize()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.legacy_id is null then
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
drop trigger if exists fin04_validate_polla_prize on public.polla_prizes;
create trigger fin04_validate_polla_prize before insert or update on public.polla_prizes
  for each row execute function public.fin04_validate_polla_prize();

-- P0 Reversos con dependencias.
create or replace function public.fin04_guard_reversal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target public.financial_operations%rowtype;
begin
  if new.operation_type <> 'reversal' or new.reverses_operation_id is null then return new; end if;
  select * into target from public.financial_operations where id = new.reverses_operation_id;
  if target.operation_type in ('polla_prize_credited', 'bank_yield_distributed', 'bank_yield_settled', 'admin_fee_recognized') then
    raise exception 'Esta operacion genera derechos de socios o del administrador y no se revierte directamente.';
  end if;
  if target.operation_type = 'polla_prize_awarded' and exists (
    select 1 from public.member_capital_credits cc where cc.prize_id = target.reference_id
  ) then
    raise exception 'El premio ya se acredito al capital del ganador: no se puede revertir la asignacion.';
  end if;
  if target.operation_type = 'bank_interest_received' and (
    exists (select 1 from public.bank_yield_distributions d where d.cycle_id = target.cycle_id and d.status = 'confirmed' and d.cut_date >= target.effective_date)
    or exists (select 1 from public.member_settlements s where s.cycle_id = target.cycle_id and s.status <> 'reversed'
               and coalesce((s.snapshot->>'bank_yield_share')::numeric, 0) > 0 and s.cut_date >= target.effective_date)
  ) then
    raise exception 'Este rendimiento Pibank ya se reconocio a socios: no se puede revertir.';
  end if;
  if target.operation_type = 'member_settlement_confirmed' and exists (
    select 1 from public.financial_operations dep
    where dep.reference_table = 'member_settlements' and dep.reference_id = target.reference_id
      and dep.operation_type in ('admin_fee_recognized', 'bank_yield_settled')
  ) then
    raise exception 'Esta liquidacion reconocio administracion o rendimiento Pibank: su reverso requiere ajuste coordinado (pendiente).';
  end if;
  return new;
end;
$$;
drop trigger if exists fin04_guard_reversal on public.financial_operations;
create trigger fin04_guard_reversal before insert on public.financial_operations
  for each row execute function public.fin04_guard_reversal();

-- Liquidacion: administracion al fondo del administrador y Pibank reclasificado fuera del gasto de 12 % EA.
create or replace function public.fin03_recognize_settlement_admin_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fee numeric(18,2);
  share numeric(18,2);
  fund numeric(18,2);
begin
  if new.status = 'reversed' or coalesce(new.snapshot->>'fee_policy', '') <> 'fin03-2026' then return new; end if;
  fee := coalesce((new.snapshot->>'annual_admin_fee')::numeric, 0);
  share := coalesce((new.snapshot->>'bank_yield_share')::numeric, 0);
  fund := coalesce((new.snapshot->>'bank_yield_fund')::numeric, 0);
  if fee > 0 then
    perform public.create_b_operation(
      new.workspace_id, new.cycle_id, new.idempotency_key || ':admin-fee', 'admin_fee_recognized', new.cut_date,
      'member_settlements', new.id,
      jsonb_build_object('settlement_id', new.id, 'amount', fee),
      jsonb_build_array(
        jsonb_build_object('account', 'settlement_policy_pending', 'amount', fee, 'member_id', new.member_id),
        jsonb_build_object('account', 'admin_payable', 'amount', -fee, 'member_id', new.member_id)
      )
    );
  end if;
  if share + fund > 0 then
    perform public.create_b_operation(
      new.workspace_id, new.cycle_id, new.idempotency_key || ':pibank', 'bank_yield_settled', new.cut_date,
      'member_settlements', new.id,
      jsonb_build_object('settlement_id', new.id, 'bank_yield_share', share, 'bank_yield_fund', fund),
      jsonb_build_array(
        jsonb_build_object('account', 'savings_yield_expense', 'amount', -(share + fund), 'member_id', new.member_id),
        jsonb_build_object('account', 'bank_interest_income', 'amount', share, 'member_id', new.member_id),
        jsonb_build_object('account', 'member_bank_yield_payable', 'amount', fund, 'member_id', new.member_id)
      )
    );
  end if;
  return new;
end;
$$;

create or replace function public.confirm_bank_yield_distribution(p_cycle_id uuid, p_cut_date date, p_idempotency_key text, p_preview_hash text)
returns public.bank_yield_distributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  existing public.bank_yield_distributions%rowtype;
  created public.bank_yield_distributions%rowtype;
  preview jsonb;
  op public.financial_operations%rowtype;
  entries jsonb;
  beneficiary jsonb;
  pool numeric(18,2);
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id for update;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;
  -- FIN-04: solo con reglas activadas, al cierre oficial y con corte igual al cierre. Las simulaciones siguen libres.
  if target_cycle.settlement_rules_version is distinct from 'fin03-2026' then
    raise exception 'Active primero las reglas financieras 2026 del ciclo (requiere conciliacion).';
  end if;
  if p_cut_date <> target_cycle.closes_on then
    raise exception 'El reparto Pibank se confirma con corte en la fecha de cierre del ciclo (%).', target_cycle.closes_on;
  end if;
  if public.fin_civil_today() < target_cycle.closes_on then
    raise exception 'Todavia no es la fecha de cierre del ciclo (%). Puede simular, pero no confirmar.', target_cycle.closes_on;
  end if;

  select * into existing from public.bank_yield_distributions where workspace_id = target_cycle.workspace_id and idempotency_key = trim(p_idempotency_key);
  if existing.id is not null then
    if existing.cycle_id = p_cycle_id and existing.cut_date = p_cut_date and existing.preview_hash = p_preview_hash then return existing; end if;
    raise exception 'La clave de idempotencia del reparto ya existe con otro contenido.';
  end if;

  preview := public.preview_bank_yield_distribution(p_cycle_id, p_cut_date);
  if preview->>'preview_hash' <> p_preview_hash then raise exception 'Los datos cambiaron desde el calculo. Vuelva a calcular.'; end if;
  if not (preview->>'confirmation_allowed')::boolean then
    raise exception 'No se puede confirmar: no hay rendimiento por repartir, ya hay un reparto confirmado o hay socios retirados sin liquidacion.';
  end if;
  pool := (preview->>'pool')::numeric;

  insert into public.bank_yield_distributions (workspace_id, cycle_id, idempotency_key, cut_date, preview_hash, snapshot, net_received, savers_reserved, pool_amount, beneficiary_count, per_member_amount, residual_to_admin, created_by)
  values (target_cycle.workspace_id, p_cycle_id, trim(p_idempotency_key), p_cut_date, p_preview_hash, preview,
    (preview->>'net_received')::numeric, 0, pool, (preview->>'beneficiary_count')::integer, (preview->>'per_member')::numeric, 0, auth.uid())
  returning * into created;

  entries := jsonb_build_array(jsonb_build_object('account', 'bank_interest_income', 'amount', pool));
  for beneficiary in select * from jsonb_array_elements(preview->'beneficiaries') loop
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'member_bank_yield_payable', 'amount', -(beneficiary->>'amount')::numeric, 'member_id', (beneficiary->>'member_id')::uuid));
  end loop;

  op := public.create_b_operation(
    target_cycle.workspace_id, p_cycle_id, p_idempotency_key, 'bank_yield_distributed', p_cut_date,
    'bank_yield_distributions', created.id,
    jsonb_build_object('distribution_id', created.id, 'pool', pool, 'rule_version', preview->>'rule_version'),
    entries
  );
  update public.bank_yield_distributions set operation_id = op.id where id = created.id returning * into created;

  for beneficiary in select * from jsonb_array_elements(preview->'beneficiaries') loop
    if (beneficiary->>'amount')::numeric > 0 then
      insert into public.member_capital_credits (workspace_id, cycle_id, cycle_member_id, member_id, source_type, distribution_id, operation_id, idempotency_key, amount, effective_date)
      values (target_cycle.workspace_id, p_cycle_id, (beneficiary->>'cycle_member_id')::uuid, (beneficiary->>'member_id')::uuid, 'bank_yield', created.id, op.id,
        trim(p_idempotency_key) || ':' || (beneficiary->>'cycle_member_id'), (beneficiary->>'amount')::numeric, p_cut_date);
    end if;
  end loop;
  return created;
end;
$$;

create or replace function public.preview_member_settlement(
  p_cycle_member_id uuid,
  p_cut_date date,
  p_annual_admin_fee numeric,
  p_penalty_amount numeric,
  p_other_discounts numeric default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cm public.cycle_members%rowtype;
  capital numeric(18,2);
  recognized_yield numeric;
  recognized_yield_cents numeric(18,2);
  prizes numeric(18,2);
  principal_debt numeric(18,2);
  p013_interest numeric(18,2);
  debts numeric(18,2);
  net numeric(18,2);
  transfer numeric(18,2);
  rounding numeric(18,2);
  debt_items jsonb;
  prize_items jsonb;
  savings_sources jsonb;
  snapshot jsonb;
  credit_capital numeric(18,2);
  prize_credit_yield numeric;
  credit_items jsonb;
  target_cycle public.cycles%rowtype;
  enforced boolean;
  fee numeric(18,2);
  pen numeric(18,2);
  bank_share numeric(18,2) := 0;
  bank_fund numeric(18,2) := 0;
  unverified_prizes integer := 0;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into cm from public.cycle_members where id = p_cycle_member_id;
  if cm.id is null then raise exception 'Participacion no encontrada.'; end if;
  if not public.current_user_is_workspace_admin(cm.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_cut_date is null or p_cut_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de corte invalida.'; end if;
  perform public.assert_money_2(coalesce(p_annual_admin_fee, 0), 'cuota anual', false);
  perform public.assert_money_2(coalesce(p_penalty_amount, 0), 'penalidad', false);
  perform public.assert_money_2(coalesce(p_other_discounts, 0), 'otros descuentos', false);

  -- FIN-03: administracion $20.000 una sola vez por ciclo y multa $50.000 por retiro antes del cierre, fijadas por el servidor.
  select * into target_cycle from public.cycles where id = cm.cycle_id;
  enforced := target_cycle.settlement_rules_version = 'fin03-2026';
  if enforced then
    fee := case when exists (
      select 1 from public.member_settlements s
      where s.cycle_member_id = cm.id and s.status <> 'reversed' and coalesce((s.snapshot->>'annual_admin_fee')::numeric, 0) > 0
    ) then 0 else 20000 end;
    pen := case when p_cut_date < target_cycle.closes_on then 50000 else 0 end;
  else
    fee := coalesce(p_annual_admin_fee, 0);
    pen := coalesce(p_penalty_amount, 0);
  end if;

  select round(coalesce(sum(sc.amount), 0), 2),
         coalesce(sum(sc.amount * (power(1.12::double precision, greatest(0, p_cut_date - sc.effective_date)::double precision / 365.0) - 1)), 0),
         coalesce(jsonb_agg(jsonb_build_object('contribution_id', sc.id, 'amount', sc.amount, 'effective_date', sc.effective_date, 'applied_year', sc.applied_year, 'applied_month', sc.applied_month) order by sc.effective_date, sc.id), '[]'::jsonb)
  into capital, recognized_yield, savings_sources
  from public.savings_contributions sc
  where sc.cycle_member_id = cm.id
    and sc.status = 'posted'
    and sc.effective_date <= p_cut_date;
  select round(coalesce(sum(cc.amount) filter (where cc.source_type <> 'bank_yield' or not enforced), 0), 2),
         coalesce(sum(cc.amount * (power(1.12::double precision, greatest(0, p_cut_date - cc.effective_date)::double precision / 365.0) - 1)) filter (where cc.source_type = 'polla_prize'), 0),
         coalesce(jsonb_agg(jsonb_build_object('credit_id', cc.id, 'source_type', cc.source_type, 'amount', cc.amount, 'effective_date', cc.effective_date) order by cc.effective_date, cc.id), '[]'::jsonb)
  into credit_capital, prize_credit_yield, credit_items
  from public.member_capital_credits cc
  where cc.cycle_member_id = cm.id
    and cc.effective_date <= p_cut_date;

  capital := round(capital + credit_capital, 2);
  -- FIN-04: el fondo individual Pibank no es capital de ahorro; se entrega aparte en la liquidacion.
  if enforced then
    select round(coalesce(sum(cc.amount), 0), 2) into bank_fund
    from public.member_capital_credits cc
    where cc.cycle_member_id = cm.id and cc.source_type = 'bank_yield' and cc.effective_date <= p_cut_date;
  end if;
  -- FIN-02: quien juega polla recibe su parte del rendimiento bancario al cierre (ya incluida en capital);
  -- el 12 % EA solo aplica a quien ahorra sin jugar polla, sobre aportes y premios acreditados.
  if cm.participates_in_polla then
    -- Modalidad A: sin 12 % EA. Recibe su parte de cada abono Pibank hasta el corte, salvo lo ya repartido al cierre.
    recognized_yield := 0;
    if enforced then
      select round(coalesce(sum(s.amount), 0), 2) into bank_share
      from public.bank_yield_shares(cm.cycle_id, p_cut_date) s
      where s.cycle_member_id = cm.id
        and not exists (
          select 1 from public.bank_yield_distributions d
          where d.cycle_id = cm.cycle_id and d.status = 'confirmed' and d.cut_date >= s.effective_date
        );
      recognized_yield := bank_share + bank_fund;
    end if;
  else
    recognized_yield := recognized_yield + prize_credit_yield;
  end if;
  recognized_yield_cents := round(recognized_yield, 2);

  select coalesce(jsonb_agg(jsonb_build_object('prize_id', pp.id, 'net_amount', pp.net_amount, 'awarded_at', pp.awarded_at) order by pp.awarded_at, pp.id), '[]'::jsonb),
         round(coalesce(sum(pp.net_amount), 0), 2)
  into prize_items, prizes
  from public.polla_prizes pp
  where pp.winner_cycle_member_id = cm.id
    and pp.status = 'pending_payment'
    and pp.legacy_payment_status <> 'historical_payment_unverified'
    and pp.awarded_at <= p_cut_date;

  with loan_balances as (
    select lc.id,
           round(lc.principal
             - coalesce(lc.legacy_paid_capital_amount, 0)
             - coalesce((
                 select sum(lp.capital_amount)
                 from public.loan_payments lp
                 join public.financial_operations pay_op on pay_op.id = lp.operation_id
                 left join public.financial_operations rev_op on rev_op.reverses_operation_id = pay_op.id and rev_op.effective_date <= p_cut_date
                 where lp.loan_id = lc.id
                   and pay_op.effective_date <= p_cut_date
                   and rev_op.id is null
               ), 0)
             - coalesce((
                 select sum(sda.principal_amount)
                 from public.member_settlement_debt_applications sda
                 join public.member_settlements ms on ms.id = sda.settlement_id
                 where sda.loan_id = lc.id
                   and ms.cut_date <= p_cut_date
                   and ms.status <> 'reversed'
               ), 0), 2) as principal_due,
           case when lc.settlement_agreement_code = 'P013_FIRST_MONTH' then
             greatest(0, round(coalesce(lc.prepayment_first_month_interest, 0)
               - coalesce(lc.legacy_paid_interest_amount, 0)
               - coalesce((
                   select sum(lp.interest_amount)
                   from public.loan_payments lp
                   join public.financial_operations pay_op on pay_op.id = lp.operation_id
                   left join public.financial_operations rev_op on rev_op.reverses_operation_id = pay_op.id and rev_op.effective_date <= p_cut_date
                   where lp.loan_id = lc.id
                     and pay_op.effective_date <= p_cut_date
                     and rev_op.id is null
                 ), 0)
               - coalesce((
                   select sum(sda.interest_amount)
                   from public.member_settlement_debt_applications sda
                   join public.member_settlements ms on ms.id = sda.settlement_id
                   where sda.loan_id = lc.id
                     and ms.cut_date <= p_cut_date
                     and ms.status <> 'reversed'
                 ), 0), 2))
           else 0 end as interest_due
    from public.loan_contracts lc
    left join public.financial_operations disb_op on disb_op.id = lc.disbursed_operation_id
    left join public.financial_operations legacy_op
      on legacy_op.workspace_id = lc.workspace_id
     and legacy_op.cycle_id = lc.cycle_id
     and legacy_op.reference_table = 'loan_contracts'
     and legacy_op.reference_id = lc.id
     and legacy_op.operation_type = 'legacy_opening'
    where lc.workspace_id = cm.workspace_id
      and lc.cycle_id = cm.cycle_id
      and lc.borrower_member_id = cm.member_id
      and (lc.disbursed_operation_id is not null or legacy_op.id is not null)
      and coalesce(disb_op.effective_date, legacy_op.effective_date, lc.start_date) <= p_cut_date
      and not exists (
        select 1
        from public.financial_operations rev_op
        where rev_op.reverses_operation_id = coalesce(disb_op.id, legacy_op.id)
          and rev_op.effective_date <= p_cut_date
      )
  )
  select coalesce(jsonb_agg(jsonb_build_object('loan_id', id, 'principal_amount', principal_due, 'interest_amount', interest_due) order by id) filter (where principal_due > 0 or interest_due > 0), '[]'::jsonb),
         round(coalesce(sum(principal_due), 0), 2),
         round(coalesce(sum(interest_due), 0), 2)
  into debt_items, principal_debt, p013_interest
  from loan_balances
  where principal_due > 0 or interest_due > 0;

  debts := round(principal_debt + p013_interest, 2);
  net := round(capital + recognized_yield_cents + prizes - debts - fee - pen - coalesce(p_other_discounts, 0), 2);
  transfer := round(net, 0);
  rounding := round(transfer - net, 2);

  snapshot := jsonb_build_object(
    'rule_version', 'fin02-capital-credits-2026',
    'bank_yield_share', bank_share,
    'bank_yield_fund', bank_fund,
    'unverified_prizes_excluded', (select count(*) from public.polla_prizes up where up.winner_cycle_member_id = cm.id and up.status = 'pending_payment' and up.legacy_payment_status = 'historical_payment_unverified'),
    'fee_policy', case when enforced then 'fin03-2026' else 'manual' end,
    'yield_policy', case when cm.participates_in_polla then 'bank_yield_equal_share' else 'savings_12_ea' end,
    'capital_credits', credit_capital,
    'credit_items', coalesce(credit_items, '[]'::jsonb),
    'cycle_member_id', cm.id,
    'member_id', cm.member_id,
    'cycle_id', cm.cycle_id,
    'workspace_id', cm.workspace_id,
    'cut_date', p_cut_date,
    'annual_effective_rate', 0.12,
    'capital', capital,
    'recognized_yield_unrounded', recognized_yield,
    'recognized_yield', recognized_yield_cents,
    'pending_net_prizes', prizes,
    'principal_debt', principal_debt,
    'p013_first_month_interest', p013_interest,
    'debts', debts,
    'annual_admin_fee', fee,
    'penalty', pen,
    'other_discounts', coalesce(p_other_discounts, 0),
    'net', net,
    'transfer_amount', transfer,
    'rounding_adjustment', rounding,
    'savings_sources', coalesce(savings_sources, '[]'::jsonb),
    'debt_items', coalesce(debt_items, '[]'::jsonb),
    'prize_items', coalesce(prize_items, '[]'::jsonb),
    'policy_note', 'Penalidad, cuota anual y otros descuentos son parametros de acuerdo/version; destino pendiente queda en settlement_policy_pending.'
  );

  return snapshot || jsonb_build_object('preview_hash', md5(snapshot::text));
end;
$$;

grant execute on function public.confirm_bank_yield_distribution(uuid, date, text, text) to authenticated;
