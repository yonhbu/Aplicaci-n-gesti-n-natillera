import { describe, expect, it, beforeEach } from 'vitest';
import {
  canonicalizeFinancialPayload,
  clearPendingFinancialOperation,
  getOrCreatePendingFinancialOperation,
  readPendingFinancialOperation
} from './pendingFinancialOperationStorage';

describe('pending financial operation storage', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('canonicalizes payload key order', () => {
    expect(canonicalizeFinancialPayload({ b: 2, a: { z: 1, c: 3 } })).toBe(
      canonicalizeFinancialPayload({ a: { c: 3, z: 1 }, b: 2 })
    );
  });

  it('reuses the same key for an identical unresolved operation', () => {
    const first = getOrCreatePendingFinancialOperation('cycle:action:entity', { amount: '100.00', date: '2026-10-06' }, () => 'key-1');
    const second = getOrCreatePendingFinancialOperation('cycle:action:entity', { date: '2026-10-06', amount: '100.00' }, () => 'key-2');

    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it('blocks replacing an uncertain operation with different payload', () => {
    getOrCreatePendingFinancialOperation('cycle:action:entity', { amount: '100.00' }, () => 'key-1');

    expect(() => getOrCreatePendingFinancialOperation('cycle:action:entity', { amount: '101.00' }, () => 'key-2')).toThrow(
      'operacion financiera pendiente'
    );
  });

  it('clears only the selected scope', () => {
    getOrCreatePendingFinancialOperation('one', { amount: '100.00' }, () => 'key-1');
    getOrCreatePendingFinancialOperation('two', { amount: '200.00' }, () => 'key-2');

    clearPendingFinancialOperation('one');

    expect(readPendingFinancialOperation('one')).toBeNull();
    expect(readPendingFinancialOperation('two')?.idempotencyKey).toBe('key-2');
  });
});
