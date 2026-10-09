import { supabase } from '../lib/supabase';
import type {
  BankAccount,
  BankReconciliation,
  LoanProfitDistribution,
  LoanProfitDistributionPayment,
  MemberSettlement,
  MemberSettlementPayment
} from '../lib/types';
import { fetchAllPages } from './pagination';

export type LiquidityLocation = 'bank' | 'cash';

export interface SettlementPreview {
  preview_hash: string;
  capital: number;
  recognized_yield_unrounded: number;
  recognized_yield: number;
  pending_net_prizes: number;
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
