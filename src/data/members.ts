import { supabase } from '../lib/supabase';
import type { CycleMember } from '../lib/types';
import { fetchAllPages } from './pagination';

export interface SaveMemberInput {
  workspaceId: string;
  cycleId: string;
  displayName: string;
  legacyId?: string;
  monthlyQuota: string;
  participationStartMonth: number;
  participationEndMonth: number;
  participatesInPolla: boolean;
  participatesInLoanProfit: boolean;
}

export async function listCycleMembers(cycleId: string): Promise<CycleMember[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('cycle_members')
      .select('*, member:members(*)')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as CycleMember[];
  });
}

export async function createCycleMember(input: SaveMemberInput): Promise<void> {
  const { error } = await supabase.rpc('save_cycle_member', {
    p_workspace_id: input.workspaceId,
    p_cycle_id: input.cycleId,
    p_member_id: null,
    p_cycle_member_id: null,
    p_display_name: input.displayName.trim(),
    p_legacy_id: input.legacyId?.trim() || null,
    p_monthly_quota: input.monthlyQuota,
    p_participation_start_month: input.participationStartMonth,
    p_participation_end_month: input.participationEndMonth,
    p_participates_in_polla: input.participatesInPolla,
    p_participates_in_loan_profit: input.participatesInLoanProfit
  });

  if (error) {
    throw new Error(error.message);
  }
}

export async function updateCycleMember(input: SaveMemberInput & { memberId: string; cycleMemberId: string }): Promise<void> {
  const { error } = await supabase.rpc('save_cycle_member', {
    p_workspace_id: input.workspaceId,
    p_cycle_id: input.cycleId,
    p_member_id: input.memberId,
    p_cycle_member_id: input.cycleMemberId,
    p_display_name: input.displayName.trim(),
    p_legacy_id: input.legacyId?.trim() || null,
    p_monthly_quota: input.monthlyQuota,
    p_participation_start_month: input.participationStartMonth,
    p_participation_end_month: input.participationEndMonth,
    p_participates_in_polla: input.participatesInPolla,
    p_participates_in_loan_profit: input.participatesInLoanProfit
  });

  if (error) {
    throw new Error(error.message);
  }
}
