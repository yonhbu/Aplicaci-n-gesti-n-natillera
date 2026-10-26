import {expect,it} from 'vitest';
import {loanPosition,loanLedgerPrincipalAtCut} from './loanPosition';
import type {LoanContract,LoanPayment,LoanSettlementEffect,FinancialOperation,LedgerEntry} from '../lib/types';
const effect={id:'a',settlement_id:'s',loan_id:'l',principal_amount:'549506.00',interest_amount:'0',effective_date:'2026-10-21',reversal_date:null} as LoanSettlementEffect;
const loan={id:'l',principal:'1500000.00',legacy_paid_capital_amount:'950494.00',status:'paid',settlement_applications:[effect]} as LoanContract;
it('consolidated paid principal and a settlement extinguish debt exactly once',()=>{
 const r=loanPosition(loan,[],'2026-10-21');expect(r.pendingPrincipal.toFixed(2)).toBe('0.00');expect(r.receiptCapital.toFixed(2)).toBe('950494.00');expect(r.settledCapital.toFixed(2)).toBe('549506.00');expect(r.settled).toBe(true);
 const previous=loanPosition(loan,[],'2026-10-20');expect(previous.pendingPrincipal.toFixed(2)).toBe('549506.00');expect(previous.status).toBe('active');
});
it('P013 compensates agreed interest, never future scheduled interest or cash',()=>{
 const r=loanPosition({...loan,principal:'500000',legacy_paid_capital_amount:'0',settlement_applications:[{...effect,principal_amount:'500000',interest_amount:'25000'}]},[],'2026-10-21');expect(r.settledInterest.toFixed(2)).toBe('25000.00');expect(r.actual).toHaveLength(0);expect(r.pendingPrincipal.eq(0)).toBe(true);
});
it('regular and partial payments coexist with compensation and other loans remain independent',()=>{
 const payments=[{loan_id:'l',capital_amount:'100000',payment_date:'2026-10-10',status:'posted'},{loan_id:'other',capital_amount:'9999999',payment_date:'2026-10-10',status:'posted'}] as LoanPayment[];
 const r=loanPosition({...loan,settlement_applications:[{...effect,principal_amount:'449506'}]},payments,'2026-10-21');expect(r.pendingPrincipal.eq(0)).toBe(true);
 expect(loanPosition({...loan,settlement_applications:[]},payments,'2026-10-21').pendingPrincipal.toFixed(2)).toBe('449506.00');
});
it('a reversed receipt counts before its dated annulment and not afterwards',()=>{
 const p={loan_id:'l',operation_id:'receipt',capital_amount:'100',payment_date:'2026-10-10',status:'reversed'} as LoanPayment;
 const ops=[{id:'undo',reverses_operation_id:'receipt',effective_date:'2026-10-20'}] as FinancialOperation[];
 expect(loanPosition({...loan,settlement_applications:[]},[p],'2026-10-15',ops).pendingPrincipal.toFixed(2)).toBe('549406.00');
 expect(loanPosition({...loan,settlement_applications:[]},[p],'2026-10-20',ops).pendingPrincipal.toFixed(2)).toBe('549506.00');
});
it('aggregate compensation is allocated to the individual read model without double posting',()=>{
 const ops=[{id:'opening',effective_date:'2026-07-05'},{id:'confirmed',operation_type:'member_settlement_confirmed',reference_id:'s',effective_date:'2026-10-21'}] as FinancialOperation[];
 const entries=[{operation_id:'opening',loan_id:'l',account:'loans_receivable',amount:'549506'},{operation_id:'confirmed',loan_id:null,account:'loans_receivable',amount:'-1049506'}] as LedgerEntry[];
 expect(loanLedgerPrincipalAtCut(loan,ops,entries,'2026-10-20').toFixed(2)).toBe('549506.00');
 expect(loanLedgerPrincipalAtCut(loan,ops,entries,'2026-10-21').toFixed(2)).toBe('0.00');
 expect(loanLedgerPrincipalAtCut(loan,ops,[...entries,{operation_id:'confirmed',loan_id:'l',account:'loans_receivable',amount:'-549506'} as LedgerEntry],'2026-10-21').toFixed(2)).toBe('0.00');
});
it('a dated settlement reversal restores its individual debt without deleting history',()=>{
 const reversed={...loan,status:'active' as const,settlement_applications:[{...effect,reversal_date:'2026-10-22'}]};
 expect(loanPosition(reversed,[],'2026-10-21').pendingPrincipal.eq(0)).toBe(true);
 expect(loanPosition(reversed,[],'2026-10-22').pendingPrincipal.toFixed(2)).toBe('549506.00');
});
