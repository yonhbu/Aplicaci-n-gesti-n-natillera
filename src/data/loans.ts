import { supabase } from '../lib/supabase';
import type { LoanContract, LoanPayment, LoanSchedule } from '../lib/types';
import { fetchAllPages } from './pagination';

export async function listLoans(cycleId: string): Promise<LoanContract[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('loan_contracts')
      .select('*, borrower:members!loan_contracts_workspace_id_borrower_member_id_fkey(*)')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanContract[];
  });
}

export async function listLoanPayments(cycleId: string): Promise<LoanPayment[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('loan_payments')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanPayment[];
  });
}

export async function listLoanSchedules(cycleId: string): Promise<LoanSchedule[]> {
  return fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('loan_schedules')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('loan_id', { ascending: true })
      .order('installment_number', { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanSchedule[];
  });
}

export async function createLoanContract(input: {
  cycleId: string;
  borrowerMemberId: string | null;
  externalBorrowerName: string | null;
  principal: string;
  method: string;
  rateUnit: string;
  rateValue: string;
  termMonths: number;
  startDate: string;
  idempotencyKey: string;
}) {
  const { data, error } = await supabase.rpc('create_loan_contract', {
    p_cycle_id: input.cycleId,
    p_idempotency_key: input.idempotencyKey,
    p_borrower_member_id: input.borrowerMemberId,
    p_external_borrower_name: input.externalBorrowerName,
    p_referred_by_member_id: null,
    p_principal: input.principal,
    p_method: input.method,
    p_rate_unit: input.rateUnit,
    p_rate_value: input.rateValue,
    p_term_months: input.termMonths,
    p_start_date: input.startDate
  });
  if (error) throw new Error(error.message);
  return data as LoanContract;
}

export async function confirmLoanDisbursement(loanId: string, date: string, idempotencyKey: string) {
  const { data, error } = await supabase.rpc('confirm_loan_disbursement', {
    p_loan_id: loanId,
    p_idempotency_key: idempotencyKey,
    p_disbursed_date: date
  });
  if (error) throw new Error(error.message);
  return data as LoanContract;
}

export async function recordLoanPayment(input: {
  loanId: string;
  idempotencyKey: string;
  paymentDate: string;
  amount: string;
  capitalAmount: string;
  interestAmount: string;
  kind: 'regular' | 'prepayment';
}) {
  const { data, error } = await supabase.rpc('record_loan_payment', {
    p_loan_id: input.loanId,
    p_idempotency_key: input.idempotencyKey,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_capital_amount: input.capitalAmount,
    p_interest_amount: input.interestAmount,
    p_kind: input.kind
  });
  if (error) throw new Error(error.message);
  return data as LoanPayment;
}

export interface LoanPrepaymentQuote {
  loan_id: string;
  quote_date: string;
  principal_due: number;
  interest_due: number;
  total_due: number;
  rule_version: string;
}

export async function quoteLoanPrepayment(loanId: string, quoteDate: string): Promise<LoanPrepaymentQuote> {
  const { data, error } = await supabase.rpc('quote_loan_prepayment', {
    p_loan_id: loanId,
    p_quote_date: quoteDate
  });
  if (error) throw new Error(error.message);
  return data as LoanPrepaymentQuote;
}

export async function confirmLoanPrepayment(loanId: string, date: string, idempotencyKey: string) {
  const { data, error } = await supabase.rpc('confirm_loan_prepayment', {
    p_loan_id: loanId,
    p_idempotency_key: idempotencyKey,
    p_payment_date: date
  });
  if (error) throw new Error(error.message);
  return data as LoanPayment;
}
