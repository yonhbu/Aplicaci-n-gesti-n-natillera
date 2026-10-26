import Decimal from 'decimal.js';
import type { FinancialOperation, LedgerEntry } from '../lib/types';
import { reconstructMoney } from './financialReconstruction';

/** Same dated source as the dashboard and cash views; allocations never add new bank money. */
export function bankPosition(operations: FinancialOperation[], entries: LedgerEntry[], bankId: string, cutDate: string) {
  const position = reconstructMoney(operations, entries, cutDate);
  const rows = position.rows.map(row => ({ operation: row.operation, kind: row.kind,
    amount: row.postings.filter(entry => entry.account === 'cash' && entry.liquidity_location === 'bank' && entry.bank_account_id === bankId)
      .reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0)) })).filter(row => !row.amount.isZero());
  const interest = rows.filter(row => row.kind === 'bank_interest_received').reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
  const balance = position.banks.get(bankId) ?? new Decimal(0);
  return { balance, interest, base: balance.minus(interest), rows, personal: position.personalBanks.get(bankId) ?? new Decimal(0) };
}
