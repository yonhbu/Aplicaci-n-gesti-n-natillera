import { supabase } from '../lib/supabase';
export async function recordSettlementCompletion(input: { cycleMemberId: string; key: string; receivedDate: string; amount: string; bankId: string | null; reference: string; cutDate: string; annualAdminFee: string; penaltyAmount: string; otherDiscounts: string; previewHash: string }) {
  const { data, error } = await supabase.rpc('record_settlement_completion', {
    p_cycle_member_id: input.cycleMemberId, p_idempotency_key: input.key, p_received_date: input.receivedDate,
    p_amount: input.amount, p_bank_account_id: input.bankId, p_reference: input.reference,
    p_cut_date: input.cutDate, p_annual_admin_fee: input.annualAdminFee, p_penalty_amount: input.penaltyAmount,
    p_other_discounts: input.otherDiscounts, p_preview_hash: input.previewHash
  });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}
export async function correctCashLoanLocation(operationId: string, bankId: string, key: string, reason: string) {
  const { data, error } = await supabase.rpc('correct_cash_loan_location', { p_operation_id: operationId, p_bank_account_id: bankId, p_idempotency_key: key, p_reason: reason });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}
export async function annulCashLoanLocation(operationId: string, key: string, reason: string) {
  const { data, error } = await supabase.rpc('annul_cash_loan_location', { p_operation_id: operationId, p_idempotency_key: key, p_reason: reason });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}
export interface StatementComparison {
  state: 'empty' | 'recorded';
  check?: { statement_date: string; statement_balance: string; note: string; bank_account_id: string };
  account_name?: string;
  available?: string;
  account_balance?: string;
  physical_cash?: string;
  other_banks?: string;
  unknown?: string;
  difference?: string;
}
export async function statementComparison(cycleId: string, bankId: string | null = null): Promise<StatementComparison> {
  const { data, error } = await supabase.rpc('preview_bank_statement_check', { p_cycle_id: cycleId, p_bank_account_id: bankId });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as StatementComparison;
}
export async function recordStatement(input: { cycleId: string; bankId: string; key: string; date: string; amount: string; note: string }) {
  const { data, error } = await supabase.rpc('record_bank_statement_check', { p_cycle_id: input.cycleId, p_bank_account_id: input.bankId, p_idempotency_key: input.key, p_statement_date: input.date, p_statement_balance: input.amount, p_note: input.note });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}
export async function recordFine(input: { cycleId: string; bankId: string; key: string; date: string; amount: string; note: string }) {
  const { data, error } = await supabase.rpc('record_admin_fine', { p_cycle_id: input.cycleId, p_idempotency_key: input.key, p_effective_date: input.date, p_amount: input.amount, p_description: input.note, p_liquidity_location: 'bank', p_bank_account_id: input.bankId });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}
export async function previewReconciliation(cycleId: string) {
  const { data, error } = await supabase.rpc('preview_legacy_reconciliation', { p_cycle_id: cycleId });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data as { state: string; preview_hash?: string; operations?: { part: string; type: string; date: string; payload: Record<string, unknown> }[]; historic_interest?: string; net_cash_correction?: string; fines?: string; before?: { account: string; liquidity_location: string; bank_account_id: string | null; amount: string }[]; after?: { account: string; liquidity_location: string; bank_account_id: string | null; amount: string }[] };
}
export async function confirmReconciliation(cycleId: string, key: string, hash: string) {
  const { data, error } = await supabase.rpc('confirm_legacy_reconciliation', { p_cycle_id: cycleId, p_idempotency_key: key, p_preview_hash: hash });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}
export async function reverseReconciliation(cycleId: string, key: string, reason: string) {
  const { data, error } = await supabase.rpc('reverse_legacy_reconciliation', { p_cycle_id: cycleId, p_idempotency_key: key, p_reason: reason });
  if (error) throw Object.assign(new Error(error.message), { code: error.code });
  return data;
}
