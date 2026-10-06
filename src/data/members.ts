import { supabase } from '../lib/supabase';
import type { CycleMember } from '../lib/types';

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
  const { data, error } = await supabase
    .from('cycle_members')
    .select('*, member:members(*)')
    .eq('cycle_id', cycleId)
    .order('created_at', { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as CycleMember[];
}

export async function createCycleMember(input: SaveMemberInput): Promise<void> {
  const memberResult = await supabase
    .from('members')
    .insert({
      workspace_id: input.workspaceId,
      display_name: input.displayName.trim(),
      legacy_id: input.legacyId?.trim() || null
    })
    .select('*')
    .single();

  if (memberResult.error || !memberResult.data) {
    throw new Error(memberResult.error?.message ?? 'No fue posible crear el socio.');
  }

  const cycleMemberResult = await supabase.from('cycle_members').insert({
    workspace_id: input.workspaceId,
    cycle_id: input.cycleId,
    member_id: memberResult.data.id,
    monthly_quota: input.monthlyQuota,
    participation_start_month: input.participationStartMonth,
    participation_end_month: input.participationEndMonth,
    participates_in_polla: input.participatesInPolla,
    participates_in_loan_profit: input.participatesInLoanProfit
  });

  if (cycleMemberResult.error) {
    throw new Error(cycleMemberResult.error.message);
  }
}

export async function updateCycleMember(input: SaveMemberInput & { memberId: string; cycleMemberId: string }): Promise<void> {
  const memberResult = await supabase
    .from('members')
    .update({
      display_name: input.displayName.trim(),
      legacy_id: input.legacyId?.trim() || null
    })
    .eq('id', input.memberId)
    .eq('workspace_id', input.workspaceId);

  if (memberResult.error) {
    throw new Error(memberResult.error.message);
  }

  const cycleMemberResult = await supabase
    .from('cycle_members')
    .update({
      monthly_quota: input.monthlyQuota,
      participation_start_month: input.participationStartMonth,
      participation_end_month: input.participationEndMonth,
      participates_in_polla: input.participatesInPolla,
      participates_in_loan_profit: input.participatesInLoanProfit
    })
    .eq('id', input.cycleMemberId)
    .eq('workspace_id', input.workspaceId);

  if (cycleMemberResult.error) {
    throw new Error(cycleMemberResult.error.message);
  }
}
