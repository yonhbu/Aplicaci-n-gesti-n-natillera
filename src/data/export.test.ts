import {expect,it} from 'vitest';
import {buildNatilleraExport,buildBlockDExport} from './export';
import type {LoanContract,LoanSchedule} from '../lib/types';
const effect={id:'effect',loan_id:'loan',settlement_id:'settlement',principal_amount:'10.25',interest_amount:'1.20',effective_date:'2026-10-21',reversal_date:null};
const schedule:LoanSchedule={id:'schedule',loan_id:'loan',installment_number:1,due_date:'2026-11-01',principal_due:'10.25',interest_due:'1.20',status:'cancelled',legacy_source_key:null,legacy_declared_paid:false,source_status:'projected',closed_by_settlement:true};
const input:Parameters<typeof buildBlockDExport>[0]={workspace:{id:'workspace',name:'Synthetic'},cycle:{id:'cycle',workspace_id:'workspace',year:2026,name:'Synthetic',starts_on:'2026-01-01',closes_on:'2026-12-05',status:'active'},cycleMembers:[],contributions:[],operations:[],ledgerEntries:[],loans:[{id:'loan',principal:'100.25',settlement_applications:[effect]} as LoanContract],loanPayments:[],loanSchedules:[],pollaActivities:[],pollaContributions:[],pollaPrizes:[],bankAccounts:[],bankReconciliations:[],memberSettlements:[],memberSettlementPayments:[],loanProfitDistributions:[],loanProfitDistributionPayments:[]};
it('portable ABC keeps raw loan columns and amounts, without persisting the joined read model',()=>{
 const result=buildNatilleraExport({...input,loanSchedules:[schedule]});
 expect(result.data.loans).toEqual([{id:'loan',principal:'100.25'}]);expect(input.loans[0].settlement_applications).toEqual([effect]);
 expect(result.data.loanSchedules[0]).not.toHaveProperty('closed_by_settlement');expect(result.data.loanSchedules[0]).toMatchObject({principal_due:'10.25',interest_due:'1.20',source_status:'projected'});
});
it('full financial export preserves source settlement applications in its existing extension',()=>{
 const result=buildBlockDExport({...input,loanSchedules:[schedule],finExtensions:{member_settlement_debt_applications:[effect]}});
 expect(result.data.loans).toEqual([{id:'loan',principal:'100.25'}]);expect(result.data).toMatchObject({member_settlement_debt_applications:[effect]});
 expect(result.data.loanSchedules[0]).not.toHaveProperty('closed_by_settlement');
});
