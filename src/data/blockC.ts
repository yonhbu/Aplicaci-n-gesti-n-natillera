import { supabase } from '../lib/supabase';
import type {
  BankAccount,
  BankReconciliation,
  BankYieldDistribution,
  LoanProfitDistribution,
  LoanProfitDistributionAllocation,
  LoanProfitDistributionPayment,
  LoanProfitDistributionPolicy,
  MemberSettlement,
  MemberSettlementPayment
} from '../lib/types';
import { fetchAllPages } from './pagination';

export type LiquidityLocation = 'bank' | 'cash';

export interface SettlementPreview {
  completion_received?: number;
  completion_items?: { operation_id: string; amount: number; effective_date: string; reference: string }[];
  cycle_member_id?: string;
  cut_date?: string;
  fee_policy?: string;
  debt_items?: { loan_id: string; principal_amount: number; interest_amount: number }[];
  prize_items?: { prize_id: string; net_amount: number; awarded_at: string }[];
  credit_items?: { credit_id: string; source_type: string; amount: number; effective_date: string }[];
  preview_hash: string;
  capital: number;
  recognized_yield_unrounded: number;
  recognized_yield: number;
  pending_net_prizes: number;
  capital_credits?: number;
  loan_profit_frozen?: number;
  bank_yield_fund?: number;
  yield_policy?: string;
  principal_debt: number;
  p013_first_month_interest: number;
  debts: number;
  annual_admin_fee: number;
  penalty: number;
  other_discounts: number;
  net: number;
  transfer_amount: number;
  rounding_adjustment: number;
}

export interface ProfitDistributionPreview {
  preview_hash: string;
  recognized_fund: number;
  costs: number;
  committed_yield: number;
  reserve: number;
  distributable: number;
  economic_deficit_before_floor: number;
  eligible_count: number;
  per_member: number;
  rounding_residual: number;
  liquidity_available: number;
  liquidity_deficit: number;
  policy_approved: boolean;
  confirmation_allowed: boolean;
}

export async function listBankAccounts(workspaceId: string): Promise<BankAccount[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('display_name', { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as BankAccount[];
  });
}

export async function listBankReconciliations(cycleId: string): Promise<BankReconciliation[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('bank_reconciliations')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as BankReconciliation[];
  });
}

export async function listMemberSettlements(cycleId: string): Promise<MemberSettlement[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('member_settlements')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as MemberSettlement[];
  });
}

export async function listMemberSettlementPayments(cycleId: string): Promise<MemberSettlementPayment[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('member_settlement_payments')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as MemberSettlementPayment[];
  });
}

export async function listLoanProfitDistributions(cycleId: string): Promise<LoanProfitDistribution[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('loan_profit_distributions')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanProfitDistribution[];
  });
}

export async function listLoanProfitDistributionPayments(cycleId: string): Promise<LoanProfitDistributionPayment[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('loan_profit_distribution_payments')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanProfitDistributionPayment[];
  });
}

export async function listLoanProfitDistributionPolicies(cycleId: string): Promise<LoanProfitDistributionPolicy[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('loan_profit_distribution_policies')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanProfitDistributionPolicy[];
  });
}

export async function listLoanProfitDistributionAllocations(cycleId: string): Promise<LoanProfitDistributionAllocation[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('loan_profit_distribution_allocations')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanProfitDistributionAllocation[];
  });
}

export async function createBankAccount(input: {
  cycleId: string;
  displayName: string;
  institutionName: string;
  maskedIdentifier: string;
}) {
  const { data, error } = await supabase.rpc('create_bank_account', {
    p_cycle_id: input.cycleId,
    p_display_name: input.displayName,
    p_institution_name: input.institutionName || null,
    p_masked_identifier: input.maskedIdentifier || null
  });
  if (error) throw new Error(error.message);
  return data as BankAccount;
}

export async function recordBankOpening(input: { cycleId: string; bankAccountId: string; idempotencyKey: string; effectiveDate: string; amount: string; reference: string }) {
  const { error } = await supabase.rpc('record_bank_opening', {
    p_cycle_id: input.cycleId,
    p_bank_account_id: input.bankAccountId,
    p_idempotency_key: input.idempotencyKey,
    p_effective_date: input.effectiveDate,
    p_amount: input.amount,
    p_reference: input.reference
  });
  if (error) throw new Error(error.message);
}

export async function recordBankExternalFinancing(input: { cycleId: string; bankAccountId: string; idempotencyKey: string; effectiveDate: string; amount: string; reference: string }) {
  const { error } = await supabase.rpc('record_bank_external_financing', {
    p_cycle_id: input.cycleId,
    p_bank_account_id: input.bankAccountId,
    p_idempotency_key: input.idempotencyKey,
    p_effective_date: input.effectiveDate,
    p_amount: input.amount,
    p_reference: input.reference
  });
  if (error) throw new Error(error.message);
}

export async function recordBankInterest(input: { cycleId: string; bankAccountId: string; idempotencyKey: string; effectiveDate: string; grossAmount: string; withholdingAmount: string; feeAmount: string; reference: string }) {
  const { error } = await supabase.rpc('record_bank_interest_received', {
    p_cycle_id: input.cycleId,
    p_bank_account_id: input.bankAccountId,
    p_idempotency_key: input.idempotencyKey,
    p_effective_date: input.effectiveDate,
    p_gross_amount: input.grossAmount,
    p_withholding_amount: input.withholdingAmount,
    p_fee_amount: input.feeAmount,
    p_reference: input.reference
  });
  if (error) throw new Error(error.message);
}

export async function recordBankFee(input: { cycleId: string; bankAccountId: string; idempotencyKey: string; effectiveDate: string; amount: string; reference: string }) {
  const { error } = await supabase.rpc('record_bank_fee', {
    p_cycle_id: input.cycleId,
    p_bank_account_id: input.bankAccountId,
    p_idempotency_key: input.idempotencyKey,
    p_effective_date: input.effectiveDate,
    p_amount: input.amount,
    p_reference: input.reference
  });
  if (error) throw new Error(error.message);
}

export async function recordLiquidityTransfer(input: { cycleId: string; idempotencyKey: string; effectiveDate: string; fromLocation: LiquidityLocation; fromBankAccountId: string | null; toLocation: LiquidityLocation; toBankAccountId: string | null; amount: string; reference: string }) {
  const { error } = await supabase.rpc('record_internal_liquidity_transfer', {
    p_cycle_id: input.cycleId,
    p_idempotency_key: input.idempotencyKey,
    p_effective_date: input.effectiveDate,
    p_from_location: input.fromLocation,
    p_from_bank_account_id: input.fromBankAccountId,
    p_to_location: input.toLocation,
    p_to_bank_account_id: input.toBankAccountId,
    p_amount: input.amount,
    p_reference: input.reference
  });
  if (error) throw new Error(error.message);
}

export async function createBankReconciliation(input: { cycleId: string; bankAccountId: string; openingVerifiedBalance: string; openingDate: string; externalBalance: string; asOfDate: string; reference: string }) {
  const { data, error } = await supabase.rpc('create_bank_reconciliation', {
    p_cycle_id: input.cycleId,
    p_bank_account_id: input.bankAccountId,
    p_opening_verified_balance: input.openingVerifiedBalance,
    p_opening_date: input.openingDate,
    p_external_balance: input.externalBalance,
    p_as_of_date: input.asOfDate,
    p_reference: input.reference
  });
  if (error) throw new Error(error.message);
  return data as BankReconciliation;
}

export async function setLoanSettlementAgreement(loanId: string, agreementCode: 'P013_FIRST_MONTH' | null) {
  const { error } = await supabase.rpc('set_loan_settlement_agreement', {
    p_loan_id: loanId,
    p_agreement_code: agreementCode
  });
  if (error) throw new Error(error.message);
}

export async function previewMemberSettlement(input: { cycleMemberId: string; cutDate: string; annualAdminFee: string; penaltyAmount: string; otherDiscounts: string }) {
  const { data, error } = await supabase.rpc('preview_member_settlement', {
    p_cycle_member_id: input.cycleMemberId,
    p_cut_date: input.cutDate,
    p_annual_admin_fee: input.annualAdminFee,
    p_penalty_amount: input.penaltyAmount,
    p_other_discounts: input.otherDiscounts
  });
  if (error) throw new Error(error.message);
  return data as SettlementPreview;
}

export async function confirmMemberSettlement(input: { cycleMemberId: string; idempotencyKey: string; cutDate: string; annualAdminFee: string; penaltyAmount: string; otherDiscounts: string; previewHash: string }) {
  const { data, error } = await supabase.rpc('confirm_member_settlement', {
    p_cycle_member_id: input.cycleMemberId,
    p_idempotency_key: input.idempotencyKey,
    p_cut_date: input.cutDate,
    p_annual_admin_fee: input.annualAdminFee,
    p_penalty_amount: input.penaltyAmount,
    p_other_discounts: input.otherDiscounts,
    p_preview_hash: input.previewHash
  });
  if (error) throw new Error(error.message);
  return data as MemberSettlement;
}

export async function payMemberSettlement(input: { settlementId: string; idempotencyKey: string; paidDate: string; liquidityLocation: LiquidityLocation; bankAccountId: string | null; reference: string }) {
  const { error } = await supabase.rpc('pay_member_settlement', {
    p_settlement_id: input.settlementId,
    p_idempotency_key: input.idempotencyKey,
    p_paid_date: input.paidDate,
    p_liquidity_location: input.liquidityLocation,
    p_bank_account_id: input.bankAccountId,
    p_reference: input.reference
  });
  if (error) throw new Error(error.message);
}

export async function previewLoanProfitDistribution(input: { cycleId: string; cutDate: string; policyVersion: string; costsAmount: string; committedYieldAmount: string; reserveAmount: string }) {
  const { data, error } = await supabase.rpc('preview_loan_profit_distribution', {
    p_cycle_id: input.cycleId,
    p_cut_date: input.cutDate,
    p_policy_version: input.policyVersion,
    p_costs_amount: input.costsAmount,
    p_committed_yield_amount: input.committedYieldAmount,
    p_reserve_amount: input.reserveAmount
  });
  if (error) throw new Error(error.message);
  return data as ProfitDistributionPreview;
}

export async function createLoanProfitDistributionPolicy(input: { cycleId: string; policyVersion: string; description: string }) {
  const { error } = await supabase.rpc('create_loan_profit_distribution_policy', {
    p_cycle_id: input.cycleId,
    p_policy_version: input.policyVersion,
    p_description: input.description
  });
  if (error) throw new Error(error.message);
}

export async function confirmLoanProfitDistribution(input: { cycleId: string; idempotencyKey: string; cutDate: string; policyVersion: string; costsAmount: string; committedYieldAmount: string; reserveAmount: string; previewHash: string }) {
  const { data, error } = await supabase.rpc('confirm_loan_profit_distribution', {
    p_cycle_id: input.cycleId,
    p_idempotency_key: input.idempotencyKey,
    p_cut_date: input.cutDate,
    p_policy_version: input.policyVersion,
    p_costs_amount: input.costsAmount,
    p_committed_yield_amount: input.committedYieldAmount,
    p_reserve_amount: input.reserveAmount,
    p_preview_hash: input.previewHash
  });
  if (error) throw new Error(error.message);
  return data as LoanProfitDistribution;
}

export async function payLoanProfitDistribution(input: { distributionId: string; idempotencyKey: string; paidDate: string; liquidityLocation: LiquidityLocation; bankAccountId: string | null; reference: string }) {
  const { error } = await supabase.rpc('pay_loan_profit_distribution', {
    p_distribution_id: input.distributionId,
    p_idempotency_key: input.idempotencyKey,
    p_paid_date: input.paidDate,
    p_liquidity_location: input.liquidityLocation,
    p_bank_account_id: input.bankAccountId,
    p_reference: input.reference
  });
  if (error) throw new Error(error.message);
}

export async function locateUnknownLiquidity(input: { cycleId: string; idempotencyKey: string; effectiveDate: string; toLocation: LiquidityLocation; toBankAccountId: string | null; amount: string; reference: string }) {
  const { error } = await supabase.rpc('locate_unknown_liquidity', {
    p_cycle_id: input.cycleId,
    p_idempotency_key: input.idempotencyKey,
    p_effective_date: input.effectiveDate,
    p_to_location: input.toLocation,
    p_to_bank_account_id: input.toBankAccountId,
    p_amount: input.amount,
    p_reference: input.reference
  });
  if (error) throw new Error(error.message);
}

export interface BankYieldPreview {
  preview_hash: string;
  cut_date: string;
  net_received: number;
  savers_settled_yield: number;
  savers_projected_yield: number;
  savers_reserved: number;
  already_distributed: number;
  pool: number;
  beneficiary_count: number;
  per_member: number;
  residual_to_admin: number;
  shortfall: number;
  confirmation_allowed: boolean;
  beneficiaries: { cycle_member_id: string; member_id: string; display_name: string; amount: number }[];
  recognized_in_withdrawals?: number;
  unassigned?: number;
  unresolved_members?: number;
  unresolved_receipts?: number;
  rights_mismatch?: number;
  per_member_max?: number;
}

export async function previewBankYieldDistribution(cycleId: string, cutDate: string) {
  const { data, error } = await supabase.rpc('preview_bank_yield_distribution', { p_cycle_id: cycleId, p_cut_date: cutDate });
  if (error) throw new Error(error.message);
  return data as BankYieldPreview;
}

export async function confirmBankYieldDistribution(input: { cycleId: string; cutDate: string; idempotencyKey: string; previewHash: string }) {
  const { error } = await supabase.rpc('confirm_bank_yield_distribution', {
    p_cycle_id: input.cycleId,
    p_cut_date: input.cutDate,
    p_idempotency_key: input.idempotencyKey,
    p_preview_hash: input.previewHash
  });
  if (error) throw new Error(error.message);
}

export async function listBankYieldDistributions(cycleId: string): Promise<BankYieldDistribution[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase.from('bank_yield_distributions').select('*').eq('cycle_id', cycleId)
      .order('cut_date', { ascending: false }).order('id', { ascending: false }).range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as BankYieldDistribution[];
  });
}

export interface AdminWithdrawalPreview {
  admin_balance: number;
  ea_reserve: number;
  available: number;
  needs_review: boolean;
  reserve_through: string;
}

export async function previewAdminWithdrawal(cycleId: string, effectiveDate: string): Promise<AdminWithdrawalPreview> {
  const { data, error } = await supabase.rpc('preview_admin_withdrawal', { p_cycle_id: cycleId, p_effective_date: effectiveDate });
  if (error) throw new Error(error.message);
  return data;
}

export async function withdrawAdminFund(input: { cycleId: string; idempotencyKey: string; effectiveDate: string; amount: string; description: string; liquidityLocation: LiquidityLocation; bankAccountId: string | null }) {
  const { error } = await supabase.rpc('withdraw_admin_payable', {
    p_cycle_id: input.cycleId,
    p_idempotency_key: input.idempotencyKey,
    p_effective_date: input.effectiveDate,
    p_amount: input.amount,
    p_description: input.description,
    p_liquidity_location: input.liquidityLocation,
    p_bank_account_id: input.bankAccountId
  });
  if (error) throw new Error(error.message);
}

export interface FinRulesChecks {
  close_date_ok: boolean;
  incompatible_modes: number;
  retired_without_settlement: number;
  settlements_without_bank_share: number;
  polla_over_quota: number;
  confirmed_bank_distributions: number;
}

export async function getFinRulesActivationChecks(cycleId: string) {
  const { data, error } = await supabase.rpc('fin_rules_activation_checks', { p_cycle_id: cycleId });
  if (error) throw new Error(error.message);
  return data as FinRulesChecks;
}

export async function activateFinRules2026(cycleId: string) {
  const { error } = await supabase.rpc('activate_fin_rules_2026', { p_cycle_id: cycleId });
  if (error) throw new Error(error.message);
}

export async function fixCycleCloseDate(cycleId: string, closesOn: string) {
  const { error } = await supabase.rpc('fix_cycle_close_date', { p_cycle_id: cycleId, p_closes_on: closesOn });
  if (error) throw new Error(error.message);
}

export interface LoanProfitPeriodsPreview {
  preview_hash: string;
  cut_date: string;
  fund_total: number;
  ea_obligation: number;
  ea_reserved_chronological: number;
  ea_after_last_collection: number;
  shortfall: number;
  admin_available?: number;
  admin_cover?: number;
  remaining_shortfall?: number;
  unverified_fund_sources?: number;
  no_beneficiary: number;
  frozen_total: number;
  active_total: number;
  collective_total: number;
  unresolved_settlements: number;
  previous_distributions: number;
  confirmation_allowed: boolean;
  beneficiaries: { cycle_member_id: string; member_id: string; display_name: string; share: number; amount: number; frozen_at_withdrawal: boolean }[];
}

export interface LoanProfitPeriodDistribution {
  id: string;
  cycle_id: string;
  cut_date: string;
  status: 'confirmed' | 'paid' | 'reversed';
  fund_total: string;
  ea_obligation: string;
  collective_total: string;
  paid_date: string | null;
  snapshot: LoanProfitPeriodsPreview;
}

export async function previewLoanProfitPeriods(cycleId: string, cutDate: string) {
  const { data, error } = await supabase.rpc('preview_loan_profit_periods', { p_cycle_id: cycleId, p_cut_date: cutDate });
  if (error) throw new Error(error.message);
  return data as LoanProfitPeriodsPreview;
}

export async function confirmLoanProfitPeriods(input: { cycleId: string; cutDate: string; idempotencyKey: string; previewHash: string }) {
  const { error } = await supabase.rpc('confirm_loan_profit_periods', { p_cycle_id: input.cycleId, p_cut_date: input.cutDate, p_idempotency_key: input.idempotencyKey, p_preview_hash: input.previewHash });
  if (error) throw new Error(error.message);
}

export async function payLoanProfitPeriods(input: { distributionId: string; idempotencyKey: string; paidDate: string; liquidityLocation: LiquidityLocation; bankAccountId: string | null; reference: string }) {
  const { error } = await supabase.rpc('pay_loan_profit_periods', { p_distribution_id: input.distributionId, p_idempotency_key: input.idempotencyKey, p_paid_date: input.paidDate, p_liquidity_location: input.liquidityLocation, p_bank_account_id: input.bankAccountId, p_reference: input.reference });
  if (error) throw new Error(error.message);
}

export async function listLoanProfitPeriodDistributions(cycleId: string): Promise<LoanProfitPeriodDistribution[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase.from('loan_profit_period_distributions').select('*').eq('cycle_id', cycleId)
      .order('created_at', { ascending: false }).order('id', { ascending: false }).range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanProfitPeriodDistribution[];
  });
}

export interface LoanProfitPeriodAllocation {
  id: string;
  distribution_id: string;
  cycle_member_id: string;
  member_id: string;
  amount: string;
  frozen_at_withdrawal: boolean;
  paid_operation_id: string | null;
  paid_date: string | null;
  paid_reference: string | null;
}

export async function listLoanProfitPeriodAllocations(distributionId: string): Promise<LoanProfitPeriodAllocation[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase.from('loan_profit_period_allocations').select('*').eq('distribution_id', distributionId)
      .order('id', { ascending: true }).range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanProfitPeriodAllocation[];
  });
}

export async function payLoanProfitAllocation(input: { allocationId: string; idempotencyKey: string; paidDate: string; liquidityLocation: LiquidityLocation; bankAccountId: string | null; reference: string }) {
  const { error } = await supabase.rpc('pay_loan_profit_allocation', { p_allocation_id: input.allocationId, p_idempotency_key: input.idempotencyKey, p_paid_date: input.paidDate, p_liquidity_location: input.liquidityLocation, p_bank_account_id: input.bankAccountId, p_reference: input.reference });
  if (error) throw new Error(error.message);
}

// FIN-08: colecciones financieras nuevas para el respaldo.
export async function fetchFinBackupExtensions(cycleId: string) {
  const pick = async (table: string) => {
    const { data, error } = await supabase.from(table).select('*').eq('cycle_id', cycleId);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data ?? [];
  };
  return {
    memberCapitalCredits: await pick('member_capital_credits'),
    bankYieldDistributions: await pick('bank_yield_distributions'),
    loanProfitPeriodDistributions: await pick('loan_profit_period_distributions'),
    loanProfitPeriodAllocations: await pick('loan_profit_period_allocations'),
    finRulesActivations: await pick('fin_rules_activations')
  };
}

export async function reverseLoanProfitPeriods(distributionId: string, idempotencyKey: string, reason: string) {
  const { error } = await supabase.rpc('reverse_loan_profit_periods', { p_distribution_id: distributionId, p_idempotency_key: idempotencyKey, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function reverseBankYieldDistribution(distributionId: string, idempotencyKey: string, reason: string) {
  const { error } = await supabase.rpc('reverse_bank_yield_distribution', { p_distribution_id: distributionId, p_idempotency_key: idempotencyKey, p_reason: reason });
  if (error) throw new Error(error.message);
}

export async function getServerCivilToday(): Promise<string> {
  const { data, error } = await supabase.rpc('fin_civil_today');
  if (error) throw new Error(error.message);
  return data as string;
}
