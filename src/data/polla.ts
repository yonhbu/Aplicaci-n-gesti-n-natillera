import { supabase } from '../lib/supabase';
import type { PollaActivity, PollaContribution, PollaPrize } from '../lib/types';
import { fetchAllPages } from './pagination';

export async function listPollaActivities(cycleId: string): Promise<PollaActivity[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('polla_activities')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('period_month', { ascending: true })
      .order('id', { ascending: true })
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
      .order('id', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as PollaPrize[];
  });
}

export async function listPollaContributions(cycleId: string): Promise<PollaContribution[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('polla_contributions')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as PollaContribution[];
  });
}

export async function createPollaActivity(input: {
  cycleId: string;
  year: number;
  month: number;
  name: string;
}) {
  const { data, error } = await supabase.rpc('create_polla_activity', {
    p_cycle_id: input.cycleId,
    p_period_year: input.year,
    p_period_month: input.month,
    p_name: input.name
  });
  if (error) throw new Error(error.message);
  return data as PollaActivity;
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
