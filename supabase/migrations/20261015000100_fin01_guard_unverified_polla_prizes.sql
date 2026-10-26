-- FIN-01: integridad de premios de polla migrados del Excel.
-- 1) Premios creados en la app quedaban con legacy_payment_status = 'historical_payment_unverified' por el default.
-- 2) pay_polla_prize no impedía pagar un premio histórico cuyo pago anterior no está verificado.
-- 3) Nueva RPC para que el administrador confirme que un premio histórico NO se pagó y habilitar su pago.

alter table public.polla_prizes
  alter column legacy_payment_status set default 'pending_payment';

update public.polla_prizes
set legacy_payment_status = case when status = 'pending_payment' then 'pending_payment' else 'paid_verified' end
where legacy_id is null
  and legacy_payment_status = 'historical_payment_unverified';

alter table public.polla_prizes
  add column if not exists legacy_verified_by uuid,
  add column if not exists legacy_verified_at timestamptz,
  add column if not exists legacy_verification_note text;

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

create or replace function public.confirm_legacy_polla_prize_unpaid(p_prize_id uuid, p_note text)
returns public.polla_prizes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  prize public.polla_prizes%rowtype;
begin
  if auth.uid() is null then raise exception 'Debe iniciar sesion.'; end if;
  select * into prize from public.polla_prizes where id = p_prize_id for update;
  if prize.id is null then raise exception 'Premio no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(prize.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if prize.status <> 'pending_payment' then raise exception 'El premio no esta pendiente de pago.'; end if;
  if prize.legacy_payment_status <> 'historical_payment_unverified' then
    raise exception 'El premio no requiere verificacion historica.';
  end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Indique como verifico que el premio no se pago.'; end if;

  update public.polla_prizes
  set legacy_payment_status = 'pending_payment',
      legacy_verified_by = auth.uid(),
      legacy_verified_at = now(),
      legacy_verification_note = trim(p_note)
  where id = prize.id
  returning * into prize;
  return prize;
end;
$$;

revoke all on function public.confirm_legacy_polla_prize_unpaid(uuid, text) from public;
grant execute on function public.confirm_legacy_polla_prize_unpaid(uuid, text) to authenticated;
grant execute on function public.pay_polla_prize(uuid, text, date) to authenticated;
