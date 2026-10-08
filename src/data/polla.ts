import { supabase } from '../lib/supabase';
import type { PollaActivity, PollaPrize } from '../lib/types';
import { fetchAllPages } from './pagination';

export async function listPollaActivities(cycleId: string): Promise<PollaActivity[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('polla_activities')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('period_month', { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as PollaActivity[];
  });
}

export async function listPollaPrizes(cycleId: string): Promise<PollaPrize[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('polla_prizes')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as PollaPrize[];
  });
}

export async function createPollaActivity(input: {
  workspaceId: string;
  cycleId: string;
  year: number;
  month: number;
  name: string;
}) {
  const { error } = await supabase.from('polla_activities').insert({
    workspace_id: input.workspaceId,
    cycle_id: input.cycleId,
    period_year: input.year,
    period_month: input.month,
    name: input.name
  });
  if (error) throw new Error(error.message);
}

export async function registerPollaContribution(input: {
  activityId: string;
  cycleMemberId: string;
  amount: string;
  paidDate: string;
  idempotencyKey: string;
}) {
  const { error } = await supabase.rpc('register_polla_contribution', {
    p_activity_id: input.activityId,
    p_cycle_member_id: input.cycleMemberId,
    p_idempotency_key: input.idempotencyKey,
    p_amount: input.amount,
    p_paid_date: input.paidDate
  });
  if (error) throw new Error(error.message);
}

export async function awardPollaPrize(input: {
  activityId: string;
  winnerCycleMemberId: string;
  grossAmount: string;
  awardedAt: string;
  idempotencyKey: string;
}) {
  const { data, error } = await supabase.rpc('award_polla_prize', {
    p_activity_id: input.activityId,
    p_winner_cycle_member_id: input.winnerCycleMemberId,
    p_idempotency_key: input.idempotencyKey,
    p_gross_amount: input.grossAmount,
    p_awarded_at: input.awardedAt
  });
  if (error) throw new Error(error.message);
  return data as PollaPrize;
}

export async function payPollaPrize(prizeId: string, paidDate: string, idempotencyKey: string) {
  const { error } = await supabase.rpc('pay_polla_prize', {
    p_prize_id: prizeId,
    p_idempotency_key: idempotencyKey,
    p_paid_date: paidDate
  });
  if (error) throw new Error(error.message);
}
