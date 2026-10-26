import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { BankAccount, Cycle } from '../lib/types';
const mocks = vi.hoisted(() => ({ statement: vi.fn(), record: vi.fn(), fine: vi.fn(), preview: vi.fn(), confirm: vi.fn(), reverse: vi.fn() }));
vi.mock('../data/reconciliation', () => ({ statementComparison: mocks.statement, recordStatement: mocks.record, recordFine: mocks.fine, previewReconciliation: mocks.preview, confirmReconciliation: mocks.confirm, reverseReconciliation: mocks.reverse }));
import { StatementCheck } from './StatementCheck';
const cycle = { id: 'synthetic-cycle', workspace_id: 'synthetic-workspace' } as Cycle;
const accounts = [{ id: 'synthetic-bank', display_name: 'Banco sintético' }] as BankAccount[];
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.statement.mockResolvedValue({ state: 'empty' }); mocks.record.mockResolvedValue({}); mocks.fine.mockResolvedValue({}); });
afterEach(cleanup);
it('does not render or fetch the removed comparison while retaining registration tools', () => {
  render(<StatementCheck cycle={cycle} accounts={accounts} onSaved={vi.fn()} />);
  expect(screen.queryByRole('article', { name: 'Cuadre' })).not.toBeInTheDocument();
  expect(mocks.statement).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Registrar multa recibida' })).toBeEnabled();
});
async function openForm(kind = 'Comparar extracto') {
  render(<StatementCheck cycle={cycle} accounts={accounts} onSaved={vi.fn()} />);
  await screen.findByRole('button', { name: kind }); fireEvent.click(screen.getByRole('button', { name: kind }));
  fireEvent.change(screen.getByLabelText('Fecha del registro'), { target: { value: '2026-09-30' } });
  fireEvent.change(screen.getByLabelText(kind === 'Comparar extracto' ? 'Saldo del extracto' : 'Valor de la multa'), { target: { value: '1.200' } });
}
it('cancel records neither a statement nor a fine', async () => { await openForm(); fireEvent.click(screen.getByRole('button', { name: 'Cancelar' })); expect(mocks.record).not.toHaveBeenCalled(); expect(mocks.fine).not.toHaveBeenCalled(); });
it('single in-flight statement persists without restoring the removed comparison', async () => {
  let resolve!: (v: unknown) => void; mocks.record.mockReturnValue(new Promise(r => { resolve = r; })); await openForm();
  fireEvent.click(screen.getByRole('button', { name: 'Guardar registro' })); expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled(); expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled(); expect(mocks.record).toHaveBeenCalledTimes(1);
  resolve({}); await screen.findByText('Registro guardado y consultado nuevamente en la base de datos.'); expect(mocks.statement).not.toHaveBeenCalled(); expect(screen.queryByRole('article', { name: 'Cuadre' })).not.toBeInTheDocument(); expect(mocks.record.mock.calls[0][0]).toMatchObject({ bankId: 'synthetic-bank', date: '2026-09-30', amount: '1200.00' });
});
it('fine is explicitly routed through the administrator RPC', async () => {
  await openForm('Registrar multa recibida'); fireEvent.change(screen.getByLabelText('Motivo de la multa'), { target: { value: 'Incumplimiento sintético' } }); fireEvent.click(screen.getByRole('button', { name: 'Guardar registro' }));
  await waitFor(() => expect(mocks.fine).toHaveBeenCalledTimes(1)); expect(mocks.record).not.toHaveBeenCalled();
});
it('negative amount is rejected before RPC', async () => { await openForm(); fireEvent.change(screen.getByLabelText('Saldo del extracto'), { target: { value: '-10' } }); fireEvent.click(screen.getByRole('button', { name: 'Guardar registro' })); expect(mocks.record).not.toHaveBeenCalled(); });
it('unknown transport failure keeps the same idempotency key for retry', async () => {
  mocks.record.mockRejectedValueOnce(new TypeError('Failed to fetch')); await openForm(); fireEvent.click(screen.getByRole('button', { name: 'Guardar registro' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Guardar registro' })).toBeEnabled()); const key = mocks.record.mock.calls[0][0].key;
  fireEvent.click(screen.getByRole('button', { name: 'Guardar registro' })); await waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(2)); expect(mocks.record.mock.calls[1][0].key).toBe(key);
});
it('stale quote is rejected and a fresh quote can be confirmed', async () => {
  mocks.preview.mockResolvedValueOnce({ state: 'ready', preview_hash: 'old', operations: [] }).mockResolvedValueOnce({ state: 'ready', preview_hash: 'new', operations: [] });
  mocks.confirm.mockRejectedValueOnce(Object.assign(new Error('La conciliacion cambio; vuelva a previsualizar.'), { code: 'P0001' })).mockResolvedValueOnce({});
  render(<StatementCheck cycle={cycle} accounts={accounts} onSaved={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Revisar saldo inicial' })); await screen.findByRole('button', { name: 'Confirmar revisión del saldo inicial' });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar revisión del saldo inicial' })); await screen.findByText(/Los saldos cambiaron/);
  fireEvent.click(screen.getByRole('button', { name: 'Revisar saldo inicial' })); await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar revisión del saldo inicial' })); await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(2)); expect(mocks.confirm.mock.calls[1][2]).toBe('new');
});
