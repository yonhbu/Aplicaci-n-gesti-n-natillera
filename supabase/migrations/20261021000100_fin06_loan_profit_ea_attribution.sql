-- FIN-06 (FIN-03.1 final): decisiones del administrador sobre ingreso a mitad de ano y utilidad de retirados.
-- 1. Pibank: se mantiene el reparto por abono segun la fecha efectiva del rendimiento (no la de digitacion).
--    Quien ingresa en junio participa desde junio (participation_start_month). Sin cambios de codigo.
-- 2. Utilidad de prestamos del retirado: sobre intereses efectivamente cobrados durante su participacion,
--    con atribucion temporal del costo del 12 % EA. Al retirarse se descuenta su parte del 12 % EA devengado
--    hasta su corte que aun no estaba cubierto por cobros; ese costo cuenta como reservado para los cobros siguientes.

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
      and fo.operation_type not in ('loan_profit_distribution_confirmed', 'loan_profit_distribution_paid', 'loan_profit_period_confirmed', 'reversal')
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
    'no_beneficiary', no_beneficiary,
    'frozen_total', frozen_total,
    'active_total', round(coalesce((select sum(final_amount) from fin05_members where not frozen), 0), 2),
    'collective_total', round(coalesce((select sum(final_amount) from fin05_members), 0), 2),
    'unresolved_settlements', unresolved,
    'previous_distributions', old_distributions,
    'beneficiaries', beneficiaries,
    'confirmation_allowed', shortfall = 0 and unresolved = 0 and old_distributions = 0
      and not exists (select 1 from public.loan_profit_period_distributions d where d.cycle_id = p_cycle_id and d.status <> 'reversed')
  );
  return snapshot || jsonb_build_object('preview_hash', md5(snapshot::text));
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
  loan_frozen numeric(18,2) := 0;
  loan_gross numeric(18,2) := 0;
  loan_charge numeric(18,2) := 0;
  lp_gap numeric(18,2) := 0;
  lp_pool numeric(18,2) := 0;
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
      -- FIN-05: derecho congelado sobre utilidad de prestamos cobrada hasta el corte; se paga en el reparto de diciembre.
      select round(coalesce(sum(ls.amount), 0), 2) into loan_frozen
      from public.loan_profit_shares(cm.cycle_id, p_cut_date) ls
      where ls.cycle_member_id = cm.id and ls.kind = 'collective';
      loan_gross := loan_frozen;
      -- FIN-06: en retiro anticipado se descuenta su parte del 12 % EA devengado y aun no cubierto hasta el corte,
      -- a prorrata entre quienes seguian participando, para no cargar ese costo solo a diciembre.
      if p_cut_date < target_cycle.closes_on and loan_gross > 0 then
        select greatest(0, public.fin_ea_accrued(cm.cycle_id, p_cut_date)
          - coalesce((select sum(x.amount) from public.loan_profit_shares(cm.cycle_id, p_cut_date) x where x.kind = 'ea_reserve'), 0)
          - coalesce((select sum(coalesce((s.snapshot->>'loan_profit_ea_charge')::numeric, 0)) from public.member_settlements s
                      where s.cycle_id = cm.cycle_id and s.status <> 'reversed' and s.cut_date <= p_cut_date and s.cycle_member_id <> cm.id), 0))
        into lp_gap;
        select coalesce(sum(x.amount), 0) into lp_pool
        from public.loan_profit_shares(cm.cycle_id, p_cut_date) x
        where x.kind = 'collective'
          and not exists (select 1 from public.member_settlements s where s.cycle_member_id = x.cycle_member_id and s.status <> 'reversed' and s.cut_date <= p_cut_date and s.cycle_member_id <> cm.id);
        if lp_pool > 0 then
          loan_charge := least(loan_gross, round(lp_gap * loan_gross / lp_pool, 2));
        end if;
        loan_frozen := loan_gross - loan_charge;
      end if;
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
    'loan_profit_frozen', loan_frozen,
    'loan_profit_gross', loan_gross,
    'loan_profit_ea_charge', loan_charge,
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
