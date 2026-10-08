import Decimal from 'decimal.js';
import { assertCivilDate, daysBetween } from './date';
import { roundCurrency, roundPeso } from './money';

export type LoanMethod = 'amortized' | 'fixed_interest' | 'interest_only';
export type RateUnit = 'EA' | 'MONTHLY_FIXED';

export interface EaInterestInput {
  principal: Decimal.Value;
  annualEffectiveRate: Decimal.Value;
  fromDate: string;
  toDate: string;
}

export interface InterestAllocation {
  interestCollected: Decimal;
  admin: Decimal;
  memberFund: Decimal;
}

export interface EqualMemberDistribution {
  eligibleCount: number;
  perEligible: Decimal;
  undistributed: Decimal;
}

export interface P013PrepaymentQuote {
  principalDue: Decimal;
  interestDue: Decimal;
  totalDue: Decimal;
  interestAllocation: InterestAllocation;
}

export function calculateEaInterest(input: EaInterestInput) {
  const fromDate = assertCivilDate(input.fromDate, 'fecha inicial');
  const toDate = assertCivilDate(input.toDate, 'fecha final');
  const principal = new Decimal(input.principal);
  const rate = new Decimal(input.annualEffectiveRate);

  if (principal.lt(0)) {
    throw new Error('El principal no puede ser negativo.');
  }
  if (rate.lt(0)) {
    throw new Error('La tasa no puede ser negativa.');
  }

  const days = Math.max(0, daysBetween(fromDate, toDate));
  if (days === 0 || rate.eq(0) || principal.eq(0)) {
    return {
      days,
      unrounded: new Decimal(0),
      cents: new Decimal(0),
      pesos: new Decimal(0)
    };
  }

  const unrounded = principal.mul(Decimal.pow(rate.plus(1), new Decimal(days).div(365)).minus(1));
  return {
    days,
    unrounded,
    cents: roundCurrency(unrounded),
    pesos: roundPeso(unrounded)
  };
}

export function allocateCollectedInterest(interestCollected: Decimal.Value): InterestAllocation {
  const interest = new Decimal(interestCollected);
  if (interest.lt(0)) {
    throw new Error('El interes cobrado no puede ser negativo.');
  }
  const admin = roundCurrency(interest.mul(0.1));
  return {
    interestCollected: interest,
    admin,
    memberFund: roundCurrency(interest.minus(admin))
  };
}

export function distributeLoanProfitEqually(memberFund: Decimal.Value, eligibleCount: number): EqualMemberDistribution {
  const fund = new Decimal(memberFund);
  if (!Number.isInteger(eligibleCount) || eligibleCount < 0) {
    throw new Error('El numero de elegibles no es valido.');
  }
  if (eligibleCount === 0) {
    return { eligibleCount, perEligible: new Decimal(0), undistributed: fund };
  }
  const perEligible = fund.div(eligibleCount).toDecimalPlaces(2, Decimal.ROUND_DOWN);
  return {
    eligibleCount,
    perEligible,
    undistributed: roundCurrency(fund.minus(perEligible.mul(eligibleCount)))
  };
}

export function quoteP013Prepayment(input: {
  principalPending: Decimal.Value;
  firstMonthInterest: Decimal.Value;
  firstMonthInterestAlreadyCollected: boolean;
}): P013PrepaymentQuote {
  const principalDue = roundCurrency(new Decimal(input.principalPending));
  const interestDue = input.firstMonthInterestAlreadyCollected
    ? new Decimal(0)
    : roundCurrency(new Decimal(input.firstMonthInterest));
  return {
    principalDue,
    interestDue,
    totalDue: roundCurrency(principalDue.plus(interestDue)),
    interestAllocation: allocateCollectedInterest(interestDue)
  };
}
