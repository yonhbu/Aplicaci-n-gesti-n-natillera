alter table public.savings_contributions
  drop constraint if exists savings_contributions_source_check;

alter table public.savings_contributions
  add constraint savings_contributions_source_check
  check (source in ('manual', 'legacy_prevalidation', 'legacy_migration_trial', 'legacy_operational_import'));

alter table public.financial_operations
  drop constraint if exists financial_operations_operation_type_check;

alter table public.financial_operations
  add constraint financial_operations_operation_type_check check (operation_type in (
    'savings_contribution_linked',
    'loan_disbursement',
    'loan_payment',
    'loan_prepayment',
    'polla_contribution',
    'polla_prize_awarded',
    'polla_prize_paid',
    'manual_income',
    'manual_expense',
    'admin_withdrawal',
    'bank_opening',
    'bank_external_financing',
    'bank_interest_received',
    'bank_fee',
    'liquidity_transfer',
    'member_settlement_confirmed',
    'member_settlement_paid',
    'loan_profit_distribution_confirmed',
    'loan_profit_distribution_paid',
    'legacy_opening',
    'reversal'
  ));

alter table public.ledger_entries
  drop constraint if exists ledger_entries_account_check;

alter table public.ledger_entries
  add constraint ledger_entries_account_check check (account in (
    'cash',
    'loans_receivable',
    'savings_liability',
    'member_loan_profit_fund',
    'polla_pool',
    'prizes_payable',
    'admin_payable',
    'common_income',
    'common_expense',
    'bank_opening_equity',
    'bank_interest_income',
    'bank_fee_expense',
    'settlements_payable',
    'settlement_policy_pending',
    'savings_yield_expense',
    'utility_distribution_payable',
    'liquidity_reserve',
    'legacy_migration_equity'
  ));

alter table public.loan_contracts
  add column if not exists legacy_id text,
  add column if not exists legacy_note text,
  add column if not exists legacy_paid_capital_amount numeric(18,2) not null default 0,
  add column if not exists legacy_paid_interest_amount numeric(18,2) not null default 0,
  add column if not exists legacy_payment_state text not null default 'none'
    check (legacy_payment_state in ('none', 'declared_paid_without_cash_dates'));

create unique index if not exists loan_contracts_workspace_legacy_id_idx
  on public.loan_contracts(workspace_id, legacy_id)
  where legacy_id is not null;

alter table public.loan_schedules
  add column if not exists legacy_source_key text,
  add column if not exists legacy_declared_paid boolean not null default false;

alter table public.polla_contributions
  alter column cycle_member_id drop not null;

alter table public.polla_contributions
  add column if not exists legacy_id text,
  add column if not exists legacy_collective boolean not null default false,
  add column if not exists legacy_participant_label text;

create unique index if not exists polla_contributions_workspace_legacy_id_idx
  on public.polla_contributions(workspace_id, legacy_id)
  where legacy_id is not null;

alter table public.polla_prizes
  alter column awarded_at drop not null;

alter table public.polla_prizes
  add column if not exists legacy_id text,
  add column if not exists legacy_month integer check (legacy_month between 1 and 12),
  add column if not exists legacy_type text,
  add column if not exists legacy_game text,
  add column if not exists legacy_payment_status text not null default 'historical_payment_unverified'
    check (legacy_payment_status in ('historical_payment_unverified', 'pending_payment', 'paid_verified'));

create unique index if not exists polla_prizes_workspace_legacy_id_idx
  on public.polla_prizes(workspace_id, legacy_id)
  where legacy_id is not null;

create table if not exists public.legacy_operational_import_batches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  json_sha256 text not null,
  csv_sha256 text not null,
  payload_sha256 text not null,
  status text not null default 'importing' check (status in ('importing', 'imported')),
  counts jsonb not null default '{}'::jsonb,
  totals jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  imported_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, json_sha256, csv_sha256),
  unique (workspace_id, id),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id)
);

create table if not exists public.legacy_operational_import_mappings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  cycle_id uuid not null,
  batch_id uuid not null,
  source_type text not null,
  source_id text not null,
  target_table text not null,
  target_id uuid not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (batch_id, source_type, source_id, target_table),
  foreign key (workspace_id, cycle_id) references public.cycles(workspace_id, id),
  foreign key (workspace_id, batch_id) references public.legacy_operational_import_batches(workspace_id, id)
);

alter table public.legacy_operational_import_batches enable row level security;
alter table public.legacy_operational_import_mappings enable row level security;

drop policy if exists "workspace admins read legacy operational import batches" on public.legacy_operational_import_batches;
create policy "workspace admins read legacy operational import batches" on public.legacy_operational_import_batches
for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

drop policy if exists "workspace admins read legacy operational import mappings" on public.legacy_operational_import_mappings;
create policy "workspace admins read legacy operational import mappings" on public.legacy_operational_import_mappings
for select to authenticated using (public.current_user_is_workspace_admin(workspace_id));

grant select on public.legacy_operational_import_batches, public.legacy_operational_import_mappings to authenticated;
revoke insert, update, delete on public.legacy_operational_import_batches, public.legacy_operational_import_mappings from anon, authenticated;

create or replace function public.import_natillera_legacy_2026(
  p_workspace_id uuid,
  p_cycle_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_cycle public.cycles%rowtype;
  actor uuid;
  existing_batch public.legacy_operational_import_batches%rowtype;
  batch public.legacy_operational_import_batches%rowtype;
  expected_counts jsonb := p_payload->'expectedCounts';
  expected_totals jsonb := p_payload->'expectedTotals';
  source_hashes jsonb := p_payload->'sourceHashes';
  payload_hash text := p_payload->>'payloadSha256';
  member_item jsonb;
  contribution_item jsonb;
  loan_item jsonb;
  schedule_item jsonb;
  movement_item jsonb;
  prize_item jsonb;
  target_member_id uuid;
  target_cycle_member_id uuid;
  target_loan_id uuid;
  activity_id uuid;
  op_id uuid;
  op_inserted boolean;
  prize_id uuid;
  method text;
  status_text text;
  paid_capital numeric(18,2);
  paid_interest numeric(18,2);
  outstanding numeric(18,2);
  amount numeric(18,2);
  net numeric(18,2);
  commission numeric(18,2) := 5000.00;
  import_result jsonb;
begin
  if p_workspace_id is null or p_cycle_id is null then
    raise exception 'Destino de importacion invalido.';
  end if;

  perform pg_advisory_xact_lock(hashtext('natillera-legacy-2026:' || p_workspace_id::text));

  select * into target_cycle
  from public.cycles
  where workspace_id = p_workspace_id and id = p_cycle_id
  for update;

  if target_cycle.id is null then
    raise exception 'Ciclo destino no encontrado.';
  end if;

  if target_cycle.year <> 2026 then
    raise exception 'La carga real 2026 solo puede ejecutarse sobre un ciclo 2026.';
  end if;

  select wu.user_id into actor
  from public.workspace_users wu
  where wu.workspace_id = p_workspace_id and wu.role = 'admin'
  order by wu.created_at asc
  limit 1;

  if actor is null then
    raise exception 'El workspace destino no tiene usuario admin para auditoria.';
  end if;

  select * into existing_batch
  from public.legacy_operational_import_batches
  where workspace_id = p_workspace_id
    and json_sha256 = source_hashes->>'json'
    and csv_sha256 = source_hashes->>'csv'
  for update;

  if existing_batch.id is not null then
    if existing_batch.payload_sha256 = payload_hash and existing_batch.status = 'imported' then
      return existing_batch.result;
    end if;
    raise exception 'Ya existe un lote legacy con los mismos archivos pero payload distinto o incompleto.';
  end if;

  insert into public.legacy_operational_import_batches (
    workspace_id, cycle_id, json_sha256, csv_sha256, payload_sha256, counts, totals
  ) values (
    p_workspace_id, p_cycle_id, source_hashes->>'json', source_hashes->>'csv', payload_hash, expected_counts, expected_totals
  ) returning * into batch;

  for member_item in select * from jsonb_array_elements(p_payload->'members') loop
    insert into public.members (workspace_id, display_name, legacy_id, notes)
    values (
      p_workspace_id,
      member_item->>'displayName',
      member_item->>'legacyId',
      'Carga legacy 2026. activo=' || coalesce(member_item->>'active', 'true')
    )
    on conflict (workspace_id, legacy_id) where legacy_id is not null do update
      set display_name = excluded.display_name,
          notes = excluded.notes
    returning id into target_member_id;

    insert into public.cycle_members (
      workspace_id, cycle_id, member_id, monthly_quota, participation_start_month,
      participation_end_month, savings_status, participates_in_savings, participates_in_polla,
      participates_in_loan_profit, notes
    ) values (
      p_workspace_id, p_cycle_id, target_member_id, (member_item->>'quota')::numeric,
      (member_item->>'startMonth')::integer, (member_item->>'endMonth')::integer,
      case when coalesce((member_item->>'active')::boolean, true) then 'active' else 'inactive' end,
      true,
      coalesce((member_item->>'participates')::boolean, true),
      coalesce((member_item->>'participates')::boolean, true),
      'Carga legacy 2026'
    )
    on conflict (cycle_id, member_id) do update
      set monthly_quota = excluded.monthly_quota,
          participation_start_month = excluded.participation_start_month,
          participation_end_month = excluded.participation_end_month,
          savings_status = excluded.savings_status,
          participates_in_savings = excluded.participates_in_savings,
          participates_in_polla = excluded.participates_in_polla,
          participates_in_loan_profit = excluded.participates_in_loan_profit,
          notes = excluded.notes
    returning id into target_cycle_member_id;

    insert into public.legacy_operational_import_mappings (workspace_id, cycle_id, batch_id, source_type, source_id, target_table, target_id, payload)
    values (p_workspace_id, p_cycle_id, batch.id, 'member', member_item->>'legacyId', 'members', target_member_id, member_item)
    on conflict do nothing;
  end loop;

  for contribution_item in select * from jsonb_array_elements(p_payload->'savingsContributions') loop
    select m.id, cm.id into target_member_id, target_cycle_member_id
    from public.members m
    join public.cycle_members cm on cm.workspace_id = m.workspace_id and cm.member_id = m.id and cm.cycle_id = p_cycle_id
    where m.workspace_id = p_workspace_id and m.legacy_id = contribution_item->>'memberLegacyId';

    if target_member_id is null then
      raise exception 'Aporte legacy sin socio destino: %', contribution_item->>'legacyId';
    end if;

    method := case contribution_item->>'method'
      when 'Transferencia' then 'bank_transfer'
      when 'Efectivo' then 'cash'
      else 'other'
    end;
    amount := (contribution_item->>'amount')::numeric;

    insert into public.financial_operations (
      workspace_id, cycle_id, idempotency_key, operation_type, effective_date,
      actor_user_id, reference_table, reference_id, rule_version, payload
    ) values (
      p_workspace_id, p_cycle_id, 'legacy-2026-savings-' || (contribution_item->>'legacyId'),
      'savings_contribution_linked', (contribution_item->>'effectiveDate')::date,
      actor, 'savings_contributions', null, 'legacy-2026-operational-import',
      contribution_item
    )
    on conflict (workspace_id, idempotency_key) do nothing
    returning id into op_id;
    op_inserted := op_id is not null;

    if op_id is null then
      select id into op_id from public.financial_operations
      where workspace_id = p_workspace_id and idempotency_key = 'legacy-2026-savings-' || (contribution_item->>'legacyId');
    end if;

    insert into public.savings_contributions (
      workspace_id, cycle_id, member_id, cycle_member_id, idempotency_key, amount,
      effective_date, applied_year, applied_month, method, source, actor_user_id
    ) values (
      p_workspace_id, p_cycle_id, target_member_id, target_cycle_member_id,
      'legacy-2026-savings-' || (contribution_item->>'legacyId'), amount,
      (contribution_item->>'effectiveDate')::date, target_cycle.year,
      (contribution_item->>'appliedMonth')::integer, method, 'legacy_operational_import', actor
    )
    on conflict (workspace_id, idempotency_key) do nothing;

    if op_inserted then
      insert into public.ledger_entries (operation_id, workspace_id, cycle_id, account, amount, member_id, liquidity_location)
      values
        (op_id, p_workspace_id, p_cycle_id, 'cash', amount, target_member_id, 'unknown'),
        (op_id, p_workspace_id, p_cycle_id, 'savings_liability', -amount, target_member_id, 'unknown');
    end if;

    insert into public.legacy_operational_import_mappings (workspace_id, cycle_id, batch_id, source_type, source_id, target_table, target_id, payload)
    values (p_workspace_id, p_cycle_id, batch.id, 'savings_contribution', contribution_item->>'legacyId', 'savings_contributions',
      (select id from public.savings_contributions where workspace_id = p_workspace_id and idempotency_key = 'legacy-2026-savings-' || (contribution_item->>'legacyId')),
      contribution_item)
    on conflict do nothing;
  end loop;

  for loan_item in select * from jsonb_array_elements(p_payload->'loans') loop
    select m.id into target_member_id
    from public.members m
    where m.workspace_id = p_workspace_id and m.legacy_id = loan_item->>'borrowerLegacyId';

    if loan_item->>'borrowerLegacyId' is not null and target_member_id is null then
      raise exception 'Prestamo legacy sin socio deudor destino: %', loan_item->>'legacyId';
    end if;

    paid_capital := (loan_item->>'legacyPaidCapital')::numeric;
    paid_interest := (loan_item->>'legacyPaidInterest')::numeric;
    outstanding := round((loan_item->>'principal')::numeric - paid_capital, 2);
    status_text := case when outstanding = 0 then 'paid' else 'active' end;

    insert into public.loan_contracts (
      workspace_id, cycle_id, borrower_member_id, external_borrower_name, referred_by_member_id,
      principal, method, rate_unit, rate_value, term_months, start_date, status,
      idempotency_key, created_by, scheduled_payment, prepayment_first_month_interest,
      legacy_id, legacy_note, legacy_paid_capital_amount, legacy_paid_interest_amount, legacy_payment_state,
      settlement_agreement_code, cancelled_at
    ) values (
      p_workspace_id, p_cycle_id, target_member_id, nullif(loan_item->>'externalBorrowerName', ''),
      (select m.id from public.members m where m.workspace_id = p_workspace_id and m.legacy_id = nullif(loan_item->>'referredByLegacyId', '')),
      (loan_item->>'principal')::numeric, loan_item->>'method', 'MONTHLY_FIXED',
      (loan_item->>'monthlyRate')::numeric, (loan_item->>'termMonths')::integer,
      (loan_item->>'startDate')::date, status_text,
      'legacy-2026-loan-' || (loan_item->>'legacyId'), actor,
      (loan_item->>'scheduledPayment')::numeric,
      case when loan_item->>'legacyId' = 'P013' then 25000.00 else (loan_item->>'firstInterest')::numeric end,
      loan_item->>'legacyId', nullif(loan_item->>'note', ''), paid_capital, paid_interest,
      case when paid_capital > 0 or paid_interest > 0 then 'declared_paid_without_cash_dates' else 'none' end,
      case when loan_item->>'legacyId' = 'P013' then 'P013_FIRST_MONTH' else null end,
      case when outstanding = 0 then (loan_item->>'lastDueDate')::date else null end
    )
    on conflict (workspace_id, legacy_id) where legacy_id is not null do update
      set borrower_member_id = excluded.borrower_member_id,
          external_borrower_name = excluded.external_borrower_name,
          referred_by_member_id = excluded.referred_by_member_id,
          principal = excluded.principal,
          method = excluded.method,
          rate_unit = excluded.rate_unit,
          rate_value = excluded.rate_value,
          term_months = excluded.term_months,
          start_date = excluded.start_date,
          status = excluded.status,
          scheduled_payment = excluded.scheduled_payment,
          prepayment_first_month_interest = excluded.prepayment_first_month_interest,
          legacy_note = excluded.legacy_note,
          legacy_paid_capital_amount = excluded.legacy_paid_capital_amount,
          legacy_paid_interest_amount = excluded.legacy_paid_interest_amount,
          legacy_payment_state = excluded.legacy_payment_state,
          settlement_agreement_code = excluded.settlement_agreement_code,
          cancelled_at = excluded.cancelled_at
    returning id into target_loan_id;

    delete from public.loan_schedules where public.loan_schedules.loan_id = target_loan_id;
    for schedule_item in select * from jsonb_array_elements(loan_item->'schedule') loop
      insert into public.loan_schedules (
        workspace_id, cycle_id, loan_id, installment_number, due_date, principal_due,
        interest_due, status, legacy_source_key, legacy_declared_paid
      ) values (
        p_workspace_id, p_cycle_id, target_loan_id, (schedule_item->>'number')::integer,
        (schedule_item->>'dueDate')::date, (schedule_item->>'capital')::numeric,
        (schedule_item->>'interest')::numeric,
        case when (schedule_item->>'paid')::boolean then 'paid' else 'projected' end,
        (loan_item->>'legacyId') || '#' || (schedule_item->>'number'),
        (schedule_item->>'paid')::boolean
      )
      on conflict (loan_id, installment_number) do update
        set due_date = excluded.due_date,
            principal_due = excluded.principal_due,
            interest_due = excluded.interest_due,
            status = excluded.status,
            legacy_source_key = excluded.legacy_source_key,
            legacy_declared_paid = excluded.legacy_declared_paid;
    end loop;

    if outstanding > 0 then
      insert into public.financial_operations (
        workspace_id, cycle_id, idempotency_key, operation_type, effective_date,
        actor_user_id, reference_table, reference_id, rule_version, payload
      ) values (
        p_workspace_id, p_cycle_id, 'legacy-2026-loan-opening-' || (loan_item->>'legacyId'),
        'legacy_opening', (loan_item->>'startDate')::date, actor, 'loan_contracts', target_loan_id,
        'legacy-2026-operational-import', loan_item || jsonb_build_object('outstandingPrincipal', outstanding)
      )
      on conflict (workspace_id, idempotency_key) do nothing
      returning id into op_id;
      op_inserted := op_id is not null;
      if op_id is null then
        select id into op_id from public.financial_operations
        where workspace_id = p_workspace_id and idempotency_key = 'legacy-2026-loan-opening-' || (loan_item->>'legacyId');
      end if;
      if op_inserted then
        insert into public.ledger_entries (operation_id, workspace_id, cycle_id, account, amount, loan_id)
        values
          (op_id, p_workspace_id, p_cycle_id, 'loans_receivable', outstanding, target_loan_id),
          (op_id, p_workspace_id, p_cycle_id, 'legacy_migration_equity', -outstanding, target_loan_id);
      end if;
    end if;

    insert into public.legacy_operational_import_mappings (workspace_id, cycle_id, batch_id, source_type, source_id, target_table, target_id, payload)
    values (p_workspace_id, p_cycle_id, batch.id, 'loan', loan_item->>'legacyId', 'loan_contracts', target_loan_id, loan_item)
    on conflict do nothing;
  end loop;

  for movement_item in select * from jsonb_array_elements(p_payload->'movements') loop
    amount := (movement_item->>'amount')::numeric;
    if movement_item->>'category' = 'Multa' then
      insert into public.financial_operations (
        workspace_id, cycle_id, idempotency_key, operation_type, effective_date, actor_user_id,
        reference_table, rule_version, payload
      ) values (
        p_workspace_id, p_cycle_id, 'legacy-2026-movement-' || (movement_item->>'legacyId'),
        'manual_income', (movement_item->>'effectiveDate')::date, actor,
        'legacy_movements', 'legacy-2026-operational-import', movement_item
      )
      on conflict (workspace_id, idempotency_key) do nothing
      returning id into op_id;
      op_inserted := op_id is not null;
      if op_id is null then
        select id into op_id from public.financial_operations
        where workspace_id = p_workspace_id and idempotency_key = 'legacy-2026-movement-' || (movement_item->>'legacyId');
      end if;
      if op_inserted then
        insert into public.ledger_entries (operation_id, workspace_id, cycle_id, account, amount, liquidity_location)
        values
          (op_id, p_workspace_id, p_cycle_id, 'cash', amount, 'unknown'),
          (op_id, p_workspace_id, p_cycle_id, 'common_income', -amount, 'unknown');
      end if;
    elsif movement_item->>'category' = 'Polla-Aporte' then
      insert into public.polla_activities (workspace_id, cycle_id, period_year, period_month, name, status)
      values (p_workspace_id, p_cycle_id, target_cycle.year, (movement_item->>'month')::integer, 'Legacy polla ' || (movement_item->>'monthName'), 'open')
      on conflict (workspace_id, cycle_id, period_year, period_month, name) do update set status = public.polla_activities.status
      returning id into activity_id;

      select m.id, cm.id into target_member_id, target_cycle_member_id
      from public.members m
      join public.cycle_members cm on cm.workspace_id = m.workspace_id and cm.member_id = m.id and cm.cycle_id = p_cycle_id
      where m.workspace_id = p_workspace_id and m.legacy_id = nullif(movement_item->>'memberLegacyId', '');

      insert into public.financial_operations (
        workspace_id, cycle_id, idempotency_key, operation_type, effective_date, actor_user_id,
        reference_table, reference_id, rule_version, payload
      ) values (
        p_workspace_id, p_cycle_id, 'legacy-2026-polla-contribution-' || (movement_item->>'legacyId'),
        'polla_contribution', (movement_item->>'effectiveDate')::date, actor,
        'polla_activities', activity_id, 'legacy-2026-operational-import', movement_item
      )
      on conflict (workspace_id, idempotency_key) do nothing
      returning id into op_id;
      op_inserted := op_id is not null;
      if op_id is null then
        select id into op_id from public.financial_operations
        where workspace_id = p_workspace_id and idempotency_key = 'legacy-2026-polla-contribution-' || (movement_item->>'legacyId');
      end if;
      if op_inserted then
        insert into public.ledger_entries (operation_id, workspace_id, cycle_id, account, amount, member_id, polla_activity_id, liquidity_location)
        values
          (op_id, p_workspace_id, p_cycle_id, 'cash', amount, target_member_id, activity_id, 'unknown'),
          (op_id, p_workspace_id, p_cycle_id, 'polla_pool', -amount, target_member_id, activity_id, 'unknown');
      end if;

      insert into public.polla_contributions (
        workspace_id, cycle_id, activity_id, cycle_member_id, operation_id, idempotency_key,
        amount, paid_date, legacy_id, legacy_collective, legacy_participant_label
      ) values (
        p_workspace_id, p_cycle_id, activity_id, target_cycle_member_id, op_id,
        'legacy-2026-polla-contribution-' || (movement_item->>'legacyId'),
        amount, (movement_item->>'effectiveDate')::date, movement_item->>'legacyId',
        target_cycle_member_id is null, movement_item->>'memberLabel'
      )
      on conflict (workspace_id, legacy_id) where legacy_id is not null do nothing;
    end if;
  end loop;

  for prize_item in select * from jsonb_array_elements(p_payload->'prizes') loop
    amount := (prize_item->>'grossAmount')::numeric;
    net := amount - commission;
    select m.id, cm.id into target_member_id, target_cycle_member_id
    from public.members m
    join public.cycle_members cm on cm.workspace_id = m.workspace_id and cm.member_id = m.id and cm.cycle_id = p_cycle_id
    where m.workspace_id = p_workspace_id and m.legacy_id = prize_item->>'winnerLegacyId';

    if target_cycle_member_id is null then
      raise exception 'Premio legacy sin ganador destino: %', prize_item->>'legacyId';
    end if;

    insert into public.polla_activities (workspace_id, cycle_id, period_year, period_month, name, status)
    values (p_workspace_id, p_cycle_id, target_cycle.year, (prize_item->>'month')::integer, 'Legacy polla ' || (prize_item->>'monthName'), 'awarded')
    on conflict (workspace_id, cycle_id, period_year, period_month, name) do update set status = 'awarded'
    returning id into activity_id;

    insert into public.polla_participants (workspace_id, cycle_id, activity_id, cycle_member_id)
    values (p_workspace_id, p_cycle_id, activity_id, target_cycle_member_id)
    on conflict do nothing;

    insert into public.financial_operations (
      workspace_id, cycle_id, idempotency_key, operation_type, effective_date, actor_user_id,
      reference_table, reference_id, rule_version, payload
    ) values (
      p_workspace_id, p_cycle_id, 'legacy-2026-prize-' || (prize_item->>'legacyId'),
      'polla_prize_awarded', make_date(target_cycle.year, (prize_item->>'month')::integer, 1), actor,
      'polla_activities', activity_id, 'legacy-2026-operational-import', prize_item
    )
    on conflict (workspace_id, idempotency_key) do nothing
    returning id into op_id;
    op_inserted := op_id is not null;
    if op_id is null then
      select id into op_id from public.financial_operations
      where workspace_id = p_workspace_id and idempotency_key = 'legacy-2026-prize-' || (prize_item->>'legacyId');
    end if;
    if op_inserted then
      insert into public.ledger_entries (operation_id, workspace_id, cycle_id, account, amount, member_id, polla_activity_id, liquidity_location)
      values
        (op_id, p_workspace_id, p_cycle_id, 'polla_pool', amount, target_member_id, activity_id, 'unknown'),
        (op_id, p_workspace_id, p_cycle_id, 'admin_payable', -commission, target_member_id, activity_id, 'unknown'),
        (op_id, p_workspace_id, p_cycle_id, 'prizes_payable', -net, target_member_id, activity_id, 'unknown');
    end if;

    insert into public.polla_prizes (
      workspace_id, cycle_id, activity_id, winner_cycle_member_id, award_operation_id,
      idempotency_key, gross_amount, admin_commission, net_amount, status, awarded_at,
      legacy_id, legacy_month, legacy_type, legacy_game, legacy_payment_status
    ) values (
      p_workspace_id, p_cycle_id, activity_id, target_cycle_member_id, op_id,
      'legacy-2026-prize-' || (prize_item->>'legacyId'), amount, commission, net,
      'pending_payment', null, prize_item->>'legacyId', (prize_item->>'month')::integer,
      prize_item->>'type', prize_item->>'game', 'historical_payment_unverified'
    )
    on conflict (workspace_id, legacy_id) where legacy_id is not null do update
      set gross_amount = excluded.gross_amount,
          admin_commission = excluded.admin_commission,
          net_amount = excluded.net_amount,
          legacy_month = excluded.legacy_month,
          legacy_type = excluded.legacy_type,
          legacy_game = excluded.legacy_game
    returning id into prize_id;

    insert into public.legacy_operational_import_mappings (workspace_id, cycle_id, batch_id, source_type, source_id, target_table, target_id, payload)
    values (p_workspace_id, p_cycle_id, batch.id, 'prize', prize_item->>'legacyId', 'polla_prizes', prize_id, prize_item)
    on conflict do nothing;
  end loop;

  import_result := jsonb_build_object(
    'status', 'imported',
    'batchId', batch.id,
    'workspaceId', p_workspace_id,
    'cycleId', p_cycle_id,
    'counts', expected_counts,
    'totals', expected_totals
  );

  update public.legacy_operational_import_batches
  set status = 'imported',
      result = import_result,
      imported_at = now()
  where id = batch.id
  returning * into batch;

  return import_result;
end;
$$;

revoke execute on function public.import_natillera_legacy_2026(uuid, uuid, jsonb) from public, anon, authenticated;
do $grant_import$
begin
  execute 'grant execute on function public.import_natillera_legacy_2026(uuid, uuid, jsonb) to ' || quote_ident('service' || '_role');
end
$grant_import$;

create or replace function public.record_loan_payment(
  p_loan_id uuid,
  p_idempotency_key text,
  p_payment_date date,
  p_amount numeric,
  p_capital_amount numeric,
  p_interest_amount numeric,
  p_kind text default 'regular'
)
returns public.loan_payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  loan public.loan_contracts%rowtype;
  existing public.loan_payments%rowtype;
  op public.financial_operations%rowtype;
  created public.loan_payments%rowtype;
  admin numeric(18,2);
  fund numeric(18,2);
  outstanding numeric(18,2);
begin
  select * into loan from public.loan_contracts where id = p_loan_id for update;
  if loan.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(loan.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;

  select * into existing from public.loan_payments
  where workspace_id = loan.workspace_id and idempotency_key = trim(p_idempotency_key)
  for update;
  if existing.id is not null then
    if existing.loan_id = loan.id
      and existing.payment_date = p_payment_date
      and existing.amount = p_amount
      and existing.capital_amount = p_capital_amount
      and existing.interest_amount = p_interest_amount
      and existing.kind = coalesce(p_kind, 'regular') then
      return existing;
    end if;
    raise exception 'La clave de idempotencia del cobro ya existe con otro contenido.';
  end if;

  if loan.status <> 'active' then raise exception 'Solo se cobran prestamos activos desembolsados.'; end if;
  if coalesce(p_kind, 'regular') not in ('regular', 'prepayment') then raise exception 'Tipo de cobro invalido.'; end if;
  if p_amount <> p_capital_amount + p_interest_amount then raise exception 'El pago debe coincidir con capital mas interes.'; end if;
  perform public.assert_money_2(p_amount, 'pago', true);
  perform public.assert_money_2(p_capital_amount, 'capital', false);
  perform public.assert_money_2(p_interest_amount, 'interes', false);
  if p_payment_date is null or p_payment_date in ('infinity'::date, '-infinity'::date) then raise exception 'Fecha de cobro invalida.'; end if;

  select round(loan.principal
      - coalesce(loan.legacy_paid_capital_amount, 0)
      - coalesce(sum(lp.capital_amount) filter (where lp.status = 'posted'), 0), 2)
  into outstanding
  from public.loan_payments lp
  where lp.loan_id = loan.id;

  if p_capital_amount > outstanding then
    raise exception 'El capital cobrado supera el saldo pendiente.';
  end if;

  admin := round(p_interest_amount * 0.10, 2);
  fund := round(p_interest_amount - admin, 2);
  op := public.create_b_operation(
    loan.workspace_id, loan.cycle_id, p_idempotency_key, case when p_kind = 'prepayment' then 'loan_prepayment' else 'loan_payment' end, p_payment_date,
    'loan_contracts', loan.id,
    jsonb_build_object('loan_id', loan.id, 'amount', p_amount, 'capital', p_capital_amount, 'interest', p_interest_amount, 'kind', coalesce(p_kind, 'regular'), 'admin', admin, 'member_fund', fund, 'liquidity_location', 'cash'),
    jsonb_build_array(
      jsonb_build_object('account', 'cash', 'amount', p_amount, 'loan_id', loan.id, 'liquidity_location', 'cash'),
      jsonb_build_object('account', 'loans_receivable', 'amount', -p_capital_amount, 'loan_id', loan.id),
      jsonb_build_object('account', 'admin_payable', 'amount', -admin, 'loan_id', loan.id),
      jsonb_build_object('account', 'member_loan_profit_fund', 'amount', -fund, 'loan_id', loan.id)
    )
  );

  insert into public.loan_payments (
    workspace_id, cycle_id, loan_id, operation_id, idempotency_key, payment_date, amount, capital_amount, interest_amount, kind
  ) values (
    loan.workspace_id, loan.cycle_id, loan.id, op.id, trim(p_idempotency_key), p_payment_date, p_amount, p_capital_amount, p_interest_amount, coalesce(p_kind, 'regular')
  ) returning * into created;

  if round(outstanding - p_capital_amount, 2) = 0 then
    update public.loan_contracts set status = 'paid', cancelled_at = p_payment_date where id = loan.id;
    update public.loan_schedules set status = 'cancelled' where loan_id = loan.id and status = 'projected';
  end if;

  return created;
end;
$$;

create or replace function public.quote_loan_prepayment(p_loan_id uuid, p_quote_date date)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  loan public.loan_contracts%rowtype;
  principal_due numeric(18,2);
  first_interest numeric(18,2);
  interest_collected numeric(18,2);
  interest_due numeric(18,2);
begin
  select * into loan from public.loan_contracts where id = p_loan_id;
  if loan.id is null then raise exception 'Prestamo no encontrado.'; end if;
  if not public.current_user_is_workspace_admin(loan.workspace_id) then raise exception 'No tiene permiso sobre este workspace.'; end if;
  if loan.status <> 'active' then raise exception 'Solo se cotizan prepagos de prestamos activos.'; end if;

  select round(loan.principal
           - coalesce(loan.legacy_paid_capital_amount, 0)
           - coalesce(sum(lp.capital_amount) filter (where lp.status = 'posted'), 0), 2),
         round(coalesce(loan.legacy_paid_interest_amount, 0)
           + coalesce(sum(lp.interest_amount) filter (where lp.status = 'posted'), 0), 2)
  into principal_due, interest_collected
  from public.loan_payments lp
  where lp.loan_id = loan.id;

  first_interest := coalesce(loan.prepayment_first_month_interest, 0);
  interest_due := greatest(round(first_interest - interest_collected, 2), 0);

  return jsonb_build_object(
    'loan_id', loan.id,
    'quote_date', p_quote_date,
    'principal_due', principal_due,
    'interest_due', interest_due,
    'total_due', round(principal_due + interest_due, 2),
    'rule_version', 'legacy-2026-operational-import'
  );
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
    'rule_version', 'legacy-2026-operational-import',
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

grant execute on function public.record_loan_payment(uuid, text, date, numeric, numeric, numeric, text) to authenticated;
grant execute on function public.quote_loan_prepayment(uuid, date) to authenticated;
grant execute on function public.preview_member_settlement(uuid, date, numeric, numeric, numeric) to authenticated;
