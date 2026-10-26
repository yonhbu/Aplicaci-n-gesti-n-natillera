-- FIN-02: premios al capital, reparto igual del rendimiento bancario al cierre, 12 % EA solo para ahorradores sin polla.
-- Reglas confirmadas por el administrador (15 oct 2026):
--   * El premio neto de polla se acredita siempre al capital del ganador; nunca se paga en efectivo. La comision de $5.000 queda en admin_payable.
--   * El rendimiento bancario se reparte al cerrar el ciclo, en partes iguales, entre socios activos marcados "Participa en polla".
--   * Antes se reserva el 12 % EA de quienes ahorran sin jugar polla (ya liquidados y proyectado de los activos).
--   * Lo repartido suma al capital de ahorro y se entrega en la liquidacion. El premio acreditado genera rendimiento como el ahorro.
--   * El sobrante del reparto (pesos que no dividen exacto) va al fondo del administrador.

alter table public.financial_operations drop constraint if exists financial_operations_operation_type_check;
alter table public.financial_operations
  add constraint financial_operations_operation_type_check check (operation_type in (
    'savings_contribution_linked', 'loan_disbursement', 'loan_payment', 'loan_prepayment',
    'polla_contribution', 'polla_prize_awarded', 'polla_prize_paid', 'polla_prize_credited',
    'manual_income', 'manual_expense', 'admin_withdrawal',
    'bank_opening', 'bank_external_financing', 'bank_interest_received', 'bank_fee', 'bank_yield_distributed',
    'liquidity_transfer', 'member_settlement_confirmed', 'member_settlement_paid',
    'loan_profit_distribution_confirmed', 'loan_profit_distribution_paid',
    'legacy_opening', 'reversal'
  ));

create table if not exists public.bank_yield_distributions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  operation_id uuid references public.financial_operations(id),
  idempotency_key text not null,
  cut_date date not null,
  preview_hash text not null,
  snapshot jsonb not null,
  net_received numeric(18,2) not null,
  savers_reserved numeric(18,2) not null,
  pool_amount numeric(18,2) not null check (pool_amount >= 0),
  beneficiary_count integer not null check (beneficiary_count >= 0),
  per_member_amount numeric(18,2) not null check (per_member_amount >= 0),
  residual_to_admin numeric(18,2) not null check (residual_to_admin >= 0),
  status text not null default 'confirmed' check (status in ('confirmed', 'reversed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create unique index if not exists bank_yield_distributions_one_per_cycle_idx
  on public.bank_yield_distributions (cycle_id) where status = 'confirmed';

create table if not exists public.member_capital_credits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  cycle_member_id uuid not null references public.cycle_members(id),
  member_id uuid not null references public.members(id),
  source_type text not null check (source_type in ('polla_prize', 'bank_yield')),
  prize_id uuid references public.polla_prizes(id),
  distribution_id uuid references public.bank_yield_distributions(id),
  operation_id uuid not null references public.financial_operations(id),
  idempotency_key text not null,
  amount numeric(18,2) not null check (amount > 0),
  effective_date date not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create unique index if not exists member_capital_credits_one_per_prize_idx
  on public.member_capital_credits (prize_id) where prize_id is not null;
create unique index if not exists member_capital_credits_one_per_distribution_member_idx
  on public.member_capital_credits (distribution_id, cycle_member_id) where distribution_id is not null;

alter table public.bank_yield_distributions enable row level security;
alter table public.member_capital_credits enable row level security;
drop policy if exists "workspace admins read bank yield distributions" on public.bank_yield_distributions;
create policy "workspace admins read bank yield distributions" on public.bank_yield_distributions for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
drop policy if exists "workspace admins read member capital credits" on public.member_capital_credits;
create policy "workspace admins read member capital credits" on public.member_capital_credits for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));
grant select on public.bank_yield_distributions, public.member_capital_credits to authenticated;

-- Acredita el neto de un premio al capital del ganador. No mueve caja.
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

-- Asigna el premio y lo acredita al capital en una sola transaccion.
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
  prize := public.award_polla_prize(p_activity_id, p_winner_cycle_member_id, p_idempotency_key, p_gross_amount, p_awarded_at);
  if prize.status = 'pending_payment' then
    perform public.credit_polla_prize_to_capital(prize.id, trim(p_idempotency_key) || ':capital', p_awarded_at);
  end if;
  select * into prize from public.polla_prizes where id = prize.id;
  return prize;
end;
$$;

-- El pago en efectivo de premios queda deshabilitado por politica.
create or replace function public.pay_polla_prize(p_prize_id uuid, p_idempotency_key text, p_paid_date date)
returns public.polla_prize_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Los premios de polla se acreditan al capital del ganador; no se pagan en efectivo.';
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
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into cm from public.cycle_members where id = p_cycle_member_id;
  if cm.id is null then raise exception 'Participacion no encontrada.'; end if;
  if not public.current_user_is_workspace_admin(cm.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if p_cut_date is null or p_cut_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de corte invalida.'; end if;
  perform public.assert_money_2(coalesce(p_annual_admin_fee, 0), 'cuota anual', false);
  perform public.assert_money_2(coalesce(p_penalty_amount, 0), 'penalidad', false);
  perform public.assert_money_2(coalesce(p_other_discounts, 0), 'otros descuentos', false);

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
    recognized_yield := 0;
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
  net := round(capital + recognized_yield_cents + prizes - debts - coalesce(p_annual_admin_fee, 0) - coalesce(p_penalty_amount, 0) - coalesce(p_other_discounts, 0), 2);
  transfer := round(net, 0);
  rounding := round(transfer - net, 2);

  snapshot := jsonb_build_object(
    'rule_version', 'fin02-capital-credits-2026',
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
    'annual_admin_fee', coalesce(p_annual_admin_fee, 0),
    'penalty', coalesce(p_penalty_amount, 0),
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

create or replace function public.preview_bank_yield_distribution(p_cycle_id uuid, p_cut_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  net_received numeric(18,2);
  settled_yield numeric(18,2);
  projected_yield numeric;
  reserved numeric(18,2);
  already numeric(18,2);
  pool numeric(18,2);
  n integer;
  per numeric(18,2);
  residual numeric(18,2);
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
  where fo.cycle_id = p_cycle_id
    and fo.operation_type = 'bank_interest_received'
    and le.account = 'cash'
    and fo.effective_date <= p_cut_date
    and not exists (select 1 from public.financial_operations rev where rev.reverses_operation_id = fo.id);

  select round(coalesce(sum((ms.snapshot->>'recognized_yield')::numeric), 0), 2) into settled_yield
  from public.member_settlements ms
  where ms.cycle_id = p_cycle_id and ms.status <> 'reversed' and ms.cut_date <= p_cut_date;

  select coalesce(sum(src.amount * (power(1.12::double precision, greatest(0, p_cut_date - src.effective_date)::double precision / 365.0) - 1)), 0)
  into projected_yield
  from (
    select sc.cycle_member_id, sc.amount, sc.effective_date
    from public.savings_contributions sc
    where sc.cycle_id = p_cycle_id and sc.status = 'posted' and sc.effective_date <= p_cut_date
    union all
    select cc.cycle_member_id, cc.amount, cc.effective_date
    from public.member_capital_credits cc
    where cc.cycle_id = p_cycle_id and cc.source_type = 'polla_prize' and cc.effective_date <= p_cut_date
  ) src
  join public.cycle_members cm on cm.id = src.cycle_member_id
  where cm.savings_status = 'active' and not cm.participates_in_polla;

  reserved := round(settled_yield + projected_yield, 2);
  select round(coalesce(sum(pool_amount + savers_reserved), 0), 2) into already
  from public.bank_yield_distributions where cycle_id = p_cycle_id and status = 'confirmed';

  pool := greatest(0, round(net_received - reserved - already, 2));
  select count(*) into n from public.cycle_members cm
  where cm.cycle_id = p_cycle_id and cm.savings_status = 'active' and cm.participates_in_polla;
  per := case when n > 0 then floor(pool / n) else 0 end;
  residual := round(pool - per * n, 2);

  select coalesce(jsonb_agg(jsonb_build_object('cycle_member_id', cm.id, 'member_id', cm.member_id, 'display_name', m.display_name, 'amount', per) order by m.display_name, cm.id), '[]'::jsonb)
  into beneficiaries
  from public.cycle_members cm
  join public.members m on m.id = cm.member_id
  where cm.cycle_id = p_cycle_id and cm.savings_status = 'active' and cm.participates_in_polla;

  snapshot := jsonb_build_object(
    'rule_version', 'fin02-bank-yield-equal-2026',
    'cycle_id', p_cycle_id,
    'cut_date', p_cut_date,
    'net_received', net_received,
    'savers_settled_yield', settled_yield,
    'savers_projected_yield', round(projected_yield, 2),
    'savers_reserved', reserved,
    'already_distributed', already,
    'pool', pool,
    'beneficiary_count', n,
    'per_member', per,
    'residual_to_admin', residual,
    'shortfall', greatest(0, round(reserved + already - net_received, 2)),
    'beneficiaries', beneficiaries,
    'confirmation_allowed', pool > 0 and not exists (select 1 from public.bank_yield_distributions d where d.cycle_id = p_cycle_id and d.status = 'confirmed')
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
  per numeric(18,2);
  residual numeric(18,2);
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
  if exists (select 1 from public.bank_yield_distributions where cycle_id = p_cycle_id and status = 'confirmed') then
    raise exception 'Este ciclo ya tiene un reparto de rendimiento confirmado.';
  end if;

  preview := public.preview_bank_yield_distribution(p_cycle_id, p_cut_date);
  if preview->>'preview_hash' <> p_preview_hash then raise exception 'Los datos cambiaron desde el calculo. Vuelva a calcular.'; end if;
  pool := (preview->>'pool')::numeric;
  per := (preview->>'per_member')::numeric;
  residual := (preview->>'residual_to_admin')::numeric;
  if pool <= 0 then raise exception 'No hay rendimiento bancario para repartir.'; end if;

  insert into public.bank_yield_distributions (workspace_id, cycle_id, idempotency_key, cut_date, preview_hash, snapshot, net_received, savers_reserved, pool_amount, beneficiary_count, per_member_amount, residual_to_admin, created_by)
  values (target_cycle.workspace_id, p_cycle_id, trim(p_idempotency_key), p_cut_date, p_preview_hash, preview,
    (preview->>'net_received')::numeric, (preview->>'savers_reserved')::numeric, pool, (preview->>'beneficiary_count')::integer, per, residual, auth.uid())
  returning * into created;

  entries := jsonb_build_array(jsonb_build_object('account', 'bank_interest_income', 'amount', pool));
  if per > 0 then
    for beneficiary in select * from jsonb_array_elements(preview->'beneficiaries') loop
      entries := entries || jsonb_build_array(jsonb_build_object('account', 'savings_liability', 'amount', -per, 'member_id', (beneficiary->>'member_id')::uuid));
    end loop;
  end if;
  if residual > 0 then
    entries := entries || jsonb_build_array(jsonb_build_object('account', 'admin_payable', 'amount', -residual));
  end if;

  op := public.create_b_operation(
    target_cycle.workspace_id, p_cycle_id, p_idempotency_key, 'bank_yield_distributed', p_cut_date,
    'bank_yield_distributions', created.id,
    jsonb_build_object('distribution_id', created.id, 'pool', pool, 'per_member', per, 'residual', residual),
    entries
  );
  update public.bank_yield_distributions set operation_id = op.id where id = created.id returning * into created;

  if per > 0 then
    for beneficiary in select * from jsonb_array_elements(preview->'beneficiaries') loop
      insert into public.member_capital_credits (workspace_id, cycle_id, cycle_member_id, member_id, source_type, distribution_id, operation_id, idempotency_key, amount, effective_date)
      values (target_cycle.workspace_id, p_cycle_id, (beneficiary->>'cycle_member_id')::uuid, (beneficiary->>'member_id')::uuid, 'bank_yield', created.id, op.id,
        trim(p_idempotency_key) || ':' || (beneficiary->>'cycle_member_id'), per, p_cut_date);
    end loop;
  end if;
  return created;
end;
$$;

revoke all on function public.credit_polla_prize_to_capital(uuid, text, date) from public;
revoke all on function public.award_polla_prize_to_capital(uuid, uuid, text, numeric, date) from public;
revoke all on function public.preview_bank_yield_distribution(uuid, date) from public;
revoke all on function public.confirm_bank_yield_distribution(uuid, date, text, text) from public;
grant execute on function public.credit_polla_prize_to_capital(uuid, text, date) to authenticated;
grant execute on function public.award_polla_prize_to_capital(uuid, uuid, text, numeric, date) to authenticated;
grant execute on function public.preview_bank_yield_distribution(uuid, date) to authenticated;
grant execute on function public.confirm_bank_yield_distribution(uuid, date, text, text) to authenticated;
