import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Cycle, FinancialOperation, LoanContract, LoanPayment, LoanSchedule } from '../lib/types';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../data/blockC', async original => ({ ...await original<object>(), getServerCivilToday: vi.fn().mockResolvedValue('2026-10-27') }));
import { LoansPanel } from './App';
import { FinancialCut } from './FinancialCut';

const cycle = { id: 'history-cycle', workspace_id: 'synthetic-workspace', year: 2026, name: 'Sintético', starts_on: '2026-01-01', closes_on: '2026-12-15', status: 'active' } as Cycle;
const loan = {
  id: 'history-loan', cycle_id: cycle.id, workspace_id: cycle.workspace_id,
  principal: '500000', legacy_paid_capital_amount: '0', legacy_paid_interest_amount: '50000',
  legacy_payment_state: 'declared_paid_without_cash_dates', external_borrower_name: 'Deudor sintético histórico',
  method: 'interest_only', rate_unit: 'MONTHLY_FIXED', rate_value: '0.05', term_months: 4,
  start_date: '2026-08-01', status: 'paid', cancelled_at: '2026-10-26', settlement_applications: []
  ,borrower_member_id: null, referred_by_member_id: null, scheduled_payment: null,
  prepayment_first_month_interest: null, settlement_agreement_code: null,
  disbursed_operation_id: 'disbursement', legacy_id: null, legacy_note: null
} as LoanContract;
const receipt = { id: 'total-payment', loan_id: loan.id, operation_id: 'receipt', payment_date: '2026-10-26', capital_amount: '500000', interest_amount: '0', amount: '500000', kind: 'prepayment', status: 'posted' } as LoanPayment;
const schedules = [
  { id: 'q1', installment_number: 1, due_date: '2026-09-01', principal_due: '0', interest_due: '25000', status: 'paid', source_status: 'paid', legacy_declared_paid: true, principal_paid: '0', interest_paid: '0' },
  { id: 'q2', installment_number: 2, due_date: '2026-10-01', principal_due: '0', interest_due: '25000', status: 'paid', source_status: 'paid', legacy_declared_paid: true, principal_paid: '0', interest_paid: '0' },
  { id: 'q3', installment_number: 3, due_date: '2026-11-01', principal_due: '0', interest_due: '25000', status: 'cancelled', source_status: 'cancelled', legacy_declared_paid: false, principal_paid: '0', interest_paid: '0' },
  { id: 'q4', installment_number: 4, due_date: '2026-12-01', principal_due: '500000', interest_due: '25000', status: 'cancelled', source_status: 'cancelled', legacy_declared_paid: false, principal_paid: '500000', interest_paid: '0' }
].map(s => ({ ...s, loan_id: loan.id, legacy_source_key: null, payment_applications: s.id === 'q4' ? [
  { id: 'application', loan_id: loan.id, schedule_id: 'q4', payment_id: receipt.id, capital_amount: receipt.capital_amount, interest_amount: '0' }
] : [] })) as LoanSchedule[];

beforeEach(() => { sessionStorage.clear(); localStorage.clear(); HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(async () => { await act(async () => {}); cleanup(); });
function renderAt(cut: string, contract = loan, payments = [receipt], quotas = schedules, operations: FinancialOperation[] = []) {
  sessionStorage.setItem('natillera:financial-cut:' + cycle.id, cut);
  render(<FinancialCut cycle={cycle} today="2026-10-27"><LoansPanel cycle={cycle} cycleMembers={[]} loans={[contract]} payments={payments} schedules={quotas} operations={operations} intent={null} onIntentHandled={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} /></FinancialCut>);
}

describe('cronograma original y satisfacción al corte histórico', () => {
  it('un contrato pagado hoy sigue abierto en el listado anterior al recibo', () => {
    renderAt('2026-10-25');
    expect(document.querySelector(`[data-loan-row="${loan.id}"]`)).not.toBeNull();
  });
  it('antes del pago total conserva cuotas futuras y capital originalmente exigible sin aplicar pagos futuros', () => {
    renderAt('2026-10-25');
    fireEvent.click(screen.getByRole('button', { name: /^Todos/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const detail = screen.getByRole('region', { name: 'Detalle de ' + loan.external_borrower_name });
    expect(within(detail).getByText('Cuota 3 · 1 nov')).toBeVisible();
    const final = within(detail).getByText('Cuota 4 · 1 dic').closest('li')!;
    expect(final).toHaveTextContent('Capital pendiente $ 500.000');
    expect(final).toHaveTextContent('Interés pendiente $ 25.000');
    expect(final.querySelector('.row-amount')).toHaveTextContent('$ 525.000');
    expect(detail.querySelectorAll('[data-loan-payment-row]')).toHaveLength(0);
  });
  it('un reverso futuro no muestra por cobrar el contrato que estaba saldado el día anterior', () => {
    const reversal = { id: 'undo', reverses_operation_id: receipt.operation_id, effective_date: '2026-10-27' } as FinancialOperation;
    const restored = schedules.map(s => s.legacy_declared_paid ? s : { ...s, status: 'projected' as const, source_status: 'projected' as const, principal_paid: '0', interest_paid: '0' });
    renderAt('2026-10-26', { ...loan, status: 'active' }, [{ ...receipt, status: 'reversed' }], restored, [reversal]);
    expect(document.querySelector(`[data-loan-row="${loan.id}"]`)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Pagados/ }));
    expect(document.querySelector(`[data-loan-row="${loan.id}"]`)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    expect(document.querySelector('[data-loan-payment-row]')).not.toHaveTextContent('Revertido');
  });
  it('un abono parcial futuro no reduce la cuota final del corte anterior', () => {
    const partial = { ...receipt, id: 'partial', kind: 'regular' as const, amount: '200000', capital_amount: '200000' };
    const currentQuotas = schedules.map(s => s.legacy_declared_paid ? s : {
      ...s, status: 'projected' as const, source_status: 'projected' as const,
      principal_paid: s.id === 'q4' ? '200000' : '0', interest_paid: '0', payment_applications: s.id === 'q4' ? [
        { id: 'partial-application', loan_id: loan.id, schedule_id: 'q4', payment_id: partial.id, capital_amount: '200000', interest_amount: '0' }
      ] : []
    });
    renderAt('2026-10-25', { ...loan, status: 'active', cancelled_at: null }, [partial], currentQuotas);
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    const final = screen.getByText('Cuota 4 · 1 dic').closest('li')!;
    expect(final).toHaveTextContent('Capital pendiente $ 500.000');
    expect(final).toHaveTextContent('Interés pendiente $ 25.000');
    expect(final.querySelector('.row-amount')).toHaveTextContent('$ 525.000');
  });
  it('la consulta histórica explica y bloquea pago y desembolso sin usar importes antiguos', () => {
    renderAt('2026-10-25', { ...loan, status: 'active' }, [], schedules.map(s => ({ ...s, status: s.legacy_declared_paid ? 'paid' : 'projected', source_status: s.legacy_declared_paid ? 'paid' : 'projected' })));
    expect(screen.getByText(/Consulta histórica: cambia la fecha de corte/)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    expect(screen.getByRole('button', { name: 'Registrar pago' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Registrar pago' })).toHaveAccessibleDescription(/Consulta histórica/);
    expect(screen.getByRole('button', { name: 'Pagar todo' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('el desembolso queda bloqueado en una consulta histórica de borrador', () => {
    renderAt('2026-10-25', { ...loan, status: 'draft' }, [], []);
    expect(screen.getByRole('button', { name: 'Desembolsar' })).toBeDisabled();
  });
  it('el último corte del ciclo sigue siendo operativo aunque hoy sea posterior al cierre', () => {
    const closedEarlier = { ...cycle, closes_on: '2026-10-26' };
    sessionStorage.setItem('natillera:financial-cut:' + cycle.id, '2026-10-26');
    render(<FinancialCut cycle={closedEarlier} today="2026-10-27"><LoansPanel cycle={closedEarlier} cycleMembers={[]} loans={[{ ...loan, status: 'draft' }]} payments={[]} schedules={[]} intent={null} onIntentHandled={vi.fn()} onSaved={vi.fn()} onError={vi.fn()} /></FinancialCut>);
    expect(screen.getByRole('button', { name: 'Desembolsar' })).toBeEnabled();
    expect(screen.queryByText(/Consulta histórica:/)).toBeNull();
  });
});
