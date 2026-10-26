-- FIN-03: consolidacion de reglas financieras 2026 (prompt maestro).
-- Corrige FIN-02 donde contradecia las reglas definitivas:
--   * Sin reserva del 12 % EA sobre el rendimiento Pibank (3.6) y sin sobrantes al administrador (3.5).
--   * Rendimiento Pibank atribuido abono por abono a los socios elegibles en la fecha de cada abono (3.4):
--     el retirado recibe en su liquidacion lo que le toco hasta su retiro; el resto se reparte al cierre.
--   * Administracion $20.000 una vez y multa $50.000 por retiro anticipado, fijadas por el servidor (6.2, 6.3).
--   * El premio de un ganador que ya liquido su ahorro se entrega como pago, no se acredita al capital (4.2).
--   * Validaciones de polla en servidor: tope $10.000 por actividad, actividad ya jugada, aportes posteriores al retiro (5.4).
-- Las reglas nuevas aplican a ciclos con settlement_rules_version = 'fin03-2026'.

alter table public.cycles add column if not exists settlement_rules_version text;
update public.cycles set settlement_rules_version = 'fin03-2026' where year = 2026 and settlement_rules_version is null;

-- 1.1 Modalidad economica explicita.
alter table public.cycle_members add column if not exists economic_mode text;
update public.cycle_members set economic_mode = case when participates_in_polla then 'collective' else 'fixed_yield' end where economic_mode is null;
alter table public.cycle_members drop constraint if exists cycle_members_economic_mode_check;
alter table public.cycle_members add constraint cycle_members_economic_mode_check check (economic_mode in ('collective', 'fixed_yield'));

create or replace function public.fin03_set_economic_mode()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.economic_mode is null then
      new.economic_mode := case when new.participates_in_polla then 'collective' else 'fixed_yield' end;
    end if;
  elsif new.economic_mode is not distinct from old.economic_mode and new.participates_in_polla is distinct from old.participates_in_polla then
    new.economic_mode := case when new.participates_in_polla then 'collective' else 'fixed_yield' end;
  end if;
  return new;
end;
$$;
drop trigger if exists fin03_set_economic_mode on public.cycle_members;
create trigger fin03_set_economic_mode before insert or update on public.cycle_members
  for each row execute function public.fin03_set_economic_mode();

-- Combinaciones a revisar a mano: ahorrador de 12 % EA marcado para utilidad de prestamos (7.1).
create or replace view public.fin03_member_mode_issues with (security_invoker = true) as
select cm.workspace_id, cm.cycle_id, cm.id as cycle_member_id, m.display_name, cm.economic_mode,
       cm.participates_in_polla, cm.participates_in_loan_profit, cm.savings_status,
       case
         when cm.economic_mode = 'fixed_yield' and cm.participates_in_loan_profit then 'Ahorrador de 12 % EA marcado para utilidad de prestamos'
         when cm.economic_mode = 'collective' and cm.savings_status <> 'active'
              and not exists (select 1 from public.member_settlements s where s.cycle_member_id = cm.id and s.status <> 'reversed')
           then 'Retirado sin liquidacion registrada: no se puede atribuir su rendimiento Pibank'
       end as issue
from public.cycle_members cm
join public.members m on m.id = cm.member_id
where (cm.economic_mode = 'fixed_yield' and cm.participates_in_loan_profit)
   or (cm.economic_mode = 'collective' and cm.savings_status <> 'active'
       and not exists (select 1 from public.member_settlements s where s.cycle_member_id = cm.id and s.status <> 'reversed'));
grant select on public.fin03_member_mode_issues to authenticated;

alter table public.financial_operations drop constraint if exists financial_operations_operation_type_check;
alter table public.financial_operations
  add constraint financial_operations_operation_type_check check (operation_type in (
    'savings_contribution_linked', 'loan_disbursement', 'loan_payment', 'loan_prepayment',
    'polla_contribution', 'polla_prize_awarded', 'polla_prize_paid', 'polla_prize_credited',
    'manual_income', 'manual_expense', 'admin_withdrawal', 'admin_fee_recognized',
    'bank_opening', 'bank_external_financing', 'bank_interest_received', 'bank_fee', 'bank_yield_distributed',
    'liquidity_transfer', 'member_settlement_confirmed', 'member_settlement_paid',
    'loan_profit_distribution_confirmed', 'loan_profit_distribution_paid',
    'legacy_opening', 'reversal'
  ));

-- 3.4 / 3.5 Reparto determinista de cada abono Pibank entre los elegibles en su fecha.
-- Igual por persona; los centavos que no dividen exacto van uno a uno en orden de nombre. Nunca supera lo recibido.
create or replace function public.bank_yield_shares(p_cycle_id uuid, p_cut_date date)
returns table (operation_id uuid, effective_date date, cycle_member_id uuid, member_id uuid, amount numeric)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  op record;
begin
  for op in
    select fo.id as op_id, fo.effective_date as op_date, round(sum(le.amount) * 100) as cents
    from public.financial_operations fo
    join public.ledger_entries le on le.operation_id = fo.id and le.account = 'cash'
    where fo.cycle_id = p_cycle_id
      and fo.operation_type = 'bank_interest_received'
      and fo.effective_date <= p_cut_date
      and not exists (select 1 from public.financial_operations rev where rev.reverses_operation_id = fo.id)
    group by fo.id, fo.effective_date
    having sum(le.amount) > 0
  loop
    return query
    with el as (
      select cm.id as cmid, cm.member_id as mid,
             row_number() over (order by m.display_name, cm.id) as rn,
             count(*) over () as n
      from public.cycle_members cm
      join public.members m on m.id = cm.member_id
      where cm.cycle_id = p_cycle_id
        and cm.economic_mode = 'collective'
        and cm.participates_in_polla
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
           round((floor(op.cents / el.n) + case when el.rn <= op.cents - floor(op.cents / el.n) * el.n then 1 else 0 end) / 100.0, 2)
    from el;
  end loop;
end;
$$;
revoke all on function public.bank_yield_shares(uuid, date) from public, anon, authenticated;

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
  delete from fin03_shares;
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
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'savings_liability', 'amount', -(beneficiary->>'amount')::numeric, 'member_id', (beneficiary->>'member_id')::uuid));
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
  select round(coalesce(sum(cc.amount), 0), 2),
         coalesce(sum(cc.amount * (power(1.12::double precision, greatest(0, p_cut_date - cc.effective_date)::double precision / 365.0) - 1)) filter (where cc.source_type = 'polla_prize'), 0),
         coalesce(jsonb_agg(jsonb_build_object('credit_id', cc.id, 'source_type', cc.source_type, 'amount', cc.amount, 'effective_date', cc.effective_date) order by cc.effective_date, cc.id), '[]'::jsonb)
  into credit_capital, prize_credit_yield, credit_items
  from public.member_capital_credits cc
  where cc.cycle_member_id = cm.id
    and cc.effective_date <= p_cut_date;

  capital := round(capital + credit_capital, 2);
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
      recognized_yield := bank_share;
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

create or replace function public.credit_polla_prize_to_capital(p_prize_id uuid, p_idempotency_key text, p_credited_date date)
returns public.member_capital_credits
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prize public.polla_prizes%rowtype;
  winner public.cycle_members%rowtype;
  existing public.member_capital_credits%rowtype;
  op public.financial_operations%rowtype;
  created public.member_capital_credits%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into prize from public.polla_prizes where id = p_prize_id for update;
  if prize.id is null then raise exception 'Premio no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(prize.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;

  select * into existing from public.member_capital_credits where workspace_id = prize.workspace_id and idempotency_key = trim(p_idempotency_key);
  if existing.id is not null then
    if existing.prize_id = prize.id then return existing; end if;
    raise exception 'La clave de idempotencia del abono ya existe con otro contenido.';
  end if;
  if exists (select 1 from public.member_capital_credits where prize_id = prize.id) then
    raise exception 'Este premio ya fue acreditado al capital.';
  end if;
  if prize.status <> 'pending_payment' then raise exception 'El premio no esta pendiente.'; end if;
  if prize.legacy_payment_status = 'historical_payment_unverified' then
    raise exception 'Premio historico sin verificar: confirme primero que no se pago antes.';
  end if;
  if exists (select 1 from public.member_settlements s where s.cycle_member_id = prize.winner_cycle_member_id and s.status <> 'reversed') then
    raise exception 'El ganador ya liquido su ahorro: el premio se entrega como pago, no se acredita al capital.';
  end if;
  if p_credited_date is null or p_credited_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha invalida.'; end if;
  if prize.awarded_at is not null and p_credited_date < prize.awarded_at then raise exception 'La fecha del abono no puede ser anterior al premio.'; end if;

  select * into winner from public.cycle_members where id = prize.winner_cycle_member_id;

  op := public.create_b_operation(
    prize.workspace_id, prize.cycle_id, p_idempotency_key, 'polla_prize_credited', p_credited_date,
    'polla_prizes', prize.id,
    jsonb_build_object('prize_id', prize.id, 'amount', prize.net_amount, 'cycle_member_id', winner.id),
    jsonb_build_array(
      jsonb_build_object('account', 'prizes_payable', 'amount', prize.net_amount, 'prize_id', prize.id, 'member_id', winner.member_id),
      jsonb_build_object('account', 'savings_liability', 'amount', -prize.net_amount, 'prize_id', prize.id, 'member_id', winner.member_id)
    )
  );

  insert into public.member_capital_credits (workspace_id, cycle_id, cycle_member_id, member_id, source_type, prize_id, operation_id, idempotency_key, amount, effective_date)
  values (prize.workspace_id, prize.cycle_id, winner.id, winner.member_id, 'polla_prize', prize.id, op.id, trim(p_idempotency_key), prize.net_amount, p_credited_date)
  returning * into created;
  update public.polla_prizes set status = 'settled', paid_operation_id = op.id where id = prize.id;
  return created;
end;
$$;

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
  if (select coalesce(sum(pc.amount), 0) from public.polla_contributions pc
      where pc.activity_id = p_activity_id and pc.cycle_member_id = p_winner_cycle_member_id and pc.status = 'posted') < 10000 then
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

create or replace function public.pay_polla_prize(p_prize_id uuid, p_idempotency_key text, p_paid_date date)
returns public.polla_prize_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prize public.polla_prizes%rowtype;
  existing public.polla_prize_payments%rowtype;
  op public.financial_operations%rowtype;
  created public.polla_prize_payments%rowtype;
begin
  select * into prize from public.polla_prizes where id = p_prize_id for update;
  if prize.id is null then raise exception 'Premio no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(prize.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;

  select * into existing from public.polla_prize_payments
  where workspace_id = prize.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.prize_id = prize.id and existing.amount = prize.net_amount and existing.paid_date = p_paid_date then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del pago de premio ya existe con otro contenido.';
  end if;

  if prize.status <> 'pending_payment' then raise exception 'El premio no esta pendiente de pago.'; end if;
  if not exists (select 1 from public.member_settlements s where s.cycle_member_id = prize.winner_cycle_member_id and s.status <> 'reversed') then
    raise exception 'Los premios de polla se acreditan al capital del ganador; solo se entregan en pago a socios que ya liquidaron su ahorro.';
  end if;
  if prize.legacy_payment_status = 'historical_payment_unverified' then
    raise exception 'Premio historico sin verificar: confirme primero que no se pago antes de registrar el pago.';
  end if;
  if p_paid_date is null or p_paid_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de pago de premio invalida.'; end if;

  op := public.create_b_operation(
    prize.workspace_id, prize.cycle_id, p_idempotency_key, 'polla_prize_paid', p_paid_date,
    'polla_prizes', prize.id,
    jsonb_build_object('prize_id', prize.id, 'amount', prize.net_amount),
    jsonb_build_array(
      jsonb_build_object('account', 'prizes_payable', 'amount', prize.net_amount, 'prize_id', prize.id),
      jsonb_build_object('account', 'cash', 'amount', -prize.net_amount, 'prize_id', prize.id)
    )
  );

  insert into public.polla_prize_payments (workspace_id, cycle_id, prize_id, operation_id, idempotency_key, amount, paid_date)
  values (prize.workspace_id, prize.cycle_id, prize.id, op.id, trim(p_idempotency_key), prize.net_amount, p_paid_date)
  returning * into created;
  update public.polla_prizes set status = 'paid', paid_operation_id = op.id, legacy_payment_status = 'paid_verified' where id = prize.id;
  return created;
end;
$$;

-- 5.4 Validaciones de aportes de polla en el servidor.
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
drop trigger if exists fin03_validate_polla_contribution on public.polla_contributions;
create trigger fin03_validate_polla_contribution before insert on public.polla_contributions
  for each row execute function public.fin03_validate_polla_contribution();

-- 6.2 / 8.2 La administracion anual pasa al fondo del administrador al confirmar la liquidacion.
-- La multa queda en settlement_policy_pending hasta definir su titular (decision pendiente).
create or replace function public.fin03_recognize_settlement_admin_fee()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fee numeric(18,2);
begin
  if new.status = 'reversed' or coalesce(new.snapshot->>'fee_policy', '') <> 'fin03-2026' then return new; end if;
  fee := coalesce((new.snapshot->>'annual_admin_fee')::numeric, 0);
  if fee <= 0 then return new; end if;
  perform public.create_b_operation(
    new.workspace_id, new.cycle_id, new.idempotency_key || ':admin-fee', 'admin_fee_recognized', new.cut_date,
    'member_settlements', new.id,
    jsonb_build_object('settlement_id', new.id, 'amount', fee),
    jsonb_build_array(
      jsonb_build_object('account', 'settlement_policy_pending', 'amount', fee, 'member_id', new.member_id),
      jsonb_build_object('account', 'admin_payable', 'amount', -fee, 'member_id', new.member_id)
    )
  );
  return new;
end;
$$;
drop trigger if exists fin03_recognize_settlement_admin_fee on public.member_settlements;
create trigger fin03_recognize_settlement_admin_fee after insert on public.member_settlements
  for each row execute function public.fin03_recognize_settlement_admin_fee();

grant execute on function public.preview_bank_yield_distribution(uuid, date) to authenticated;
grant execute on function public.confirm_bank_yield_distribution(uuid, date, text, text) to authenticated;
grant execute on function public.award_polla_prize_to_capital(uuid, uuid, text, numeric, date) to authenticated;
grant execute on function public.credit_polla_prize_to_capital(uuid, text, date) to authenticated;
grant execute on function public.pay_polla_prize(uuid, text, date) to authenticated;
