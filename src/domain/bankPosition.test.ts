import { expect, it } from 'vitest';
import { bankPosition } from './bankPosition';
import type { FinancialOperation, LedgerEntry } from '../lib/types';
const op = (id: string, type: string, date = '2026-10-01', reverses: string | null = null) =>
  ({ id, operation_type: type, effective_date: date, reverses_operation_id: reverses } as FinancialOperation);
const entry = (operation: string, amount: string, bank = 'bank-a') =>
  ({ operation_id: operation, account: 'cash', amount, liquidity_location: bank ? 'bank' : 'cash', bank_account_id: bank || null } as LedgerEntry);
it('separates actual bank interest from its bank balance without counting it twice', () => {
  const position = bankPosition([op('saving', 'savings_contribution_linked'), op('yield', 'bank_interest_received')],
    [entry('saving', '1000'), entry('yield', '19.25')], 'bank-a', '2026-10-20');
  expect(position.balance.toFixed(2)).toBe('1019.25');
  expect(position.interest.toFixed(2)).toBe('19.25');
  expect(position.base.plus(position.interest).eq(position.balance)).toBe(true);
});
it('includes reversals by effective date and original type, never drops original history', () => {
  const operations = [op('yield', 'bank_interest_received'), op('undo', 'reversal', '2026-10-16', 'yield')];
  const entries = [entry('yield', '19.25'), entry('undo', '-19.25')];
  expect(bankPosition(operations, entries, 'bank-a', '2026-10-15').interest.toFixed(2)).toBe('19.25');
  expect(bankPosition(operations, entries, 'bank-a', '2026-10-20').interest.toFixed(2)).toBe('0.00');
});
it('excludes other banks, cash, future and non-cash allocations', () => {
  const operations = [op('yield', 'bank_interest_received'), op('future', 'bank_interest_received', '2026-11-01'), op('prize', 'polla_prize_capitalized')];
  const entries = [entry('yield', '10'), entry('yield', '20', 'bank-b'), entry('yield', '30', ''), entry('future', '100'),
    { ...entry('prize', '500'), account: 'savings_liability', liquidity_location: 'unknown' } as LedgerEntry];
  const position = bankPosition(operations, entries, 'bank-a', '2026-10-20');
  expect(position.balance.toFixed(2)).toBe('10.00');
  expect(position.interest.toFixed(2)).toBe('10.00');
});
it('records internal location changes without treating them as income', () => {
  const position = bankPosition([op('correction', 'cash_location_corrected')],
    [entry('correction', '-100', ''), entry('correction', '100')], 'bank-a', '2026-10-20');
  expect(position.balance.toFixed(2)).toBe('100.00');
  expect(position.interest.toFixed(2)).toBe('0.00');
});
