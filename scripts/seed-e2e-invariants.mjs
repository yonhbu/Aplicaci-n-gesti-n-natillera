import { readFileSync, writeFileSync } from 'node:fs';
import { auditSql } from './lib/audit-test-runtime.mjs';

// Independent SQL oracle, frozen BEFORE browser interaction. This is not a copy
// of the current UI/domain output or a fabricated historical screenshot baseline.
export default function seedE2eInvariants() {
  const f = JSON.parse(readFileSync('incoming/ux13-2026-10-20/fixture.json', 'utf8'));
  if (!/^[0-9a-f-]{36}$/.test(f.cycleId)) throw Error('Fixture SQL inválido.');
  const c = f.cycleId;
  const expected = auditSql(`with postings as (
    select e.*, o.operation_type, original.operation_type original_type
    from public.ledger_entries e join public.financial_operations o on o.id=e.operation_id
    left join public.financial_operations original on original.id=o.reverses_operation_id
    where e.cycle_id='${c}' and o.effective_date<='2026-10-20'
  ), accounts as (
    select account,to_char(sum(amount),'FM999999999999999990.00') amount from postings group by account
  ), bank as (
    select coalesce(sum(amount),0) balance,
      coalesce(sum(amount) filter(where coalesce(original_type,operation_type)='bank_interest_received'),0) interest
    from postings where account='cash' and liquidity_location='bank'
  ) select json_build_object(
    'members',(select count(*) from public.cycle_members where cycle_id='${c}'),
    'received',(select to_char(coalesce(sum(amount),0),'FM999999999999999990.00') from public.savings_contributions where cycle_id='${c}' and status<>'reversed' and effective_date<='2026-10-20'),
    'accounts',(select json_object_agg(account,amount) from accounts),
    'bank',to_char(bank.balance,'FM999999999999999990.00'),
    'interest',to_char(bank.interest,'FM999999999999999990.00'),
    'base',to_char(bank.balance-bank.interest,'FM999999999999999990.00'),
    'operations',(select count(*) from public.financial_operations where cycle_id='${c}'),
    'entries',(select count(*) from public.ledger_entries where cycle_id='${c}')
  ) from bank;`);
  writeFileSync('incoming/ci-database/ux-invariants.json', JSON.stringify(JSON.parse(expected), null, 2));
  console.log('Oráculo SQL de invariantes UX guardado antes de abrir el navegador.');
}
