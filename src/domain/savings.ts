import Decimal from 'decimal.js';
import { assertCivilDate, monthKey } from './date';
import { parseCop, requirePositiveMoney } from './money';

export type ContributionMethod = 'cash' | 'bank_transfer' | 'bank_deposit' | 'other';
export type ContributionSource = 'manual' | 'legacy_prevalidation';

export interface ContributionDraft {
  memberId: string;
  amountText: string;
  effectiveDate: string;
  appliedYear: number;
  appliedMonth: number;
  method: ContributionMethod;
  idempotencyKey: string;
}

export interface ValidContribution {
  memberId: string;
  amount: Decimal;
  effectiveDate: string;
  appliedYear: number;
  appliedMonth: number;
  appliedMonthKey: string;
  method: ContributionMethod;
  idempotencyKey: string;
}

export function validateContributionDraft(draft: ContributionDraft): ValidContribution {
  const amount = requirePositiveMoney(parseCop(draft.amountText, 'aporte'), 'aporte');
  const effectiveDate = assertCivilDate(draft.effectiveDate, 'fecha efectiva');
  const appliedMonthKey = monthKey(draft.appliedYear, draft.appliedMonth);
  if (!draft.memberId) {
    throw new Error('Selecciona un socio.');
  }
  if (!draft.idempotencyKey.trim()) {
    throw new Error('La clave de idempotencia es obligatoria.');
  }

  return {
    memberId: draft.memberId,
    amount,
    effectiveDate,
    appliedYear: draft.appliedYear,
    appliedMonth: draft.appliedMonth,
    appliedMonthKey,
    method: draft.method,
    idempotencyKey: draft.idempotencyKey.trim()
  };
}

export function pendingForMonth(expectedAmount: Decimal.Value, receivedAmount: Decimal.Value): Decimal {
  const pending = new Decimal(expectedAmount).minus(receivedAmount);
  return pending.gt(0) ? pending : new Decimal(0);
}
