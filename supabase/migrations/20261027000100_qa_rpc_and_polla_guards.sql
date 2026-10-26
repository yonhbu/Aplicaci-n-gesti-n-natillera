-- QA audit: explicit predicates for temporary cleanup under PostgREST safe-update.
-- No financial formulas, historical rows or global database settings are changed.

create or replace function public.preview_bank_yield_distribution(p_cycle_id uuid, p_cut_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  net_received numeric(18,2);
  pool numeric(18,2);
  in_withdrawals numeric(18,2);
  unassigned numeric(18,2);
  already numeric(18,2);
  n integer;
  per_min numeric(18,2);
  per_max numeric(18,2);
  unresolved integer;
  beneficiaries jsonb;
  snapshot jsonb;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into target_cycle from public.cycles where id = p_cycle_id;
  if target_cycle.id is null then raise exception 'Ciclo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(target_cycle.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_cut_date is null or p_cut_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de corte invalida.'; end if;

  select round(coalesce(sum(le.amount), 0), 2) into net_received
  from public.ledger_entries le
  join public.financial_operations fo on fo.id = le.operation_id
  where fo.cycle_id = p_cycle_id and fo.operation_type = 'bank_interest_received' and le.account = 'cash'
    and fo.effective_date <= p_cut_date
    and not exists (select 1 from public.financial_operations rev where rev.reverses_operation_id = fo.id);

  create temporary table if not exists fin03_shares (operation_id uuid, effective_date date, cycle_member_id uuid, member_id uuid, amount numeric, in_withdrawal boolean) on commit drop;
  delete from pg_temp.fin03_shares where true;
  insert into fin03_shares
  select s.operation_id, s.effective_date, s.cycle_member_id, s.member_id, s.amount,
         exists (
           select 1 from public.member_settlements ms
           where ms.cycle_member_id = s.cycle_member_id and ms.status <> 'reversed'
             and ms.cut_date >= s.effective_date and ms.snapshot ? 'bank_yield_share'
         )
  from public.bank_yield_shares(p_cycle_id, p_cut_date) s;

  select round(coalesce(sum(amount) filter (where not in_withdrawal), 0), 2),
         round(coalesce(sum(amount) filter (where in_withdrawal), 0), 2)
  into pool, in_withdrawals
  from fin03_shares;
  unassigned := round(net_received - pool - in_withdrawals, 2);

  select count(*), min(total), max(total),
         coalesce(jsonb_agg(jsonb_build_object('cycle_member_id', cmid, 'member_id', mid, 'display_name', name, 'amount', total) order by name, cmid), '[]'::jsonb)
  into n, per_min, per_max, beneficiaries
  from (
    select sh.cycle_member_id as cmid, sh.member_id as mid, m.display_name as name, round(sum(sh.amount), 2) as total
    from fin03_shares sh join public.members m on m.id = sh.member_id
    where not sh.in_withdrawal
    group by sh.cycle_member_id, sh.member_id, m.display_name
  ) b;

  select count(*) into unresolved from public.fin03_member_mode_issues i where i.cycle_id = p_cycle_id and i.economic_mode = 'collective';
  select round(coalesce(sum(pool_amount), 0), 2) into already from public.bank_yield_distributions where cycle_id = p_cycle_id and status = 'confirmed';

  snapshot := jsonb_build_object(
    'rule_version', 'fin03-bank-yield-per-abono-2026',
    'cycle_id', p_cycle_id,
    'cut_date', p_cut_date,
    'net_received', net_received,
    'recognized_in_withdrawals', in_withdrawals,
    'unassigned', unassigned,
    'savers_reserved', 0,
    'already_distributed', already,
    'pool', pool,
    'beneficiary_count', n,
    'per_member', coalesce(per_min, 0),
    'per_member_max', coalesce(per_max, 0),
    'residual_to_admin', 0,
    'shortfall', 0,
    'unresolved_members', unresolved,
    'beneficiaries', beneficiaries,
    'confirmation_allowed', pool > 0 and unresolved = 0
      and not exists (select 1 from public.bank_yield_distributions d where d.cycle_id = p_cycle_id and d.status = 'confirmed')
  );
  return snapshot || jsonb_build_object('preview_hash', md5(snapshot::text));
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
  delete from pg_temp.fin05_shares where true;
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
  delete from pg_temp.fin05_members where true;
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
    and fo.operation_type not in ('loan_payment', 'loan_prepayment', 'member_settlement_confirmed')
    -- A coordinated reversal restores the original fund; it is not new income.
    -- Exclude only the reversal actually linked to a reversed distribution.
    and not (fo.operation_type = 'loan_profit_period_reversed' and exists (
      select 1 from public.loan_profit_period_distributions d
      where d.reversed_operation_id = fo.id and d.status = 'reversed'
        and d.cycle_id = p_cycle_id
    ));

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

  select count(*) filter (where fm.unresolved) into unresolved from fin05_members as fm;
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
  if paid + new.amount > 10000 then
    raise exception 'El aporte de polla es de $10.000 por actividad; este socio ya tiene %.', paid;
  end if;
  return new;
end;
$$;
