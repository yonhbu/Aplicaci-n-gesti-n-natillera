import { expect, it } from 'vitest';
import type { Cycle, CycleMember, MemberSettlement, SavingsContribution } from '../lib/types';
import { filterMember, memberSavingsOverview, memberStateAtCut } from './memberOverview';
const cycle = { year: 2026 } as Cycle;
const member = { id: 'a', savings_status: 'active', monthly_quota: '100', participation_start_month: 1, participation_end_month: 12, participates_in_savings: true, participates_in_polla: false, member: { display_name: 'Ángela Prueba' } } as CycleMember;
const receipt = (amount: string, date: string, status = 'posted') => ({ cycle_member_id: 'a', amount, effective_date: date, status } as SavingsContribution);
it('does not infer a historical active status from current state or a last contribution', () => {
  expect(memberStateAtCut(member, cycle, '2026-09-20', '2026-10-20', [])).toBe('unknown');
  expect(memberStateAtCut(member, cycle, '2026-10-20', '2026-10-20', [])).toBe('active');
  expect(memberStateAtCut({ ...member, participation_start_month: 11 }, cycle, '2026-10-20', '2026-10-20', [])).toBe('outside');
});
it('uses a verified effective settlement for retirement without treating a future/reversed settlement as history', () => {
  const settlement = { cycle_member_id: 'a', status: 'confirmed', cut_date: '2026-09-10' } as MemberSettlement;
  expect(memberStateAtCut(member, cycle, '2026-09-20', '2026-10-20', [settlement])).toBe('withdrawn');
  expect(memberStateAtCut(member, cycle, '2026-09-01', '2026-10-20', [settlement])).toBe('unknown');
  expect(memberStateAtCut(member, cycle, '2026-09-20', '2026-10-20', [{ ...settlement, status: 'reversed' }])).toBe('unknown');
});
it('totals exact ordinary receipts at the cut, not the last transaction, and excludes reversals/future data', () => {
  const result = memberSavingsOverview(member, [receipt('100.11', '2026-09-01'), receipt('20.22', '2026-10-01'), receipt('900', '2026-10-21'), receipt('1000', '2026-09-10', 'reversed')], '2026-10-20');
  expect(result.received.toFixed(2)).toBe('120.33'); expect(result.lastDate).toBe('2026-10-01');
  expect(result.target?.toString()).toBe('1200'); expect(result.progress).toBe(10);
});
it('does not fabricate a target for an excluded participant, and keeps overpayments visible', () => {
  expect(memberSavingsOverview({ ...member, participates_in_savings: false }, [], '2026-10-20').target).toBeNull();
  const result = memberSavingsOverview(member, [receipt('1500.99', '2026-09-01')], '2026-10-20');
  expect(result.received.toString()).toBe('1500.99'); expect(result.progress).toBe(100);
});
it('combines accent-insensitive search with real modality and verified active filters', () => {
  expect(filterMember(member, 'active', 'ANGELA', 'fixed')).toBe(true);
  expect(filterMember(member, 'unknown', 'angela', 'active')).toBe(false);
  expect(filterMember(member, 'active', '', 'collective')).toBe(false);
  expect(filterMember({ ...member, economic_mode: 'collective' }, 'active', '', 'collective')).toBe(true);
});
