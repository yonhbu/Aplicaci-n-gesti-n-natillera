import Decimal from 'decimal.js';
import type {Cycle, CycleMember, FinancialOperation, LedgerEntry, LoanContract, LoanPayment, LoanSchedule, MemberCapitalCredit, MemberSettlement, SavingsContribution} from '../lib/types';
import {reconstructMoney} from '../domain/financialReconstruction';
import {allocateCollectedInterest} from '../domain/loanFinance';
import {loanPosition,loanLedgerPrincipalAtCut} from '../domain/loanPosition';
import {scheduleRemaining} from './viewSummaries';
import {memberIsCollective} from './memberOverview';
const sum=(values:Decimal.Value[])=>values.reduce<Decimal>((a,b)=>a.plus(b),new Decimal(0));
export const projectionTarget=(cycle:Cycle)=>`${cycle.year}-12-05`;

/** Read-only presentation, one recognition source: dated ledger, never payments + derived postings. */
export function collectedLoanInterest(operations:FinancialOperation[],entries:LedgerEntry[],cut:string,settlements:MemberSettlement[]=[]){
 const rows=reconstructMoney(operations,entries,cut).rows.flatMap(row=>{
  let amount=new Decimal(0);
  if(['loan_payment','loan_prepayment'].includes(row.kind))amount=row.interestCollected;
  else if(row.kind==='legacy_loan_interest_correction')amount=sum(row.postings.filter(e=>['admin_payable','member_loan_profit_fund'].includes(e.account)).map(e=>e.amount)).negated();
  // Only the interest-specific fund posting identifies compensated P013; annual fees are separate.
  else if(row.kind==='member_settlement_confirmed'){
   const original=operations.find(o=>o.id===(row.operation.reverses_operation_id??row.operation.id));
   const settlement=settlements.find(s=>s.id===original?.reference_id||s.operation_id===original?.id);
   const interest=settlement?.snapshot?.p013_first_month_interest;
   if(interest!=null)amount=new Decimal(String(interest)).mul(row.operation.reverses_operation_id?-1:1);

  }
  return amount.isZero()?[]:[{...row,amount}];
 });
 return {total:sum(rows.map(r=>r.amount)),rows,historical:rows.some(r=>r.kind==='legacy_loan_interest_correction'),compensated:rows.some(r=>r.kind==='member_settlement_confirmed')};
}

export function memberInsight(cycle:Cycle,member:CycleMember,contributions:SavingsContribution[],credits:MemberCapitalCredit[],settlements:MemberSettlement[],operations:FinancialOperation[],entries:LedgerEntry[],cut:string){
 const settlement=settlements.filter(s=>s.cycle_member_id===member.id&&s.status!=='reversed'&&s.cut_date<=cut).sort((a,b)=>a.cut_date.localeCompare(b.cut_date))[0];
 const effectiveCut=settlement?.cut_date??cut;
 const own=contributions.filter(c=>c.cycle_member_id===member.id&&c.status!=='reversed'&&c.effective_date<=effectiveCut);
 const ownCredits=credits.filter(c=>c.cycle_member_id===member.id&&!c.reversed_at&&c.effective_date<=effectiveCut);
 const ordinary=sum(own.map(c=>c.amount)),prizes=sum(ownCredits.filter(c=>c.source_type==='polla_prize').map(c=>c.amount)),bank=sum(ownCredits.filter(c=>c.source_type==='bank_yield').map(c=>c.amount));
 const uncertain=member.savings_status!=='active'&&!settlement;
 const end=Math.min(member.participation_end_month,12,settlement?Number(settlement.cut_date.slice(5,7)):12);
 const quota=new Decimal(member.monthly_quota),start=member.participation_start_month;
 const goal=uncertain?null:quota.mul((member.participates_in_savings||!!settlement)?Math.max(0,end-start+1):0);
 const due=uncertain?null:quota.mul((member.participates_in_savings||!!settlement)?Math.max(0,Math.min(end,Number(cut.slice(5,7)))-start+1):0);
 const target=projectionTarget(cycle);
 const byMonth=Array.from({length:12},(_,i)=>({month:i+1,paid:sum(own.filter(c=>c.applied_year===cycle.year&&c.applied_month===i+1).map(c=>c.amount)),eligible:(member.participates_in_savings||!!settlement)&&i+1>=start&&i+1<=end}));
 const payableAccounts=['savings_liability','member_bank_yield_payable','settlements_payable','utility_distribution_payable'];
 const recognizedByAccount=Object.fromEntries(payableAccounts.map(account=>[account,sum(reconstructMoney(operations,entries,cut).rows.flatMap(r=>r.postings.filter(e=>e.member_id===member.member_id&&e.account===account).map(e=>e.amount))).negated()]));
 const recognized=sum(reconstructMoney(operations,entries,cut).rows.flatMap(r=>r.postings.filter(e=>e.member_id===member.member_id&&payableAccounts.includes(e.account)).map(e=>e.amount))).negated();
 const ownLoans=reconstructMoney(operations,entries,cut).rows.flatMap(r=>r.postings.filter(e=>e.member_id===member.member_id&&e.account==='loans_receivable'));
 return {own,ownCredits,ordinary,prizes,bank,credited:ordinary.plus(prizes).plus(bank),recognized,recognizedByAccount,principalDebt:sum(ownLoans.map(e=>e.amount)),settlement,effectiveCut,uncertain,goal,due,missing:goal?Decimal.max(goal.minus(ordinary),0):null,additional:!uncertain&&cut<target&&!settlement&&goal?Decimal.max(goal.minus(ordinary),0):new Decimal(0),byMonth,collective:memberIsCollective(member)};
}

/** Scenario only. Existing applied schedule is authoritative, never regenerate on original principal. */
export function futureLoanScenario(loans:LoanContract[],payments:LoanPayment[],schedules:LoanSchedule[],operations:FinancialOperation[],entries:LedgerEntry[],cut:string,target:string){
 const included:{loan:LoanContract;schedule:LoanSchedule;interest:Decimal;admin:Decimal;fund:Decimal}[]=[];
 const excluded:{loan:LoanContract;reason:string}[]=[];let overdue=new Decimal(0);
 for(const loan of loans){
  if(loanPosition(loan,payments,cut,operations).status!=='active'||loan.start_date>cut)continue;
  const events=payments.filter(p=>p.loan_id===loan.id);
  const open=schedules.filter(s=>s.loan_id===loan.id&&s.status!=='cancelled'&&s.status!=='paid'&&!s.legacy_declared_paid);
  const pending=loanLedgerPrincipalAtCut(loan,operations,entries,cut);
  const scheduleCapital=sum(open.map(s=>scheduleRemaining(s).capital));
  const reason=events.some(p=>p.payment_date>cut)?'Actividad posterior al corte; progreso histórico no versionado':loan.settlement_agreement_code==='P013_FIRST_MONTH'?'P013 requiere cotización contractual; no extrapolar':events.some(p=>p.kind==='prepayment'&&p.status!=='reversed')?'Prepago: requiere cronograma vigente conciliado':!open.length?'Sin cronograma abierto verificable':!pending.gt(0)||!scheduleCapital.eq(pending)?'Capital pendiente y cronograma no conciliados':null;
  if(reason){excluded.push({loan,reason});continue;}
  for(const schedule of open){
   const interest=scheduleRemaining(schedule).interest;
   if(schedule.due_date<=cut){overdue=overdue.plus(interest);continue;}
   if(schedule.due_date>target||interest.lte(0))continue;
   const allocation=allocateCollectedInterest(interest);included.push({loan,schedule,interest,admin:allocation.admin,fund:allocation.memberFund});
  }
 }
 return {included,excluded,overdue,interest:sum(included.map(r=>r.interest)),admin:sum(included.map(r=>r.admin)),fund:sum(included.map(r=>r.fund))};
}

export function potentialAnnualFees(members:CycleMember[],settlements:MemberSettlement[],operations:FinancialOperation[],entries:LedgerEntry[],cut:string,target:string){
 const known=reconstructMoney(operations,entries,cut).rows.filter(r=>r.kind==='admin_fee_recognized');
 const postings=known.flatMap(r=>r.postings.filter(e=>e.account==='admin_payable'));
 const ambiguous=sum(postings.filter(e=>!e.member_id).map(e=>e.amount)).lt(0);
 const candidates=members.filter(m=>m.savings_status==='active'&&m.participation_start_month<=12&&m.participation_end_month>=12&&!settlements.some(s=>s.cycle_member_id===m.id&&s.status!=='reversed'&&s.cut_date<=cut)&&!sum(postings.filter(e=>e.member_id===m.member_id).map(e=>e.amount)).lt(0));
 return {count:ambiguous||cut>=target?0:candidates.length,amount:new Decimal(ambiguous||cut>=target?0:candidates.length).mul(20000),ambiguous};
}

/** Scenario uses the canonical net reserve; never subtract gross EA twice. */
export function closingAdminEstimate(input:{earned:Decimal;bookedCoverage:Decimal;withdrawals:Decimal;additional:Decimal;futureFund:Decimal;reserve:Decimal|null;uncertain:boolean}){
 const coverage=input.reserve===null?null:Decimal.max(input.reserve.minus(input.futureFund),0);
 const net=coverage!==null&&!input.uncertain?input.earned.plus(input.bookedCoverage).plus(input.additional).minus(coverage):null;
 return {coverage,net,retained:net===null?null:net.plus(input.withdrawals)};
}
