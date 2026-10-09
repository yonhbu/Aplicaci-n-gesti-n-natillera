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
  notes: string | null;
  member?: Member;
}

export interface SavingsContribution {
  id: string;
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
  source: 'manual' | 'legacy_prevalidation';
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
}

export interface LoanContract {
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
  cancelled_at: string | null;
  disbursed_operation_id: string | null;
  borrower?: Member | null;
}

export interface LoanSchedule {
  id: string;
  loan_id: string;
  installment_number: number;
  due_date: string;
  principal_due: string;
  interest_due: string;
  status: 'projected' | 'paid' | 'cancelled';
}

export interface LoanPayment {
  id: string;
  loan_id: string;
  payment_date: string;
  amount: string;
  capital_amount: string;
  interest_amount: string;
  kind: 'regular' | 'prepayment';
  status: 'posted' | 'reversed';
}

export interface PollaActivity {
  id: string;
  workspace_id: string;
  cycle_id: string;
  period_year: number;
  period_month: number;
  name: string;
  status: 'open' | 'awarded' | 'closed';
}

export interface PollaContribution {
  id: string;
  workspace_id: string;
  cycle_id: string;
  activity_id: string;
  cycle_member_id: string;
  amount: string;
  paid_date: string;
  status: 'posted' | 'reversed';
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
  awarded_at: string;
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
}
