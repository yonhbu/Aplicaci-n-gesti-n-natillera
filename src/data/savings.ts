import { supabase } from '../lib/supabase';
import type { SavingsContribution } from '../lib/types';
import { fetchAllPages } from './pagination';

export interface RegisterContributionInput {
  cycleMemberId: string;
  amount: string;
  effectiveDate: string;
  appliedYear: number;
  appliedMonth: number;
  method: string;
  idempotencyKey: string;
}

export async function listSavingsContributions(cycleId: string): Promise<SavingsContribution[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('savings_contributions')
      .select('*')
      .eq('cycle_id', cycleId)
      .neq('status', 'reversed')
      .order('effective_date', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);

    if (error) {
      throw new Error(error.message);
    }

    return (data ?? []) as SavingsContribution[];
  });
}

export async function registerContribution(input: RegisterContributionInput): Promise<SavingsContribution> {
  const { data, error } = await supabase.rpc('register_savings_contribution', {
    p_cycle_member_id: input.cycleMemberId,
    p_idempotency_key: input.idempotencyKey,
    p_amount: input.amount,
    p_effective_date: input.effectiveDate,
    p_applied_year: input.appliedYear,
    p_applied_month: input.appliedMonth,
    p_method: input.method,
    p_source: 'manual'
  });

  if (error) {
    throw new Error(error.message);
  }

  return data as SavingsContribution;
}
