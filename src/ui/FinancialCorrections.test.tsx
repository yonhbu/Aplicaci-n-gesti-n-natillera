import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {Cycle,FinancialOperation,LoanContract,LoanSchedule,PollaPrize} from '../lib/types';
const mocks=vi.hoisted(()=>({reverse:vi.fn(),prize:vi.fn(),cancel:vi.fn()}));
vi.mock('../lib/supabase',()=>({supabase:{}}));
vi.mock('../data/finance',async original=>({...await original<object>(),reverseFinancialOperation:mocks.reverse}));
vi.mock('../data/polla',async original=>({...await original<object>(),reversePollaPrize:mocks.prize,cancelPollaActivity:mocks.cancel}));
vi.mock('../data/blockC',async original=>({...await original<object>(),getServerCivilToday:vi.fn().mockResolvedValue('2026-10-16')}));
import {FinancialCorrections,LoansPanel,MoreTabs,PollaPanel,UndoOperationButton,UndoPollaButton} from './App';
const cycle={id:'cycle',workspace_id:'workspace',year:2026,name:'2026',starts_on:'2026-01-01',closes_on:'2026-12-15',status:'active'} as Cycle;
const operation={id:'payment-operation',cycle_id:cycle.id,workspace_id:'workspace',operation_type:'loan_payment',effective_date:'2026-10-01',idempotency_key:'original-payment',payload:{},reverses_operation_id:null} as FinancialOperation;
beforeEach(()=>{localStorage.clear();vi.clearAllMocks();HTMLElement.prototype.scrollIntoView=vi.fn();mocks.reverse.mockResolvedValue({});mocks.prize.mockResolvedValue({});mocks.cancel.mockResolvedValue({});});
afterEach(cleanup);
describe('financial correction controls without a browser',()=>{
  it('operational navigation offers backups without the import workflow',()=>{
    render(<MoreTabs activeSection="bank" onChange={vi.fn()}/>);expect(screen.getByRole('button',{name:'Respaldos'})).toBeVisible();expect(screen.queryByRole('button',{name:/migraci/i})).toBeNull();
  });
  it('cancel closes the confirmation without financial writes',async()=>{
    render(<FinancialCorrections operations={[operation]} onSaved={vi.fn()} onError={vi.fn()}><UndoOperationButton operationId={operation.id}/></FinancialCorrections>);
    fireEvent.click(screen.getByRole('button',{name:'Anular'}));expect(screen.getByRole('dialog')).toBeVisible();fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));expect(screen.queryByRole('dialog')).toBeNull();expect(mocks.reverse).not.toHaveBeenCalled();
  });
  it('a saved reversal refreshes the data and cannot be submitted twice in flight',async()=>{
    let resolve!:(v:unknown)=>void;mocks.reverse.mockReturnValue(new Promise(r=>resolve=r));const saved=vi.fn().mockResolvedValue(undefined);
    render(<FinancialCorrections operations={[operation]} onSaved={saved} onError={vi.fn()}><UndoOperationButton operationId={operation.id}/></FinancialCorrections>);
    fireEvent.click(screen.getByRole('button',{name:'Anular'}));fireEvent.change(screen.getByLabelText('Fecha de la anulación'),{target:{value:'2026-10-16'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar anulación'}));
    expect(screen.getByRole('button',{name:'Anulando...'})).toBeDisabled();expect(screen.getByRole('button',{name:'Cancelar'})).toBeDisabled();expect(mocks.reverse).toHaveBeenCalledTimes(1);
    expect(mocks.reverse.mock.calls[0][0]).toMatchObject({operationId:operation.id,effectiveDate:'2026-10-16',reason:'Error de registro'});expect(saved).not.toHaveBeenCalled();resolve({});await waitFor(()=>expect(saved).toHaveBeenCalledTimes(1));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
  });
  it('prize reversal uses the coordinated RPC and shows dependency error',async()=>{
    mocks.prize.mockRejectedValue(new Error('El premio tiene una liquidacion dependiente; no se puede revertir por separado.'));const saved=vi.fn();
    render(<FinancialCorrections operations={[]} onSaved={saved} onError={vi.fn()}><UndoPollaButton target={{kind:'prize',id:'prize-id',label:'Premio $45.000',date:'2026-09-01'}}/></FinancialCorrections>);
    fireEvent.click(screen.getByRole('button',{name:'Anular premio'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar anulación'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('liquidacion dependiente'));expect(mocks.prize).toHaveBeenCalledTimes(1);expect(mocks.reverse).not.toHaveBeenCalled();expect(saved).not.toHaveBeenCalled();
  });
  it('already reversed operations have no second undo action',()=>{
    render(<FinancialCorrections operations={[operation,{...operation,id:'undo',operation_type:'reversal',reverses_operation_id:operation.id}]} onSaved={vi.fn()} onError={vi.fn()}><UndoOperationButton operationId={operation.id}/></FinancialCorrections>);expect(screen.queryByRole('button',{name:'Anular'})).toBeNull();
  });
  it('paid initial quotas are ordinary paid quotas without a warning or invented receipt',()=>{
    const loan={id:'loan',legacy_id:'P004',borrower_member_id:'member',external_borrower_name:null,principal:'100000',legacy_paid_capital_amount:'50000',legacy_paid_interest_amount:'5000',legacy_payment_state:'declared_paid_without_cash_dates',status:'active',term_months:2,method:'fixed_interest',rate_unit:'MONTHLY_FIXED',rate_value:'0.05',start_date:'2026-08-01',borrower:{display_name:'Socio sintético'}} as LoanContract;
    const schedules=[{id:'q1',loan_id:'loan',installment_number:1,due_date:'2026-09-01',principal_due:'50000',interest_due:'5000',legacy_declared_paid:true,status:'paid'},{id:'q2',loan_id:'loan',installment_number:2,due_date:'2026-10-01',principal_due:'50000',interest_due:'2500',legacy_declared_paid:false,status:'projected'}] as LoanSchedule[];
    render(<LoansPanel cycle={cycle} cycleMembers={[]} loans={[loan]} payments={[]} schedules={schedules} intent={null} onIntentHandled={vi.fn()} onSaved={vi.fn()} onError={vi.fn()}/>);fireEvent.click(screen.getByRole('button',{name:'Ver detalle'}));fireEvent.click(screen.getByRole('button',{name:/cuotas pagadas/}));expect(screen.getByText('Pagada · Cap. $ 50.000 · Int. $ 5.000',{exact:false})).toBeVisible();expect(document.body.textContent).not.toMatch(/legacy|históric|sin confirmar|migraci/i);expect(screen.queryByText(/sin fecha ni comprobante/)).toBeNull();
  });
  it('shows an undo action for each credited prize and hides cancelled activities',()=>{
    const prize={id:'prize',activity_id:'active',winner_cycle_member_id:'member',gross_amount:'50000',net_amount:'45000',admin_commission:'5000',status:'settled',awarded_at:'2026-09-01',legacy_payment_status:'paid_verified'} as PollaPrize;
    render(<FinancialCorrections operations={[]} onSaved={vi.fn()} onError={vi.fn()}><PollaPanel cycle={cycle} cycleMembers={[]} activities={[{id:'active',workspace_id:'workspace',cycle_id:'cycle',name:'Polla vigente',period_year:2026,period_month:9,status:'open'},{id:'cancelled',workspace_id:'workspace',cycle_id:'cycle',name:'No mostrar cancelada',period_year:2026,period_month:8,status:'closed',cancelled_at:'2026-10-01'}]} contributions={[]} prizes={[prize]} ledgerEntries={[]} onSaved={vi.fn()} onError={vi.fn()}/></FinancialCorrections>);
    expect(screen.getByRole('button',{name:'Anular premio'})).toBeVisible();expect(screen.queryByText('No mostrar cancelada')).toBeNull();expect(screen.queryByRole('button',{name:'Revisar pago anterior'})).toBeNull();expect(within(screen.getByRole('group',{name:'Mes de la polla'})).queryByText('Agosto')).toBeNull();
  });
  it('collective receipts show recorded collection without inventing unpaid individual quotas',()=>{
    render(<PollaPanel cycle={cycle} cycleMembers={[]} activities={[{id:'collective',workspace_id:'workspace',cycle_id:'cycle',name:'Polla registrada',period_year:2026,period_month:9,status:'open'}]} contributions={[{id:'receipt',workspace_id:'workspace',cycle_id:'cycle',activity_id:'collective',cycle_member_id:null,amount:'110000',paid_date:'2026-09-01',status:'posted',legacy_id:'source',legacy_collective:true,legacy_participant_label:null}]} prizes={[]} ledgerEntries={[]} onSaved={vi.fn()} onError={vi.fn()}/>);
    expect(screen.getByText('Recaudo registrado')).toBeVisible();expect(screen.queryByText(/0 de .* aportaron/)).toBeNull();expect(screen.queryByText(/Ningún socio/)).toBeNull();expect(screen.getByText('Recaudo de la polla',{selector:'strong'})).toBeVisible();
  });
});
