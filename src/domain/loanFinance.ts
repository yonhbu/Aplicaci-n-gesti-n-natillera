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

export interface LoanScheduleRow {
  installmentNumber: number;
  dueDate: string;
  principalDue: Decimal;
  interestDue: Decimal;
  totalDue: Decimal;
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

export function buildLoanSchedule(input: {
  principal: Decimal.Value;
  method: LoanMethod;
  rateUnit: RateUnit;
  rateValue: Decimal.Value;
  termMonths: number;
  startDate: string;
}): LoanScheduleRow[] {
  const startDate = assertCivilDate(input.startDate, 'fecha inicial');
  const principal = roundCurrency(new Decimal(input.principal));
  const rate = new Decimal(input.rateValue);
  if (principal.lte(0)) {
    throw new Error('El principal debe ser mayor que cero.');
  }
  if (rate.lt(0)) {
    throw new Error('La tasa no puede ser negativa.');
  }
  if (!Number.isInteger(input.termMonths) || input.termMonths < 1) {
    throw new Error('El plazo no es valido.');
  }

  let outstanding = principal;
  let previousDate: string = startDate;
  const payment = input.method === 'amortized' && input.rateUnit === 'MONTHLY_FIXED' && rate.gt(0)
    ? principal.mul(rate).div(new Decimal(1).minus(new Decimal(1).plus(rate).pow(-input.termMonths)))
    : principal.div(input.termMonths);

  return Array.from({ length: input.termMonths }, (_, index) => {
    const installmentNumber = index + 1;
    const dueDate = addMonths(startDate, installmentNumber);
    const interestDue = input.rateUnit === 'MONTHLY_FIXED'
      ? roundCurrency((input.method === 'fixed_interest' ? principal : outstanding).mul(rate))
      : calculateEaInterest({
        principal: outstanding,
        annualEffectiveRate: rate,
        fromDate: previousDate,
        toDate: dueDate
      }).cents;

    let principalDue: Decimal;
    if (input.method === 'interest_only' && installmentNumber < input.termMonths) {
      principalDue = new Decimal(0);
    } else if (input.method === 'fixed_interest' && installmentNumber < input.termMonths) {
      principalDue = roundCurrency(principal.div(input.termMonths));
    } else if (input.method === 'amortized' && installmentNumber < input.termMonths) {
      principalDue = Decimal.max(roundCurrency(payment.minus(interestDue)), 0);
    } else {
      principalDue = roundCurrency(outstanding);
    }

    const row = {
      installmentNumber,
      dueDate,
      principalDue,
      interestDue,
      totalDue: roundCurrency(principalDue.plus(interestDue))
    };
    outstanding = outstanding.minus(principalDue);
    previousDate = dueDate;
    return row;
  });
}

function addMonths(date: string, months: number) {
  const [year, month, day] = date.split('-').map(Number);
  const result = new Date(Date.UTC(year, month - 1 + months, day));
  return result.toISOString().slice(0, 10);
}
