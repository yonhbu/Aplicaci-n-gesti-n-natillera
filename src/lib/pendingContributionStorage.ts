import type { PendingContributionOperation } from '../domain/pendingContribution';

const storageKey = 'natillera.hu001.pendingContribution';

export function readPendingContribution(): PendingContributionOperation | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as PendingContributionOperation;
    if (!parsed.idempotencyKey || !parsed.canonicalPayload || !parsed.draft) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writePendingContribution(operation: PendingContributionOperation) {
  window.localStorage.setItem(storageKey, JSON.stringify(operation));
}

export function clearPendingContribution() {
  window.localStorage.removeItem(storageKey);
}
