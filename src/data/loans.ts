import { supabase } from '../lib/supabase';
import type { LoanContract, LoanPayment, LoanPaymentApplication, LoanSchedule, LoanSettlementEffect } from '../lib/types';
import { fetchAllPages } from './pagination';

export async function listLoans(cycleId: string): Promise<LoanContract[]> {
  const loans = await fetchAllPages(async (from, to) => {
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
  const effects = await fetchAllPages(async (from,to) => {
    const {data,error} = await supabase.from('loan_settlement_effects').select('*').eq('cycle_id',cycleId).order('id').range(from,to);
    if(error)throw new Error(error.message);
    return (data??[]) as LoanSettlementEffect[];
  });
  return loans.map(loan=>({...loan,settlement_applications:effects.filter(effect=>effect.loan_id===loan.id)}));
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
  const schedules = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabase
      .from('loan_schedule_progress')
      .select('*')
      .eq('cycle_id', cycleId)
      .order('loan_id', { ascending: true })
      .order('installment_number', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanSchedule[];
  });
  // The progress view aggregates only currently posted receipts. Preserve raw
  // applications so a historical cut can also include a later reversed receipt.
  const applications = await fetchAllPages(async (from, to) => {
    const { data, error } = await supabase.from('loan_payment_applications').select('*')
      .eq('cycle_id', cycleId).order('id', { ascending: true }).range(from, to);
    if (error) throw new Error(error.message);
    return (data ?? []) as LoanPaymentApplication[];
  });
  const bySchedule = new Map<string, LoanPaymentApplication[]>();
  for (const application of applications) {
    if (!application.schedule_id) continue;
    const rows = bySchedule.get(application.schedule_id) ?? [];
    rows.push(application); bySchedule.set(application.schedule_id, rows);
  }
  return schedules.map(schedule => ({ ...schedule, payment_applications: bySchedule.get(schedule.id) ?? [] }));
}

export async function createLoanContract(input: {
  cycleId: string;
  borrowerMemberId: string | null;
  externalBorrowerName: string | null;
  referredByMemberId: string | null;
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
    p_referred_by_member_id: input.referredByMemberId,
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
  bankAccountId?: string | null;
  note?: string | null;
}) {
  const { data, error } = await supabase.rpc(input.note !== undefined ? 'record_noted_loan_payment' : input.bankAccountId === undefined ? 'record_loan_payment' : 'record_located_loan_payment', {
    p_loan_id: input.loanId,
    p_idempotency_key: input.idempotencyKey,
    p_payment_date: input.paymentDate,
    p_amount: input.amount,
    p_capital_amount: input.capitalAmount,
    p_interest_amount: input.interestAmount,
    p_kind: input.kind,
    ...(input.bankAccountId === undefined && input.note === undefined ? {} : { p_bank_account_id: input.bankAccountId ?? null, p_quote_hash: null }),
    ...(input.note === undefined ? {} : { p_note: input.note })
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
  interest_covered_until?: string | null;
  quote_hash: string;
}

export async function quoteLoanPayment(loanId: string, paymentDate: string, amount: string): Promise<{ capital_amount: number; interest_amount: number }> {
  const { data, error } = await supabase.rpc('quote_loan_payment', { p_loan_id: loanId, p_payment_date: paymentDate, p_amount: amount });
  if (error) throw new Error(error.message);
  return data;
}

export async function quoteLoanPrepayment(loanId: string, quoteDate: string): Promise<LoanPrepaymentQuote> {
  const { data, error } = await supabase.rpc('quote_loan_prepayment', {
    p_loan_id: loanId,
    p_quote_date: quoteDate
  });
  if (error) throw new Error(error.message);
  return data as LoanPrepaymentQuote;
}

export async function confirmLoanPrepayment(loanId: string, date: string, idempotencyKey: string, quoteHash: string, bankAccountId?: string | null, note?: string | null) {
  const { data, error } = await supabase.rpc(note !== undefined ? 'confirm_noted_loan_prepayment' : bankAccountId === undefined ? 'confirm_loan_prepayment' : 'record_located_loan_payment', {
    p_loan_id: loanId,
    p_idempotency_key: idempotencyKey,
    p_payment_date: date,
    p_quote_hash: quoteHash,
    ...(note !== undefined ? { p_bank_account_id: bankAccountId ?? null, p_note: note } : bankAccountId === undefined ? {} : { p_bank_account_id: bankAccountId, p_amount: null, p_capital_amount: null, p_interest_amount: null, p_kind: 'prepayment' })
  });
  if (error) throw new Error(error.message);
  return data as LoanPayment;
}
