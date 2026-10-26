-- FIN-08.2: cerrar entrega futura, reintentos con otra ubicacion y reloj de TEST.
-- Se aplica despues de FIN-08.1; no modifica historia ya publicada.

revoke all on public.fin_test_clock from public, anon, authenticated, authenticator;

create or replace function public.fin_civil_today()
returns date
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    -- PostgREST inicia sesion como authenticator. Los overrides solo sirven a pruebas SQL
    -- ejecutadas por postgres; la fila requiere ademas activacion explicita por transaccion.
    when session_user = 'postgres' then coalesce(
      nullif(current_setting('natillera.civil_today', true), '')::date,
      case when current_setting('natillera.test_clock_enabled', true) = 'on'
        then (select civil_today from public.fin_test_clock where id = 1)
      end,
      (now() at time zone 'America/Bogota')::date
    )
    else (now() at time zone 'America/Bogota')::date
  end
$$;

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
    select * into op from public.financial_operations where id = existing.operation_id;
    if existing.prize_id = prize.id
      and existing.amount = prize.net_amount
      and existing.paid_date = p_paid_date
      and op.payload->>'liquidity_location' is not distinct from p_liquidity_location
      and op.payload->>'bank_account_id' is not distinct from p_bank_account_id::text then
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
  if p_paid_date > public.fin_civil_today() then raise exception 'La entrega no puede registrarse con fecha futura.'; end if;
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
