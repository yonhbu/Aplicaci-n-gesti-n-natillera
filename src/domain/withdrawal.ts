import Decimal from 'decimal.js';
import { assertCivilDate, compareCivilDates, daysBetween, type CivilDate } from './date';
import { roundCurrency, roundPeso } from './money';

export interface YieldContributionInput {
  amount: Decimal.Value;
  effectiveDate: string;
}

export interface WithdrawalPreviewInput {
  contributions: YieldContributionInput[];
  cutDate: string;
  annualEffectiveRate: Decimal.Value;
  pendingNetPrizes: Decimal.Value;
  debts: Decimal.Value;
  annualAdminFee: Decimal.Value;
  penalty: Decimal.Value;
  otherDiscounts?: Decimal.Value;
}

export interface ContributionYield {
  amount: Decimal;
  effectiveDate: CivilDate;
  days: number;
  yieldAmount: Decimal;
}

export interface WithdrawalPreview {
  contributed: Decimal;
  recognizedYield: Decimal;
  recognizedYieldRounded: Decimal;
  pendingNetPrizes: Decimal;
  debts: Decimal;
  annualAdminFee: Decimal;
  penalty: Decimal;
  otherDiscounts: Decimal;
  net: Decimal;
  transferRounded: Decimal;
  roundingAdjustment: Decimal;
  contributionYields: ContributionYield[];
}

export function calculateContributionYield(input: YieldContributionInput, cutDateValue: string, annualRate: Decimal.Value): ContributionYield {
  const effectiveDate = assertCivilDate(input.effectiveDate, 'fecha efectiva');
  const cutDate = assertCivilDate(cutDateValue, 'fecha de corte');
  const amount = new Decimal(input.amount);
  const rate = new Decimal(annualRate);

  if (amount.lte(0)) {
    throw new Error('El aporte debe ser mayor que cero.');
  }
  if (rate.lt(0)) {
    throw new Error('La tasa no puede ser negativa.');
  }
  if (compareCivilDates(effectiveDate, cutDate) > 0) {
    return { amount, effectiveDate, days: 0, yieldAmount: new Decimal(0) };
  }

  const days = daysBetween(effectiveDate, cutDate);
  if (days <= 0 || rate.eq(0)) {
    return { amount, effectiveDate, days: Math.max(0, days), yieldAmount: new Decimal(0) };
  }

  const factor = Decimal.pow(rate.plus(1), new Decimal(days).div(365)).minus(1);
  return { amount, effectiveDate, days, yieldAmount: amount.mul(factor) };
}

export function previewWithdrawal(input: WithdrawalPreviewInput): WithdrawalPreview {
  const cutDate = assertCivilDate(input.cutDate, 'fecha de corte');
  const contributionYields = input.contributions.map((contribution) =>
    calculateContributionYield(contribution, cutDate, input.annualEffectiveRate),
  );
  const contributed = contributionYields.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
  const recognizedYield = contributionYields.reduce((sum, item) => sum.plus(item.yieldAmount), new Decimal(0));
  const recognizedYieldRounded = roundCurrency(recognizedYield);
  const pendingNetPrizes = new Decimal(input.pendingNetPrizes);
  const debts = new Decimal(input.debts);
  const annualAdminFee = new Decimal(input.annualAdminFee);
  const penalty = new Decimal(input.penalty);
  const otherDiscounts = new Decimal(input.otherDiscounts ?? 0);
  const net = roundCurrency(
    contributed
      .plus(recognizedYieldRounded)
      .plus(pendingNetPrizes)
      .minus(debts)
      .minus(annualAdminFee)
      .minus(penalty)
      .minus(otherDiscounts),
  );
  const transferRounded = roundPeso(net);

  return {
    contributed,
    recognizedYield,
    recognizedYieldRounded,
    pendingNetPrizes,
    debts,
    annualAdminFee,
    penalty,
    otherDiscounts,
    net,
    transferRounded,
    roundingAdjustment: transferRounded.minus(net),
    contributionYields
  };
}
