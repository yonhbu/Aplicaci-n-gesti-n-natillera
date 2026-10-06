import { describe, expect, it } from 'vitest';
import { pendingForMonth, validateContributionDraft } from './savings';

describe('validateContributionDraft', () => {
  it('valida aportes parciales y mes aplicado independiente de fecha efectiva', () => {
    const contribution = validateContributionDraft({
      memberId: 'member-1',
      amountText: '50.000',
      effectiveDate: '2026-09-23',
      appliedYear: 2026,
      appliedMonth: 10,
      method: 'bank_transfer',
      idempotencyKey: 'abc'
    });

    expect(contribution.amount.toFixed(2)).toBe('50000.00');
    expect(contribution.appliedMonthKey).toBe('2026-10');
  });

  it('calcula pendiente sin volver negativo el mes', () => {
    expect(pendingForMonth(100_000, 40_000).toFixed(2)).toBe('60000.00');
    expect(pendingForMonth(100_000, 120_000).toFixed(2)).toBe('0.00');
  });
});
