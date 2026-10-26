export interface Workspace {
  id: string;
  name: string;
}

export interface Cycle {
  id: string;
  workspace_id: string;
  year: number;
  name: string;
  starts_on: string;
  closes_on: string;
  status: 'active' | 'closed' | 'archived';
  settlement_rules_version?: string | null;
}

export interface Member {
  id: string;
  workspace_id: string;
  display_name: string;
  legacy_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface CycleMember {
  id: string;
  workspace_id: string;
  cycle_id: string;
  member_id: string;
  monthly_quota: string;
  participation_start_month: number;
  participation_end_month: number;
  savings_status: 'active' | 'withdrawn' | 'inactive';
  participates_in_savings: boolean;
  participates_in_polla: boolean;
  participates_in_loan_profit: boolean;
  economic_mode?: 'collective' | 'fixed_yield' | null;
  notes: string | null;
  member?: Member;
}

export interface SavingsContribution {
  id: string;
  status?: 'posted' | 'reversed';
  workspace_id: string;
  cycle_id: string;
  member_id: string;
  cycle_member_id: string;
  idempotency_key: string;
  amount: string;
  effective_date: string;
  applied_year: number;
  applied_month: number;
  method: 'cash' | 'bank_transfer' | 'bank_deposit' | 'other';
  source: 'manual' | 'legacy_prevalidation' | 'legacy_migration_trial' | 'legacy_operational_import';
  actor_user_id: string;
  created_at: string;
}

export interface WorkspaceContext {
  workspace: Workspace | null;
  activeCycle: Cycle | null;
}

export interface FinancialOperation {
  id: string;
  workspace_id: string;
  cycle_id: string;
  idempotency_key: string;
  operation_type: string;
  effective_date: string;
  reference_table: string | null;
  reference_id: string | null;
  payload: Record<string, unknown>;
  reverses_operation_id: string | null;
  created_at: string;
}

export interface LedgerEntry {
  id: string;
  operation_id: string;
  workspace_id: string;
  cycle_id: string;
  account: string;
  amount: string;
  liquidity_location: 'unknown' | 'bank' | 'cash';
  bank_account_id: string | null;
  member_id?: string | null;
  loan_id?: string | null;
  polla_activity_id?: string | null;
  prize_id?: string | null;
}

export interface LoanContract {
  settlement_applications?: LoanSettlementEffect[];
  id: string;
  workspace_id: string;
  cycle_id: string;
  borrower_member_id: string | null;
  external_borrower_name: string | null;
  referred_by_member_id: string | null;
  principal: string;
  method: 'amortized' | 'fixed_interest' | 'interest_only';
  rate_unit: 'EA' | 'MONTHLY_FIXED';
  rate_value: string;
  term_months: number;
  start_date: string;
  status: 'draft' | 'active' | 'paid' | 'cancelled';
  scheduled_payment: string | null;
  prepayment_first_month_interest: string | null;
  settlement_agreement_code: 'P013_FIRST_MONTH' | null;
  cancelled_at: string | null;
  disbursed_operation_id: string | null;
  legacy_id: string | null;
  legacy_note: string | null;
  legacy_paid_capital_amount: string;
  legacy_paid_interest_amount: string;
  legacy_payment_state: 'none' | 'declared_paid_without_cash_dates';
  borrower?: Member | null;
}

export interface LoanSchedule {
  closed_by_settlement?: boolean;
  source_status?: 'projected' | 'paid' | 'cancelled';
  id: string;
  loan_id: string;
  installment_number: number;
  due_date: string;
  principal_due: string;
  interest_due: string;
  status: 'projected' | 'paid' | 'cancelled';
  legacy_source_key: string | null;
  legacy_declared_paid: boolean;
  principal_paid?: string;
  interest_paid?: string;
}

export interface LoanPayment {
  id: string;
  operation_id?: string;
  loan_id: string;
  payment_date: string;
  amount: string;
  capital_amount: string;
  interest_amount: string;
  kind: 'regular' | 'prepayment';
  status: 'posted' | 'reversed';
}

export interface LoanSettlementEffect {
  id: string;
  loan_id: string;
  settlement_id: string;
  principal_amount: string;
  interest_amount: string;
  effective_date: string;
  reversal_date: string | null;
}

export interface PollaActivity {
  id: string;
  workspace_id: string;
  cycle_id: string;
  period_year: number;
  period_month: number;
  name: string;
  status: 'open' | 'awarded' | 'closed';
  cancelled_at?: string | null;
}

export interface PollaContribution {
  id: string;
  operation_id?: string;
  workspace_id: string;
  cycle_id: string;
  activity_id: string;
  cycle_member_id: string | null;
  amount: string;
  paid_date: string;
  status: 'posted' | 'reversed';
  legacy_id: string | null;
  legacy_collective: boolean;
  legacy_participant_label: string | null;
}

export interface PollaPrize {
  id: string;
  workspace_id: string;
  cycle_id: string;
  activity_id: string;
  winner_cycle_member_id: string;
  gross_amount: string;
  admin_commission: string;
  net_amount: string;
  status: 'pending_payment' | 'paid' | 'settled' | 'reversed';
  awarded_at: string | null;
  legacy_id: string | null;
  legacy_month: number | null;
  legacy_type: string | null;
  legacy_game: string | null;
  legacy_payment_status: 'historical_payment_unverified' | 'pending_payment' | 'paid_verified';
}

export interface BankAccount {
  id: string;
  workspace_id: string;
  display_name: string;
  institution_name: string | null;
  masked_identifier: string | null;
  status: 'active' | 'archived';
}

export interface BankReconciliation {
  id: string;
  workspace_id: string;
  cycle_id: string;
  bank_account_id: string;
  as_of_date: string;
  opening_verified_balance: string;
  opening_date: string;
  external_balance: string;
  reconstructed_balance: string;
  difference_amount: string;
  status: 'open' | 'matched' | 'difference';
  reference: string | null;
}

export interface MemberSettlement {
  id: string;
  workspace_id: string;
  cycle_id: string;
  cycle_member_id: string;
  member_id: string;
  idempotency_key: string;
  cut_date: string;
  status: 'confirmed' | 'paid' | 'reversed';
  preview_hash: string;
  snapshot: Record<string, unknown>;
  net_amount: string;
  transfer_amount: string;
  rounding_adjustment: string;
  operation_id: string | null;
  paid_operation_id: string | null;
  paid_at: string | null;
}

export interface MemberSettlementPayment {
  id: string;
  workspace_id: string;
  cycle_id: string;
  settlement_id: string;
  amount: string;
  paid_date: string;
  liquidity_location: 'bank' | 'cash';
  bank_account_id: string | null;
  reference: string;
  status: 'posted' | 'reversed';
}

export interface LoanProfitDistribution {
  id: string;
  workspace_id: string;
  cycle_id: string;
  idempotency_key: string;
  cut_date: string;
  status: 'confirmed' | 'paid' | 'reversed';
  preview_hash: string;
  policy_version: string;
  snapshot: Record<string, unknown>;
  distributable_amount: string;
  payment_amount: string;
  operation_id: string | null;
  paid_operation_id: string | null;
}

export interface LoanProfitDistributionPayment {
  id: string;
  workspace_id: string;
  cycle_id: string;
  distribution_id: string;
  amount: string;
  paid_date: string;
  liquidity_location: 'bank' | 'cash';
  bank_account_id: string | null;
  reference: string;
  status: 'posted' | 'reversed';
}

export interface LoanProfitDistributionPolicy {
  id: string;
  workspace_id: string;
  cycle_id: string;
  policy_version: string;
  description: string;
  approved: boolean;
  created_by: string;
  created_at: string;
}

export interface LoanProfitDistributionAllocation {
  id: string;
  workspace_id: string;
  cycle_id: string;
  distribution_id: string;
  cycle_member_id: string;
  member_id: string;
  amount: string;
  status: 'pending_payment' | 'paid' | 'reversed';
  payment_id: string | null;
  paid_at: string | null;
  payment_reference: string | null;
  created_at: string;
}

export interface MemberCapitalCredit {
  reversed_at?: string | null;
  id: string;
  workspace_id: string;
  cycle_id: string;
  cycle_member_id: string;
  member_id: string;
  source_type: 'polla_prize' | 'bank_yield';
  prize_id: string | null;
  distribution_id: string | null;
  operation_id: string;
  amount: string;
  effective_date: string;
  created_at: string;
}

export interface BankYieldDistribution {
  id: string;
  workspace_id: string;
  cycle_id: string;
  operation_id: string | null;
  cut_date: string;
  net_received: string;
  savers_reserved: string;
  pool_amount: string;
  beneficiary_count: number;
  per_member_amount: string;
  residual_to_admin: string;
  status: 'confirmed' | 'reversed';
  created_at: string;
}
