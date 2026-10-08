import { describe, expect, it } from 'vitest';
import { buildPendingContributionOperation } from './pendingContribution';

const baseDraft = {
  memberId: 'member-1',
  amountText: '100.000',
  effectiveDate: '2026-09-23',
  appliedYear: 2026,
  appliedMonth: 10,
  method: 'bank_transfer' as const,
  idempotencyKey: 'ignored'
};

describe('buildPendingContributionOperation', () => {
  it('reutiliza la clave cuando solo cambia el formato monetario', () => {
    const first = buildPendingContributionOperation({
      draft: baseDraft,
      existing: null,
      now: new Date('2026-10-07T00:00:00Z'),
      makeKey: () => 'key-1'
    });

    const second = buildPendingContributionOperation({
      draft: { ...baseDraft, amountText: '100000' },
      existing: first,
      now: new Date('2026-10-07T00:01:00Z'),
      makeKey: () => 'key-2'
    });

    expect(second.idempotencyKey).toBe('key-1');
    expect(second.draft.amount).toBe('100000.00');
  });

  it('crea otra clave si cambia el contenido canonico', () => {
    const first = buildPendingContributionOperation({
      draft: baseDraft,
      existing: null,
      now: new Date('2026-10-07T00:00:00Z'),
      makeKey: () => 'key-1'
    });

    const second = buildPendingContributionOperation({
      draft: { ...baseDraft, appliedMonth: 11 },
      existing: first,
      now: new Date('2026-10-07T00:01:00Z'),
      makeKey: () => 'key-2'
    });

    expect(second.idempotencyKey).toBe('key-2');
  });
});
