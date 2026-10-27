import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Cycle, LoanContract, LoanPayment, LoanSchedule } from '../lib/types';
const mocks = vi.hoisted(() => ({ record: vi.fn(), quote: vi.fn(), confirm: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../data/loans', async original => ({ ...await original<object>(), recordLoanPayment: mocks.record, quoteLoanPrepayment: mocks.quote, confirmLoanPrepayment: mocks.confirm }));
vi.mock('../data/blockC', async original => ({ ...await original<object>(), getServerCivilToday: vi.fn().mockResolvedValue('2026-10-26') }));
// The baseline runner materializes App from HEAD beside the real module, preserving its relative imports.
const modulePath = process.env.AUDIT_BASELINE === '1' ? './App.audit-baseline.tsx' : './App';
const { LoansPanel } = await import(/* @vite-ignore */ modulePath);
const cycle = { id: 'audit-cycle', workspace_id: 'audit-w', year: 2026, name: 'Sintético', starts_on: '2026-01-01', closes_on: '2026-12-05', status: 'active' } as Cycle;
const loan = { id: 'audit-loan', principal: '500000', external_borrower_name: 'Prestataria sintética', legacy_paid_capital_amount: '0', legacy_paid_interest_amount: '50000', status: 'active', method: 'interest_only', rate_unit: 'MONTHLY_FIXED', rate_value: '0.05', term_months: 4, start_date: '2026-08-01' } as LoanContract;
const schedules = [1, 2, 3, 4].map(n => ({ id: 'q' + n, loan_id: loan.id, installment_number: n, due_date: `2026-${String(n + 8).padStart(2, '0')}-01`, principal_due: n === 4 ? '500000' : '0', interest_due: '25000', principal_paid: n === 4 ? '200000' : '0', interest_paid: '0', legacy_declared_paid: n < 3, status: n < 3 ? 'paid' : 'projected' })) as LoanSchedule[];
const payment = { id: 'p', loan_id: loan.id, payment_date: '2026-10-26', amount: '200000', capital_amount: '200000', interest_amount: '0', kind: 'regular', status: 'posted' } as LoanPayment;
beforeEach(() => {
  localStorage.clear(); vi.clearAllMocks(); HTMLElement.prototype.scrollIntoView = vi.fn();
  mocks.record.mockResolvedValue(payment); mocks.confirm.mockResolvedValue(payment);
  mocks.quote.mockResolvedValue({ principal_due: 300000, interest_due: 0, total_due: 300000, quote_hash: 'synthetic-hash', quote_date: '2026-10-26', rule_version: 'contract-fixed-policy' });
});
afterEach(cleanup);
function show(payments: LoanPayment[] = [payment]) {
  const saved = vi.fn().mockResolvedValue(undefined);
  render(<LoansPanel cycle={cycle} cycleMembers={[]} loans={[loan]} payments={payments} schedules={schedules} intent={null} onIntentHandled={vi.fn()} onSaved={saved} onError={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
  return saved;
}
it('P011 muestra 325.000 pendientes y distingue los 525.000 originales tras aplicar 200.000', () => {
  show();
  const final = screen.getByText(/Cuota 4 ·/).closest('li')!;
  expect(final.querySelector('.row-amount')).toHaveTextContent('325.000');
  expect(final).toHaveTextContent(/Capital pendiente.*300\.000/);
  expect(final).toHaveTextContent(/Interés pendiente.*25\.000/);
  expect(final).toHaveTextContent(/Programado originalmente.*525\.000/);
});
it('editar el desglose deja de presentar un abono de capital como cuota', () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
  const sheet = within(screen.getByRole('dialog'));
  fireEvent.change(sheet.getByLabelText('Capital', { exact: true }), { target: { value: '200000' } });
  fireEvent.change(sheet.getByLabelText('Interés', { exact: true }), { target: { value: '0' } });
  expect(sheet.getByRole('button', { name: 'Otro monto' })).toHaveAttribute('aria-pressed', 'true');
  expect(sheet.getByRole('button', { name: 'Cuota' })).toHaveAttribute('aria-pressed', 'false');
  expect(sheet.getByText(/Abono al capital/)).toBeVisible();
});
it('guarda la nota junto a importes canónicos y la conserva en un cobro revertido', async () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
  const sheet = within(screen.getByRole('dialog'));
  fireEvent.change(sheet.getByLabelText('Pago', { exact: true }), { target: { value: '200000' } });
  fireEvent.change(sheet.getByLabelText('Capital', { exact: true }), { target: { value: '200000' } });
  fireEvent.change(sheet.getByLabelText('Interés', { exact: true }), { target: { value: '0' } });
  fireEvent.change(sheet.getByLabelText('Nota del pago'), { target: { value: '  Abono extraordinario al capital  ' } });
  fireEvent.click(sheet.getByRole('button', { name: 'Registrar Pago' }));
  await waitFor(() => expect(mocks.record).toHaveBeenCalledOnce());
  expect(mocks.record.mock.calls[0][0]).toMatchObject({ amount: '200000.00', capitalAmount: '200000.00', interestAmount: '0.00', note: 'Abono extraordinario al capital', bankAccountId: null });
  cleanup(); show([{ ...payment, note: 'Abono extraordinario al capital', status: 'reversed' }]);
  expect(screen.getByText('Nota: Abono extraordinario al capital')).toBeVisible();
  expect(screen.getByText(/Revertido/)).toBeVisible();
});
it('pagar todo envía la cotización del servidor con la nota sin recalcular capital', async () => {
  show(); fireEvent.click(screen.getByRole('button', { name: 'Pagar todo' }));
  const sheet = within(screen.getByRole('dialog'));
  await waitFor(() => expect(sheet.getByRole('button', { name: 'Confirmar pago total' })).toBeEnabled());
  fireEvent.change(sheet.getByLabelText('Nota del pago'), { target: { value: 'Cancelación sintética' } });
  fireEvent.click(sheet.getByRole('button', { name: 'Confirmar pago total' }));
  await waitFor(() => expect(mocks.confirm).toHaveBeenCalledOnce());
  expect(mocks.confirm.mock.calls[0]).toEqual([loan.id, expect.any(String), expect.any(String), 'synthetic-hash', null, 'Cancelación sintética']);
});

it('mantiene el pago bloqueado hasta actualizar los datos antes de permitir otra cuota', async () => {
  let resume!: () => void;
  const refreshed = new Promise<void>(resolve => { resume = resolve; });
  const saved = show(); saved.mockReturnValue(refreshed);
  fireEvent.click(screen.getByRole('button', { name: 'Registrar pago' }));
  const sheet = within(screen.getByRole('dialog'));
  fireEvent.click(sheet.getByRole('button', { name: 'Registrar Pago' }));
  await waitFor(() => expect(saved).toHaveBeenCalledOnce());
  try {
    expect(screen.getByRole('dialog')).toBeVisible();
    expect(sheet.getByRole('button', { name: 'Guardando...' })).toBeDisabled();
  } finally { await act(async () => { resume(); await refreshed; }); }
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
