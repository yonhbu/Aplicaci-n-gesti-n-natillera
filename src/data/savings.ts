import { supabase } from '../lib/supabase';
import type { SavingsContribution } from '../lib/types';

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
  const { data, error } = await supabase
    .from('savings_contributions')
    .select('*')
    .eq('cycle_id', cycleId)
    .order('created_at', { ascending: false })
    .limit(5000);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as SavingsContribution[];
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
