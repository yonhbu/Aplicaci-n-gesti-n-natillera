import Decimal from 'decimal.js';
import type { FinancialOperation, LedgerEntry } from '../lib/types';
import { reconstructMoney } from './financialReconstruction';

export function adminPosition(operations: FinancialOperation[], entries: LedgerEntry[], cutDate: string) {
  const totals = { polla: new Decimal(0), loans: new Decimal(0), fines: new Decimal(0), annual: new Decimal(0), coverage: new Decimal(0), residual: new Decimal(0), other: new Decimal(0), withdrawals: new Decimal(0) };
  const rows = reconstructMoney(operations, entries, cutDate).rows.flatMap(row => row.postings.filter(entry => entry.account === 'admin_payable').map(entry => {
    const type = row.kind;
    const kind: keyof typeof totals = type === 'admin_fee_recognized' ? 'annual'
      : type === 'admin_penalty_recognized' || type === 'admin_fine_received' || type === 'legacy_fine_reclassification' ? 'fines'
      : type === 'polla_prize_awarded' || type === 'polla_prize_credited' ? 'polla'
      : type === 'admin_withdrawal' ? 'withdrawals'
      : type.startsWith('loan_profit_') ? 'coverage'
      : type === 'legacy_loan_interest_correction' || type.startsWith('loan') || type.startsWith('member_settlement') ? 'loans'
      : type === 'bank_yield_distributed' ? 'residual' : 'other';
    const value = new Decimal(entry.amount).negated(); totals[kind] = totals[kind].plus(value);
    return { entry, operation: row.operation, kind, value };
  })).reverse();
  const earned = totals.polla.plus(totals.loans).plus(totals.fines).plus(totals.annual).plus(totals.residual).plus(totals.other);
  return { totals, rows, earned, balance: earned.plus(totals.coverage).plus(totals.withdrawals) };
}
