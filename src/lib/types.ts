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
