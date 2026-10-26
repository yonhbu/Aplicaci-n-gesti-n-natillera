import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBankInterestInput } from '../scripts/lib/bank-interest-input.mjs';
const base = { cycleId: 'b1800000-0000-4000-8000-000000000001', bankId: 'b1800000-0000-4000-8000-000000000002' };
const validate = (receipts, extra = {}, through = '2026-10-01') => validateBankInterestInput({ ...base, receipts, ...extra }, through, '2026-10-17');
test('actual first-day receipt is allowed before the end of the posting month', () => {
  assert.equal(validate([{ date: '2026-10-01', amount: '123.25' }]).total, '123.25');
});
test('sums cents exactly and preserves each date', () => {
  const result = validate([{ date: '2026-09-01', amount: '0.10' }, { date: '2026-10-01', amount: '0.20' }], { expectedTotal: '0.30' });
  assert.equal(result.total, '0.30'); assert.equal(result.receipts[1].date, '2026-10-01');
});
test('conflicting declared total fails before any database operation', () => {
  assert.throws(() => validate([{ date: '2026-10-01', amount: '123.25' }], { expectedTotal: '123.20' }), /No se escribe nada/);
});
for (const [name, receipts, through] of [
  ['duplicate', [{ date: '2026-10-01', amount: 1 }, { date: '2026-10-01', amount: 1 }]],
  ['nonexistent date', [{ date: '2026-02-30', amount: 1 }]],
  ['after confirmed cutoff', [{ date: '2026-10-02', amount: 1 }]],
  ['future cutoff', [{ date: '2026-10-01', amount: 1 }], '2026-10-31'],
  ['negative', [{ date: '2026-10-01', amount: '-1' }]],
  ['zero', [{ date: '2026-10-01', amount: '0' }]],
  ['fractional cents', [{ date: '2026-10-01', amount: '1.001' }]],
  ['localized ambiguous amount', [{ date: '2026-10-01', amount: '1.200,25' }]],
  ['empty', []],
]) test(`rejects ${name}`, () => assert.throws(() => validate(receipts, {}, through)));
