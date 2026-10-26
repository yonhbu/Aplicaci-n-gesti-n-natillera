import Decimal from 'decimal.js';
import type { Cycle, CycleMember, MemberSettlement, SavingsContribution } from '../lib/types';
import { progressPercent } from './viewSummaries';

export type PresentedMemberState = 'active' | 'withdrawn' | 'inactive' | 'outside' | 'unknown';
export type MemberFilter = 'all' | 'active' | 'fixed' | 'collective';

/** Presentation only. Never decides quota eligibility, interest or settlement rights. */
export function memberStateAtCut(member: CycleMember, cycle: Cycle, cutDate: string, today: string, settlements: MemberSettlement[]): PresentedMemberState {
  const retired = settlements.some(item => item.cycle_member_id === member.id && item.status !== 'reversed' && item.cut_date <= cutDate);
  if (retired) return 'withdrawn';
  if (cutDate === today && member.savings_status !== 'active') return member.savings_status;
  const month = Number(cutDate.slice(5, 7));
  if (Number(cutDate.slice(0, 4)) !== cycle.year || month < member.participation_start_month || month > member.participation_end_month) return 'outside';
  // A current status or a last contribution is not proof of status on a past day.
  return cutDate === today ? member.savings_status : 'unknown';
}

export const memberIsCollective = (member: CycleMember) => member.economic_mode === 'collective' || member.economic_mode == null && member.participates_in_polla;
export const normalizeMemberSearch = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-CO').trim();

export function memberSavingsOverview(member: CycleMember, contributions: SavingsContribution[], cutDate: string) {
  const receipts = contributions.filter(item => item.cycle_member_id === member.id && item.effective_date <= cutDate && item.status !== 'reversed');
  const received = receipts.reduce((sum, item) => sum.plus(item.amount), new Decimal(0));
  const lastDate = receipts.reduce<string | null>((date, item) => !date || item.effective_date > date ? item.effective_date : date, null);
  const months = member.participation_end_month - member.participation_start_month + 1;
  // Same quota × registered months reference used by the existing savings overview.
  // It is not a versioned historical contract or a withdrawable balance.
  const target = member.participates_in_savings !== false && months > 0 && new Decimal(member.monthly_quota).gt(0)
    ? new Decimal(member.monthly_quota).mul(months) : null;
  return { received, lastDate, target, progress: target ? progressPercent(received, target) : null };
}

export function filterMember(member: CycleMember, state: PresentedMemberState, query: string, filter: MemberFilter) {
  const matches = normalizeMemberSearch(`${member.member?.display_name ?? ''} ${member.member?.legacy_id ?? ''}`).includes(normalizeMemberSearch(query));
  return matches && (filter === 'all' || filter === 'active' && state === 'active' || filter === 'fixed' && !memberIsCollective(member) || filter === 'collective' && memberIsCollective(member));
}
