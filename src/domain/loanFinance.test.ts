import { describe, expect, it } from 'vitest';
import { allocateCollectedInterest, calculateEaInterest, distributeLoanProfitEqually, quoteP013Prepayment } from './loanFinance';

describe('loanFinance', () => {
  it('calcula 24% EA ACT/365F durante 30 dias', () => {
    const result = calculateEaInterest({
      principal: 500_000,
      annualEffectiveRate: 0.24,
      fromDate: '2026-09-06',
      toDate: '2026-10-06'
    });

    expect(result.days).toBe(30);
    expect(result.unrounded.toDecimalPlaces(10).toFixed(10)).toBe('8918.8053185566');
    expect(result.cents.toFixed(2)).toBe('8918.81');
    expect(result.pesos.toFixed(0)).toBe('8919');
  });

  it('no genera interes con tasa cero o cero dias', () => {
    expect(calculateEaInterest({ principal: 500_000, annualEffectiveRate: 0, fromDate: '2026-09-06', toDate: '2026-10-06' }).cents.toFixed(2)).toBe('0.00');
    expect(calculateEaInterest({ principal: 500_000, annualEffectiveRate: 0.24, fromDate: '2026-10-06', toDate: '2026-10-06' }).cents.toFixed(2)).toBe('0.00');
  });

  it('asigna 10% admin y 90% fondo de socios', () => {
    const allocation = allocateCollectedInterest(25_000);
    expect(allocation.admin.toFixed(2)).toBe('2500.00');
    expect(allocation.memberFund.toFixed(2)).toBe('22500.00');
  });

  it('distribuye igualitario entre elegibles y conserva N=0 pendiente', () => {
    const distribution = distributeLoanProfitEqually(22_500, 9);
    expect(distribution.perEligible.toFixed(2)).toBe('2500.00');
    expect(distribution.undistributed.toFixed(2)).toBe('0.00');

    const none = distributeLoanProfitEqually(22_500, 0);
    expect(none.perEligible.toFixed(2)).toBe('0.00');
    expect(none.undistributed.toFixed(2)).toBe('22500.00');
  });

  it('cotiza prepago especifico P013 sin generalizar la regla', () => {
    const withoutPrior = quoteP013Prepayment({
      principalPending: 500_000,
      firstMonthInterest: 25_000,
      firstMonthInterestAlreadyCollected: false
    });
    expect(withoutPrior.totalDue.toFixed(2)).toBe('525000.00');
    expect(withoutPrior.interestAllocation.admin.toFixed(2)).toBe('2500.00');
    expect(withoutPrior.interestAllocation.memberFund.toFixed(2)).toBe('22500.00');

    const withPrior = quoteP013Prepayment({
      principalPending: 500_000,
      firstMonthInterest: 25_000,
      firstMonthInterestAlreadyCollected: true
    });
    expect(withPrior.totalDue.toFixed(2)).toBe('500000.00');
    expect(withPrior.interestAllocation.admin.toFixed(2)).toBe('0.00');
  });
});
