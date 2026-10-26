import {expect,it} from 'vitest';
import Decimal from 'decimal.js';
import {collectedLoanInterest,memberInsight,futureLoanScenario,potentialAnnualFees,closingAdminEstimate} from './insightModels';
import type {Cycle,CycleMember,FinancialOperation,LedgerEntry,LoanContract,LoanPayment,LoanSchedule,MemberCapitalCredit,MemberSettlement,SavingsContribution} from '../lib/types';
const op=(id:string,kind:string,date='2026-10-01',undo:string|null=null)=>({id,operation_type:kind,effective_date:date,reverses_operation_id:undo,payload:{},reference_id:id} as FinancialOperation);
const entry=(id:string,account:string,amount:string,member_id='m',loan_id='l')=>({id:id+account+amount,operation_id:id,account,amount,member_id,loan_id} as LedgerEntry);
const cycle={year:2026,starts_on:'2026-01-01',closes_on:'2026-12-05'} as Cycle;
const member={id:'cm',member_id:'m',monthly_quota:'100',participation_start_month:7,participation_end_month:12,savings_status:'active',participates_in_savings:true,economic_mode:'fixed_yield'} as CycleMember;
const contribution=(id:string,amount:string,date:string,month=9)=>({id,cycle_member_id:'cm',amount,effective_date:date,applied_year:2026,applied_month:month,status:'posted'} as SavingsContribution);
const loan={id:'l',principal:'1000',status:'active',start_date:'2026-01-01',method:'amortized',rate_unit:'EA',legacy_paid_capital_amount:'0',settlement_agreement_code:null} as LoanContract;
const schedule=(id:string,date:string,capital='500',interest='30')=>({id,loan_id:'l',due_date:date,principal_due:capital,interest_due:interest,principal_paid:'0',interest_paid:'0',status:'projected',legacy_declared_paid:false} as LoanSchedule);
it('gross collected uses only dated recognitions, compensating reversal, bank/capital never income',()=>{
 const ops=[op('p','loan_payment'),op('r','reversal','2026-10-15','p'),op('h','legacy_loan_interest_correction'),op('b','bank_interest_received')];
 const entries=[entry('p','cash','110'),entry('p','loans_receivable','-100'),entry('p','admin_payable','-1'),entry('p','member_loan_profit_fund','-9'),entry('r','cash','-110'),entry('r','loans_receivable','100'),entry('r','admin_payable','1'),entry('r','member_loan_profit_fund','9'),entry('h','admin_payable','-20'),entry('h','member_loan_profit_fund','-180'),entry('b','cash','50')];
 expect(collectedLoanInterest(ops,entries,'2026-10-10').total.toFixed(2)).toBe('210.00');
 const result=collectedLoanInterest(ops,entries,'2026-10-20');expect(result.total.toFixed(2)).toBe('200.00');expect(result.historical).toBe(true);
});
it('P013 compensation uses exact settlement snapshot and does not count annual fee',()=>{
 const ops=[op('s','member_settlement_confirmed'),op('u','reversal','2026-10-15','s')],entries=[entry('s','admin_payable','-2.01'),entry('s','member_loan_profit_fund','-18.06'),entry('s','admin_payable','-20000'),entry('u','admin_payable','2.01'),entry('u','member_loan_profit_fund','18.06')];
 const settlements=[{id:'s',snapshot:{p013_first_month_interest:20.07}} as unknown as MemberSettlement];
 expect(collectedLoanInterest(ops,entries,'2026-10-10',settlements).total.toFixed(2)).toBe('20.07');expect(collectedLoanInterest(ops,entries,'2026-10-20',settlements).total.eq(0)).toBe(true);
});
it('member ordinary excludes reversed/future; advance applied month is retained without double count',()=>{
 const own=[contribution('a','120','2026-09-01',12),{...contribution('r','1000','2026-09-01'),status:'reversed'} as SavingsContribution,contribution('f','100','2026-11-01')];
 const credits=[{id:'p',cycle_member_id:'cm',source_type:'polla_prize',amount:'15',effective_date:'2026-09-02'},{id:'b',cycle_member_id:'cm',source_type:'bank_yield',amount:'2',effective_date:'2026-09-03'}] as MemberCapitalCredit[];
 const r=memberInsight(cycle,member,own,credits,[],[],[],'2026-10-20');expect(r.ordinary.eq(120)).toBe(true);expect(r.credited.eq(137)).toBe(true);expect(r.goal?.eq(600)).toBe(true);expect(r.due?.eq(400)).toBe(true);expect(r.missing?.eq(480)).toBe(true);expect(r.byMonth[11].paid.eq(120)).toBe(true);expect(r.recognized.eq(0)).toBe(true);
});
it('verified retirement stops quotas and rights without inferring last contribution',()=>{
 const settled={id:'s',cycle_member_id:'cm',status:'confirmed',cut_date:'2026-09-23'} as MemberSettlement;
 const r=memberInsight(cycle,{...member,savings_status:'withdrawn',participates_in_savings:false},[contribution('a','100','2026-08-01'),contribution('b','100','2026-10-01')],[],[settled],[],[],'2026-10-20');
 expect(r.effectiveCut).toBe('2026-09-23');expect(r.ordinary.eq(100)).toBe(true);expect(r.goal?.eq(300)).toBe(true);expect(r.additional.eq(0)).toBe(true);
 const unknown=memberInsight(cycle,{...member,savings_status:'withdrawn'},[],[],[],[],[],'2026-10-20');expect(unknown.uncertain).toBe(true);expect(unknown.goal).toBe(null);
});
it('recognized savings reflect settlement paid, not lifetime receipts or forecasts',()=>{
 const entries=[entry('a','savings_liability','-100'),entry('s','savings_liability','100'),entry('s','settlements_payable','-95'),entry('p','settlements_payable','95')];
 const r=memberInsight(cycle,member,[contribution('a','100','2026-09-01')],[],[],[op('a','savings'),op('s','member_settlement_confirmed'),op('p','member_settlement_paid')],entries,'2026-10-20');expect(r.ordinary.eq(100)).toBe(true);expect(r.recognized.eq(0)).toBe(true);
});
it('future interest uses partial schedule remaining, excludes arrears and beyond target',()=>{
 const schedules=[schedule('old','2026-09-01','100','20'),{...schedule('next','2026-11-01','400','40'),principal_paid:'50',interest_paid:'5'},schedule('later','2027-01-01','550','50')];
 const r=futureLoanScenario([loan],[],schedules,[op('d','loan_disbursement')],[entry('d','loans_receivable','1000')],'2026-10-20','2026-12-05');
 expect(r.interest.eq(35)).toBe(true);expect(r.admin.eq(3.5)).toBe(true);expect(r.fund.eq(31.5)).toBe(true);expect(r.overdue.eq(20)).toBe(true);expect(r.excluded).toHaveLength(0);
});
it.each(['fixed_interest','interest_only','amortized'] as const)('contract %s uses existing schedule, no invented original-principal interest',method=>{
 const r=futureLoanScenario([{...loan,method}],[],[schedule('n','2026-11-01','1000','12.34')],[op('d','loan_disbursement')],[entry('d','loans_receivable','1000')],'2026-10-20','2026-12-05');expect(r.interest.toFixed(2)).toBe('12.34');expect(r.admin.toFixed(2)).toBe('1.23');
});
it('prepayment, stale schedule, historical progress and P013 expose uncertainty instead of inventing yield',()=>{
 const schedules=[schedule('n','2026-11-01','1000')],ops=[op('d','loan_disbursement')],entries=[entry('d','loans_receivable','500')];
 expect(futureLoanScenario([loan],[],schedules,ops,entries,'2026-10-20','2026-12-05').excluded[0].reason).toContain('no conciliados');
 for(const payment of [{payment_date:'2026-10-25',kind:'regular'},{payment_date:'2026-10-01',kind:'prepayment'}])expect(futureLoanScenario([loan],[{...payment,loan_id:'l',status:'posted',capital_amount:'0',interest_amount:'0',amount:'0'} as LoanPayment],schedules,ops,entries,'2026-10-20','2026-12-05').included).toHaveLength(0);
 expect(futureLoanScenario([{...loan,settlement_agreement_code:'P013_FIRST_MONTH'}],[],schedules,ops,entries,'2026-10-20','2026-12-05').excluded[0].reason).toContain('P013');
 expect(futureLoanScenario([{...loan,status:'paid'}],[],schedules,ops,entries,'2026-10-20','2026-12-05').included).toHaveLength(0);
});
it('annual fee once per identified eligible member; reversed fee restores potential, settled member excluded',()=>{
 const other={...member,id:'cm2',member_id:'m2'},ops=[op('fee','admin_fee_recognized')],entries=[entry('fee','admin_payable','-20000')];
 expect(potentialAnnualFees([member,other],[],ops,entries,'2026-10-20','2026-12-05').amount.eq(20000)).toBe(true);
 expect(potentialAnnualFees([member],[],[...ops,op('u','reversal','2026-10-10','fee')],[...entries,entry('u','admin_payable','20000')],'2026-10-20','2026-12-05').count).toBe(1);
 expect(potentialAnnualFees([member],[{cycle_member_id:'cm',cut_date:'2026-10-01',status:'paid'} as MemberSettlement],[],[],'2026-10-20','2026-12-05').count).toBe(0);
});
it('net coverage and withdrawals preserve recognized amounts and uncertain states',()=>{
 const base={earned:new Decimal(1000),bookedCoverage:new Decimal(-50),withdrawals:new Decimal(-200),additional:new Decimal(100),futureFund:new Decimal(90),reserve:new Decimal(80),uncertain:false};
 const r=closingAdminEstimate(base);expect(r.coverage?.eq(0)).toBe(true);expect(r.net?.eq(1050)).toBe(true);expect(r.retained?.eq(850)).toBe(true);
 expect(closingAdminEstimate({...base,futureFund:new Decimal(30)}).coverage?.eq(50)).toBe(true);
 expect(closingAdminEstimate({...base,uncertain:true}).net).toBe(null);expect(closingAdminEstimate({...base,reserve:null}).net).toBe(null);
});

it('credited prize liability clearing cannot reduce savings twice when original prize has no member dimension',()=>{
 const entries=[entry('s','savings_liability','-100'),entry('credit','savings_liability','-15'),entry('credit','prizes_payable','15')];
 const r=memberInsight(cycle,member,[contribution('s','100','2026-09-01')],[],[],[op('s','savings'),op('credit','polla_prize_credited')],entries,'2026-10-20');expect(r.recognized.eq(115)).toBe(true);
});
