import { toDatabaseMoney } from './money';
import { validateContributionDraft, type ContributionDraft, type ContributionMethod } from './savings';

export interface PendingContributionOperation {
  idempotencyKey: string;
  canonicalPayload: string;
  draft: {
    memberId: string;
    amount: string;
    effectiveDate: string;
    appliedYear: number;
    appliedMonth: number;
    method: ContributionMethod;
  };
  status: 'pending' | 'unknown';
  updatedAt: string;
}

export function canonicalContributionPayload(draft: ContributionDraft): PendingContributionOperation['draft'] {
  const valid = validateContributionDraft(draft);
  return {
    memberId: valid.memberId,
    amount: toDatabaseMoney(valid.amount),
    effectiveDate: valid.effectiveDate,
    appliedYear: valid.appliedYear,
    appliedMonth: valid.appliedMonth,
    method: valid.method
  };
}

export function serializeContributionPayload(payload: PendingContributionOperation['draft']): string {
  return JSON.stringify({
    memberId: payload.memberId,
    amount: payload.amount,
    effectiveDate: payload.effectiveDate,
    appliedYear: payload.appliedYear,
    appliedMonth: payload.appliedMonth,
    method: payload.method
  });
}

export function buildPendingContributionOperation(input: {
  draft: ContributionDraft;
  existing: PendingContributionOperation | null;
  now: Date;
  makeKey: () => string;
}): PendingContributionOperation {
  const payload = canonicalContributionPayload(input.draft);
  const canonicalPayload = serializeContributionPayload(payload);
  const idempotencyKey =
    input.existing?.canonicalPayload === canonicalPayload
      ? input.existing.idempotencyKey
      : input.makeKey();

  return {
    idempotencyKey,
    canonicalPayload,
    draft: payload,
    status: 'pending',
    updatedAt: input.now.toISOString()
  };
}
