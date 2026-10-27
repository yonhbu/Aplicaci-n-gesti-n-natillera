import Decimal from 'decimal.js';
import type {FinancialOperation,LoanContract,LoanPayment,LoanSchedule} from '../lib/types';

/** Recorded satisfaction only: consolidated capital, dated receipts and dated settlement applications. */
export function loanPosition(loan:LoanContract,payments:LoanPayment[],cut:string,operations:FinancialOperation[]=[]){
 const actual=payments.filter(p=>p.loan_id===loan.id&&p.payment_date<=cut&&(
  p.status!=='reversed'||operations.some(o=>o.reverses_operation_id===p.operation_id&&o.effective_date>cut))
  &&!operations.some(o=>o.reverses_operation_id===p.operation_id&&o.effective_date<=cut));
 const applications=(loan.settlement_applications??[]).filter(a=>a.effective_date<=cut&&(!a.reversal_date||a.reversal_date>cut));
 const settledCapital=applications.reduce((s,a)=>s.plus(a.principal_amount),new Decimal(0));
 const settledInterest=applications.reduce((s,a)=>s.plus(a.interest_amount),new Decimal(0));
 const receiptCapital=actual.reduce((s,p)=>s.plus(p.capital_amount),new Decimal(loan.legacy_paid_capital_amount??0));
 const pendingPrincipal=new Decimal(loan.principal).minus(receiptCapital).minus(settledCapital);
 const settled=settledCapital.gt(0)&&pendingPrincipal.isZero();
 const futureSatisfaction=loan.status==='paid'&&pendingPrincipal.gt(0)&&(
  (loan.settlement_applications??[]).some(a=>a.effective_date>cut)
  ||payments.some(p=>p.loan_id===loan.id&&p.payment_date>cut&&new Decimal(p.capital_amount).gt(0))
  ||!!loan.cancelled_at&&loan.cancelled_at>cut);
 // Draft/cancelled contracts are not revived by an inferred payment state.
 // For active/paid contracts, dated satisfaction outranks today's mutable status.
 const receiptSatisfied=pendingPrincipal.isZero()&&actual.some(p=>new Decimal(p.capital_amount).gt(0));
 const status=loan.status==='draft'||loan.status==='cancelled'?loan.status
  :settled||receiptSatisfied?'paid' as const:futureSatisfaction?'active' as const:loan.status;
 return {actual,applications,settledCapital,settledInterest,receiptCapital,pendingPrincipal,settled,
  status};
}

/** Project recorded applications at the cut; never recalculate contractual dues or rates. */
export function loanSchedulesAtCut(loan:LoanContract,schedules:LoanSchedule[],position:ReturnType<typeof loanPosition>):LoanSchedule[]{
 const actualIds=new Set(position.actual.map(payment=>payment.id));
 const receiptSatisfied=position.status==='paid'&&!position.settled&&position.pendingPrincipal.isZero()
  &&position.actual.some(payment=>new Decimal(payment.capital_amount).gt(0));
 return schedules.filter(schedule=>schedule.loan_id===loan.id).map(schedule=>{
  if(schedule.legacy_declared_paid)return {...schedule,status:'paid'};
  const applications=schedule.payment_applications?.filter(application=>actualIds.has(application.payment_id));
  const capital=applications?applications.reduce((sum,a)=>sum.plus(a.capital_amount),new Decimal(0)):new Decimal(schedule.principal_paid??0);
  const interest=applications?applications.reduce((sum,a)=>sum.plus(a.interest_amount),new Decimal(0)):new Decimal(schedule.interest_paid??0);
  const fullyApplied=capital.gte(schedule.principal_due)&&interest.gte(schedule.interest_due)&&capital.plus(interest).gt(0);
  let status=schedule.source_status??schedule.status;
  // SQL cancels pending quotas on full repayment. Before that satisfaction the
  // original schedule remains projected; a cancelled contract remains cancelled.
  if(status==='cancelled'&&loan.status==='paid'&&position.status==='active')status='projected';
  if(schedule.closed_by_settlement&&!position.settled)status=schedule.source_status??'projected';
  if(fullyApplied)status='paid';
  else if(position.settled||receiptSatisfied)status='cancelled';
  // A paid projection without legacy evidence must follow its dated applications.
  else if(applications&&status==='paid')status='projected';
  return {...schedule,status,principal_paid:capital.toFixed(2),interest_paid:interest.toFixed(2),
   closed_by_settlement:position.settled&&!fullyApplied};
 });
}

/** Existing individual ledger positions less only settlement amounts lacking loan dimensions. */
export function loanLedgerPrincipalAtCut(loan:LoanContract,operations:FinancialOperation[],entries:{operation_id:string;loan_id?:string|null;account:string;amount:string}[],cut:string){
 const dated=new Set(operations.filter(o=>o.effective_date<=cut).map(o=>o.id));
 const balance=entries.filter(e=>e.account==='loans_receivable'&&e.loan_id===loan.id&&dated.has(e.operation_id)).reduce((s,e)=>s.plus(e.amount),new Decimal(0));
 return (loan.settlement_applications??[]).filter(a=>a.effective_date<=cut&&(!a.reversal_date||a.reversal_date>cut)).reduce((s,a)=>{
  const operation=operations.find(o=>o.operation_type==='member_settlement_confirmed'&&o.reference_id===a.settlement_id);
  const dimensioned=operation&&entries.some(e=>e.operation_id===operation.id&&e.loan_id===loan.id&&e.account==='loans_receivable');
  return dimensioned?s:s.minus(a.principal_amount);
 },balance);
}
