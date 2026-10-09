export interface PendingFinancialOperation {
  scope: string;
  idempotencyKey: string;
  canonicalPayload: string;
  status: 'pending' | 'uncertain';
  createdAt: string;
}

const storagePrefix = 'natillera.financial.pending.';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortValue(child)])
    );
  }
  return value;
}

export function canonicalizeFinancialPayload(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function readPendingFinancialOperation(scope: string): PendingFinancialOperation | null {
  try {
    const raw = window.localStorage.getItem(`${storagePrefix}${scope}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingFinancialOperation;
    if (!parsed.scope || !parsed.idempotencyKey || !parsed.canonicalPayload) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writePendingFinancialOperation(operation: PendingFinancialOperation) {
  window.localStorage.setItem(`${storagePrefix}${operation.scope}`, JSON.stringify(operation));
}

export function clearPendingFinancialOperation(scope: string) {
  window.localStorage.removeItem(`${storagePrefix}${scope}`);
}

export function getOrCreatePendingFinancialOperation(
  scope: string,
  payload: unknown,
  makeKey: () => string
): PendingFinancialOperation {
  const canonicalPayload = canonicalizeFinancialPayload(payload);
  const existing = readPendingFinancialOperation(scope);
  if (existing) {
    if (existing.canonicalPayload !== canonicalPayload) {
      throw new Error('Hay una operacion financiera pendiente con otra carga. Reintente la operacion original o revise si ya quedo registrada.');
    }
    return existing;
  }
  const created: PendingFinancialOperation = {
    scope,
    idempotencyKey: makeKey(),
    canonicalPayload,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  writePendingFinancialOperation(created);
  return created;
}
