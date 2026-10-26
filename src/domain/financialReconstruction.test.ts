import { expect, it } from 'vitest';
import { originalPrincipalAtCut, reconstructMoney, validCutDate } from './financialReconstruction';
import { bankPosition } from './bankPosition';
import { adminPosition } from './adminPosition';
import type { FinancialOperation, LedgerEntry, LoanContract } from '../lib/types';

const op = (id: string, type: string, date: string, undo: string | null = null, payload = {}) => ({ id, operation_type: type, effective_date: date, created_at: date, reverses_operation_id: undo, payload } as FinancialOperation);
const e = (id: string, account: string, amount: string, location = 'unknown', bank: string | null = null) => ({ id: id + account + amount, operation_id: id, account, amount, liquidity_location: location, bank_account_id: bank } as LedgerEntry);

it('original yearly principal includes paid consolidated loans and excludes future or annulled disbursements', () => {
  const loans = [
    { principal: '1000', legacy_id: 'SYN-PAID', status: 'paid', start_date: '2026-01-01', disbursed_operation_id: null },
    { principal: '2000', status: 'active', start_date: '2026-01-01', disbursed_operation_id: 'new' },
    { principal: '3000', status: 'draft', start_date: '2026-01-01', disbursed_operation_id: null },
  ] as LoanContract[];
  const operations = [op('new', 'loan_disbursement', '2026-10-16'), op('undo', 'reversal', '2026-10-20', 'new')];
  expect(originalPrincipalAtCut(loans, operations, '2026-10-15').eq(1000)).toBe(true);
  expect(originalPrincipalAtCut(loans, operations, '2026-10-16').eq(3000)).toBe(true);
  expect(originalPrincipalAtCut(loans, operations, '2026-10-20').eq(1000)).toBe(true);
});

it('reconstructs January through October without a fabricated opening, and thirteen disbursements once', () => {
  const operations = [op('s', 'savings_contribution_linked', '2026-01-02'), op('p', 'polla_contribution', '2026-02-01'), op('f', 'admin_fine_received', '2026-03-01'), op('y', 'bank_interest_received', '2026-10-01')];
  const entries = [e('s', 'cash', '20000', 'bank', 'a'), e('s', 'savings_liability', '-20000'), e('p', 'cash', '1000', 'bank', 'a'), e('p', 'polla_pool', '-1000'), e('f', 'cash', '20', 'bank', 'a'), e('f', 'admin_payable', '-20'), e('y', 'cash', '29.25', 'bank', 'a'), e('y', 'bank_interest_income', '-29.25')];
  for (let i = 0; i < 13; i++) {
    operations.push(op('loan' + i, 'loan_disbursement', '2026-04-01'), op('pay' + i, 'loan_payment', '2026-05-01'));
    entries.push(e('loan' + i, 'cash', '-1000', 'bank', 'a'), e('loan' + i, 'loans_receivable', '1000'), e('pay' + i, 'cash', '110', 'bank', 'a'), e('pay' + i, 'loans_receivable', '-100'), e('pay' + i, 'admin_payable', '-1'), e('pay' + i, 'member_loan_profit_fund', '-9'));
  }
  expect(reconstructMoney(operations, entries, '2026-01-01').cash.toFixed(2)).toBe('0.00');
  const position = reconstructMoney(operations, entries, '2026-10-20');
  expect(position.cash.toFixed(2)).toBe('9479.25'); expect(position.receivable.toFixed(2)).toBe('11700.00');
  expect(position.accountingDifference.isZero()).toBe(true); expect(position.unbalancedOperations).toBe(0);
  expect(position.concepts.get('loan_disbursement')?.toFixed(2)).toBe('-13000.00');
  expect(position.rows.filter(row => row.kind === 'loan_payment').reduce((sum, row) => sum + row.capitalRecovered.toNumber(), 0)).toBe(1300);
  expect(position.rows.filter(row => row.kind === 'loan_payment').every(row => row.interestCollected.eq(10))).toBe(true);
  expect(bankPosition(operations, entries, 'a', '2026-10-20').base.toFixed(2)).toBe('9450.00');
});
it('retains original cash and interest until the effective day of annulment', () => {
  const operations = [op('p', 'loan_payment', '2026-10-15'), op('u', 'reversal', '2026-10-16', 'p')];
  const entries = [e('p', 'cash', '110', 'bank', 'a'), e('p', 'loans_receivable', '-100'), e('p', 'admin_payable', '-1'), e('p', 'member_loan_profit_fund', '-9'), e('u', 'cash', '-110', 'bank', 'a'), e('u', 'loans_receivable', '100'), e('u', 'admin_payable', '1'), e('u', 'member_loan_profit_fund', '9')];
  expect(reconstructMoney(operations, entries, '2026-10-15').cash.eq(110)).toBe(true);
  const after = reconstructMoney(operations, entries, '2026-10-16'); expect(after.cash.isZero()).toBe(true); expect(after.rows).toHaveLength(2);
  expect(adminPosition(operations, entries, '2026-10-16').balance.isZero()).toBe(true);
});
it('internal prizes, commissions, bank allocations and location transfers cannot create money', () => {
  const operations = [op('s', 'savings_contribution_linked', '2026-01-01'), op('t', 'liquidity_transfer', '2026-01-02'), op('c', 'polla_prize_credited', '2026-01-03'), op('b', 'bank_yield_distributed', '2026-01-04')];
  const entries = [e('s', 'cash', '1000', 'cash'), e('s', 'savings_liability', '-1000'), e('t', 'cash', '-1000', 'cash'), e('t', 'cash', '1000', 'bank', 'a'), e('c', 'polla_pool', '50'), e('c', 'savings_liability', '-45'), e('c', 'admin_payable', '-5'), e('b', 'bank_interest_income', '10'), e('b', 'savings_liability', '-10')];
  const position = reconstructMoney(operations, entries, '2026-10-20');
  expect(position.cash.eq(1000)).toBe(true); expect(position.bank.eq(1000)).toBe(true); expect(position.physicalCash.isZero()).toBe(true);
  expect(position.concepts.get('liquidity_transfer')?.isZero()).toBe(true); expect(bankPosition(operations, entries, 'a', '2026-10-20').interest.isZero()).toBe(true);
});
it('separates personal property and its obligation without making it spendable natillera cash', () => {
  const operations = [op('in', 'personal_funds_received', '2026-10-01', null, { bank_account_id: 'a' }), op('out', 'personal_funds_returned', '2026-10-10', null, { bank_account_id: 'a' }), op('undo', 'reversal', '2026-10-11', 'out')];
  const entries = [e('in', 'personal_bank_cash', '200.40'), e('in', 'personal_funds_payable', '-200.40'), e('out', 'personal_bank_cash', '-100'), e('out', 'personal_funds_payable', '100'), e('undo', 'personal_bank_cash', '100'), e('undo', 'personal_funds_payable', '-100')];
  const result = reconstructMoney(operations, entries, '2026-10-20'); expect(result.cash.isZero()).toBe(true);
  expect(result.personalBanks.get('a')?.eq('200.40')).toBe(true); expect(result.accountingDifference.isZero()).toBe(true);
});
it('keeps unknown money separate and detects incomplete ledger data without silently counting it', () => {
  const result = reconstructMoney([op('s', 'legacy_opening', '2026-10-01')], [e('s', 'cash', '50'), e('missing', 'cash', '9999')], '2026-10-20');
  expect(result.bank.isZero()).toBe(true); expect(result.unknown.eq(50)).toBe(true); expect(result.orphanEntries).toBe(1); expect(result.unbalancedOperations).toBe(1);
  expect(result.rows[0].provenance).toContain('no acredita fecha bancaria');
});
it('rejects impossible or out-of-cycle civil cuts', () => {
  for (const date of ['', '2026-02-30', '2025-12-31', '2026-10-21', 'infinity']) expect(validCutDate(date, '2026-01-01', '2026-10-20')).toBe(false);
  expect(validCutDate('2026-10-20', '2026-01-01', '2026-10-20')).toBe(true);
});
it('shows annual fees, penalties, award commissions, loan share, coverage and actual withdrawals separately', () => {
  const operations = [op('annual', 'admin_fee_recognized', '2026-10-01'), op('penalty', 'admin_penalty_recognized', '2026-10-01'), op('polla', 'polla_prize_credited', '2026-10-01'), op('loan', 'loan_payment', '2026-10-01'), op('coverage', 'loan_profit_period_confirmed', '2026-10-01'), op('withdraw', 'admin_withdrawal', '2026-10-02')];
  const entries = [e('annual', 'admin_payable', '-20000'), e('penalty', 'admin_payable', '-50000'), e('polla', 'admin_payable', '-5000'), e('loan', 'admin_payable', '-100'), e('coverage', 'admin_payable', '500'), e('withdraw', 'admin_payable', '1000')];
  const result = adminPosition(operations, entries, '2026-10-20'); expect(result.earned.eq(75100)).toBe(true); expect(result.balance.eq(73600)).toBe(true);
  expect(result.totals.fines.eq(50000)).toBe(true); expect(result.totals.annual.eq(20000)).toBe(true); expect(result.totals.coverage.eq(-500)).toBe(true);
});
