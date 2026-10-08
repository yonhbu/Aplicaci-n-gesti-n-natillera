import { supabase } from '../lib/supabase';
import type { FinancialOperation, LedgerEntry } from '../lib/types';
import { fetchAllPages } from './pagination';

export async function listLedgerEntries(cycleId: string): Promise<LedgerEntry[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('ledger_entries')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LedgerEntry[];
  });
}

export async function listFinancialOperations(cycleId: string): Promise<FinancialOperation[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('financial_operations')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as FinancialOperation[];
  });
}
