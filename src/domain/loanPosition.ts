import Decimal from 'decimal.js';
import type {FinancialOperation,LoanContract,LoanPayment} from '../lib/types';

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
 const futureSettlement=loan.status==='paid'&&(loan.settlement_applications??[]).some(a=>a.effective_date>cut)&&pendingPrincipal.gt(0);
 return {actual,applications,settledCapital,settledInterest,receiptCapital,pendingPrincipal,settled,
  status:settled?'paid' as const:futureSettlement?'active' as const:loan.status};
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
