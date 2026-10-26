-- FIN-08.1: cierre de publicacion.
-- P0 Entrega de premios a retirados: se elige banco o efectivo y se valida esa ubicacion; fecha no anterior al premio.
-- P0 Reverso Pibank conserva los abonos individuales marcados como revertidos (no se borran).
-- P0 Reversos, pagos y liquidaciones comparten el bloqueo del ciclo.
-- P1 Reloj de pruebas solo en servidor (fin_test_clock), sin acceso desde el navegador.

-- Reloj controlado solo para TEST. Sin politicas RLS: los clientes no pueden leerlo ni escribirlo.
create table if not exists public.fin_test_clock (
  id integer primary key check (id = 1),
  civil_today date not null,
  note text not null default 'Solo TEST. Debe estar vacia en produccion.'
);
alter table public.fin_test_clock enable row level security;
revoke all on public.fin_test_clock from anon, authenticated;

create or replace function public.fin_civil_today()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    nullif(current_setting('natillera.civil_today', true), '')::date,
    (select civil_today from public.fin_test_clock where id = 1),
    (now() at time zone 'America/Bogota')::date
  )
$$;
grant execute on function public.fin_civil_today() to authenticated;

alter table public.member_capital_credits add column if not exists reversed_at timestamptz;
alter table public.member_capital_credits add column if not exists reversal_operation_id uuid references public.financial_operations(id);
drop index if exists public.member_capital_credits_one_per_distribution_member_idx;
create unique index if not exists member_capital_credits_one_per_distribution_member_idx
  on public.member_capital_credits (distribution_id, cycle_member_id) where distribution_id is not null and reversed_at is null;

create or replace function public.pay_polla_prize(p_prize_id uuid, p_idempotency_key text, p_paid_date date, p_liquidity_location text, p_bank_account_id uuid)
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
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into prize from public.polla_prizes where id = p_prize_id for update;
  if prize.id is null then raise exception 'Premio no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(prize.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then raise exception 'Falta la clave de idempotencia.'; end if;

  select * into existing from public.polla_prize_payments
  where workspace_id = prize.workspace_id and idempotency_key = trim(p_idempotency_key) for update;
  if existing.id is not null then
    if existing.prize_id = prize.id and existing.amount = prize.net_amount and existing.paid_date = p_paid_date then return existing; end if;
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
  if prize.awarded_at is not null and p_paid_date < prize.awarded_at then raise exception 'La entrega no puede ser anterior al premio (%).', prize.awarded_at; end if;
  if p_liquidity_location not in ('bank', 'cash') or (p_liquidity_location = 'bank' and p_bank_account_id is null) or (p_liquidity_location = 'cash' and p_bank_account_id is not null) then
    raise exception 'Indique si el premio sale del banco (con cuenta) o del efectivo.';
  end if;
  perform 1 from public.cycles where id = prize.cycle_id for update;
  if public.cash_available_at(prize.cycle_id, p_paid_date, p_liquidity_location, p_bank_account_id) < prize.net_amount then
    raise exception 'No hay dinero suficiente en % para entregar este premio.', case when p_liquidity_location = 'bank' then 'esa cuenta' else 'efectivo' end;
  end if;

  op := public.create_b_operation(
    prize.workspace_id, prize.cycle_id, p_idempotency_key, 'polla_prize_paid', p_paid_date,
    'polla_prizes', prize.id,
    jsonb_build_object('prize_id', prize.id, 'amount', prize.net_amount, 'liquidity_location', p_liquidity_location, 'bank_account_id', p_bank_account_id),
    jsonb_build_array(
      jsonb_build_object('account', 'prizes_payable', 'amount', prize.net_amount, 'prize_id', prize.id),
      jsonb_strip_nulls(jsonb_build_object('account', 'cash', 'amount', -prize.net_amount, 'prize_id', prize.id, 'liquidity_location', p_liquidity_location, 'bank_account_id', p_bank_account_id))
    )
  );
  insert into public.polla_prize_payments (workspace_id, cycle_id, prize_id, operation_id, idempotency_key, amount, paid_date)
  values (prize.workspace_id, prize.cycle_id, prize.id, op.id, trim(p_idempotency_key), prize.net_amount, p_paid_date)
  returning * into created;
  update public.polla_prizes set status = 'paid', paid_operation_id = op.id, legacy_payment_status = 'paid_verified' where id = prize.id;
  return created;
end;
$$;

-- La version anterior sin ubicacion queda deshabilitada para evitar pagos sin validar liquidez.
create or replace function public.pay_polla_prize(p_prize_id uuid, p_idempotency_key text, p_paid_date date)
returns public.polla_prize_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'Indique si el premio se entrega desde el banco o el efectivo.';
end;
$$;

create or replace function public.reverse_bank_yield_distribution(p_distribution_id uuid, p_idempotency_key text, p_reason text)
returns public.bank_yield_distributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dist public.bank_yield_distributions%rowtype;
  op public.financial_operations%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into dist from public.bank_yield_distributions where id = p_distribution_id for update;
  if dist.id is null then raise exception 'Reparto no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(dist.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if dist.status = 'reversed' then return dist; end if;
  -- FIN-08.1: mismo bloqueo de ciclo que liquidaciones y pagos.
  perform 1 from public.cycles where id = dist.cycle_id for update;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Indique el motivo de la correccion.'; end if;
  if exists (select 1 from public.member_settlements s where s.cycle_id = dist.cycle_id and s.status <> 'reversed'
             and s.cut_date >= dist.cut_date and coalesce((s.snapshot->>'bank_yield_fund')::numeric, 0) > 0) then
    raise exception 'Ya se liquido el fondo Pibank de uno o mas socios: no se puede deshacer el reparto.';
  end if;
  op := public.create_b_operation(
    dist.workspace_id, dist.cycle_id, p_idempotency_key, 'bank_yield_distribution_reversed', dist.cut_date,
    'bank_yield_distributions', dist.id,
    jsonb_build_object('distribution_id', dist.id, 'reason', trim(p_reason), 'reverses_operation_id', dist.operation_id),
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'account', le.account, 'amount', -le.amount, 'member_id', le.member_id, 'loan_id', le.loan_id, 'prize_id', le.prize_id,
        'liquidity_location', case when le.account = 'cash' then le.liquidity_location end,
        'bank_account_id', case when le.account = 'cash' then le.bank_account_id end))), '[]'::jsonb)
      from public.ledger_entries le where le.operation_id = dist.operation_id)
  );
  -- Los abonos individuales se conservan marcados como revertidos.
  update public.member_capital_credits set reversed_at = now(), reversal_operation_id = op.id
  where distribution_id = dist.id and reversed_at is null;
  update public.bank_yield_distributions set status = 'reversed', reversed_operation_id = op.id, reversal_reason = trim(p_reason)
  where id = dist.id returning * into dist;
  return dist;
end;
$$;

create or replace function public.reverse_loan_profit_periods(p_distribution_id uuid, p_idempotency_key text, p_reason text)
returns public.loan_profit_period_distributions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  dist public.loan_profit_period_distributions%rowtype;
  op public.financial_operations%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into dist from public.loan_profit_period_distributions where id = p_distribution_id for update;
  if dist.id is null then raise exception 'Reparto no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(dist.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if dist.status = 'reversed' then return dist; end if;
  perform 1 from public.cycles where id = dist.cycle_id for update;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Indique el motivo de la correccion.'; end if;
  if exists (select 1 from public.loan_profit_period_allocations a where a.distribution_id = dist.id and a.paid_operation_id is not null) then
    raise exception 'Ya se pago utilidad a uno o mas socios: no se puede deshacer el reparto sin una politica de recuperacion.';
  end if;
  if exists (select 1 from public.member_settlements s where s.cycle_id = dist.cycle_id and s.status <> 'reversed' and s.cut_date >= dist.cut_date) then
    raise exception 'Ya hay liquidaciones de cierre que dependen de este reparto.';
  end if;
  op := public.create_b_operation(
    dist.workspace_id, dist.cycle_id, p_idempotency_key, 'loan_profit_period_reversed', dist.cut_date,
    'loan_profit_period_distributions', dist.id,
    jsonb_build_object('distribution_id', dist.id, 'reason', trim(p_reason), 'reverses_operation_id', dist.operation_id),
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'account', le.account, 'amount', -le.amount, 'member_id', le.member_id, 'loan_id', le.loan_id, 'prize_id', le.prize_id,
        'liquidity_location', case when le.account = 'cash' then le.liquidity_location end,
        'bank_account_id', case when le.account = 'cash' then le.bank_account_id end))), '[]'::jsonb)
      from public.ledger_entries le where le.operation_id = dist.operation_id)
  );
  update public.loan_profit_period_distributions set status = 'reversed', reversed_operation_id = op.id, reversal_reason = trim(p_reason)
  where id = dist.id returning * into dist;
  return dist;
end;
$$;

create or replace function public.fin07_enforce_close_order()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
begin
  -- FIN-08.1: toda liquidacion bloquea el ciclo, igual que pagos y reversos, para evitar carreras.
  select * into target_cycle from public.cycles where id = new.cycle_id for update;
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
    and cc.reversed_at is null
    and cc.effective_date <= p_cut_date;

  capital := round(capital + credit_capital, 2);
  -- FIN-04: el fondo individual Pibank no es capital de ahorro; se entrega aparte en la liquidacion.
  if enforced then
    select round(coalesce(sum(cc.amount), 0), 2) into bank_fund
    from public.member_capital_credits cc
    where cc.cycle_member_id = cm.id and cc.reversed_at is null and cc.source_type = 'bank_yield' and cc.effective_date <= p_cut_date;
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

revoke all on function public.pay_polla_prize(uuid, text, date, text, uuid) from public, anon;
grant execute on function public.pay_polla_prize(uuid, text, date, text, uuid) to authenticated;
