import { describe, expect, it } from 'vitest';
import type { FinancialOperation, LoanContract, LoanPayment } from '../lib/types';
import { loanPosition } from './loanPosition';

const loan = {
  id: 'historical-loan', principal: '500000', legacy_paid_capital_amount: '0',
  status: 'paid', cancelled_at: '2026-10-26', settlement_applications: [],
  workspace_id: 'synthetic-workspace', cycle_id: 'synthetic-cycle', borrower_member_id: null,
  external_borrower_name: 'Deudor sintético', referred_by_member_id: null,
  method: 'interest_only', rate_unit: 'MONTHLY_FIXED', rate_value: '0.05', term_months: 4,
  start_date: '2026-08-01', scheduled_payment: null, prepayment_first_month_interest: null,
  settlement_agreement_code: null, disbursed_operation_id: 'disbursement', legacy_id: null,
  legacy_note: null, legacy_paid_interest_amount: '0', legacy_payment_state: 'none'
} as LoanContract;
const receipt = {
  id: 'total-payment', loan_id: loan.id, operation_id: 'total-receipt',
  payment_date: '2026-10-26', capital_amount: '500000', interest_amount: '0', amount: '500000',
  kind: 'prepayment', status: 'posted'
} as LoanPayment;
const reversal = { id: 'undo', reverses_operation_id: receipt.operation_id, effective_date: '2026-10-27' } as FinancialOperation;

describe('estado contractual de un pago total según su fecha y reverso', () => {
  it('un pago total del 26 no oculta una deuda de 500.000 en el corte del 25', () => {
    const before = loanPosition(loan, [receipt], '2026-10-25');
    expect(before.pendingPrincipal.toFixed(2)).toBe('500000.00');
    expect(before.actual).toHaveLength(0);
    expect(before.status).toBe('active');
  });
  it('el mismo pago extingue el capital en su fecha efectiva', () => {
    const paid = loanPosition(loan, [receipt], '2026-10-26');
    expect(paid.pendingPrincipal.toFixed(2)).toBe('0.00');
    expect(paid.status).toBe('paid');
  });
  it('un reverso del 27 no reabre retrospectivamente el contrato en el corte del 26', () => {
    const current = { ...loan, status: 'active' as const };
    const reversed = { ...receipt, status: 'reversed' as const };
    const beforeReversal = loanPosition(current, [reversed], '2026-10-26', [reversal]);
    expect(beforeReversal.pendingPrincipal.toFixed(2)).toBe('0.00');
    expect(beforeReversal.actual.map(payment => payment.id)).toEqual([receipt.id]);
    expect(beforeReversal.status).toBe('paid');
  });
  it('al llegar al reverso se restaura exactamente el capital y estado activo', () => {
    const restored = loanPosition({ ...loan, status: 'active' }, [{ ...receipt, status: 'reversed' }], '2026-10-27', [reversal]);
    expect(restored.pendingPrincipal.toFixed(2)).toBe('500000.00');
    expect(restored.actual).toHaveLength(0);
    expect(restored.status).toBe('active');
  });
});
