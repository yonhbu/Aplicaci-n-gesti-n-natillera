import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CompletionReceipt } from './CompletionReceipt';
import type { SettlementPreview } from '../data/blockC';
import type { BankAccount } from '../lib/types';
const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock('../data/reconciliation', () => ({ recordSettlementCompletion: mocks.save }));
const preview = { net: -67.28, preview_hash: 'synthetic-preview' } as SettlementPreview;
const inputs = { cycleMemberId: 'synthetic-member', cutDate: '2026-10-20', annualAdminFee: '0', penaltyAmount: '0', otherDiscounts: '0' };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mocks.save.mockResolvedValue({}); });
afterEach(cleanup);
function setup() {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(<CompletionReceipt preview={preview} inputs={inputs} accounts={[{ id: 'synthetic-bank', display_name: 'Banco sintético' } as BankAccount]} today="2026-10-20" onSaved={onSaved} onBusy={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Registrar pago para completar la cuenta final' }));
  return onSaved;
}
function fill() {
  fireEvent.change(screen.getByLabelText('Importe recibido'), { target: { value: '68' } });
  fireEvent.change(screen.getByLabelText('Fecha real de la consignación'), { target: { value: '2026-10-20' } });
  fireEvent.change(screen.getByLabelText('Referencia de la consignación'), { target: { value: 'Synthetic reference' } });
}
it('cancel never posts money', () => { setup(); fill(); fireEvent.click(screen.getByRole('button', { name: 'Cancelar consignación' })); expect(mocks.save).not.toHaveBeenCalled(); });
it('requires explicit verification of an actual receipt', () => { setup(); fill(); expect(screen.getByRole('button', { name: 'Guardar consignación y recalcular' })).toBeDisabled(); });
it('rejects future dates and negative or sub-cent amounts before posting', () => {
  setup(); fill(); fireEvent.click(screen.getByRole('checkbox'));
  for (const value of ['-1', '0', '0,001', 'abc']) {
    fireEvent.change(screen.getByLabelText('Importe recibido'), { target: { value } });
    expect(screen.getByRole('button', { name: 'Guardar consignación y recalcular' })).toBeDisabled();
  }
  fireEvent.change(screen.getByLabelText('Importe recibido'), { target: { value: '68' } });
  fireEvent.change(screen.getByLabelText('Fecha real de la consignación'), { target: { value: '2026-10-21' } });
  expect(screen.getByRole('button', { name: 'Guardar consignación y recalcular' })).toBeDisabled();
});
it('cash receipt works without a bank account and sends an explicit null bank', async () => {
  const onSaved = vi.fn().mockResolvedValue(undefined);
  render(<CompletionReceipt preview={preview} inputs={inputs} accounts={[]} today="2026-10-20" onSaved={onSaved} onBusy={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Registrar pago para completar la cuenta final' }));
  expect(screen.getByLabelText('Dónde se recibió')).toHaveValue('cash');
  expect(screen.queryByLabelText('Cuenta que recibió el dinero')).not.toBeInTheDocument();
  fill(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar consignación y recalcular' }));
  await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ amount: '68.00', bankId: null });
});
it('submits only once while awaiting the server and refreshes persisted data', async () => {
  let resolve!: (value: unknown) => void;
  mocks.save.mockReturnValue(new Promise(result => { resolve = result; }));
  const refreshed = setup(); fill(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar consignación y recalcular' }));
  expect(screen.getByRole('button', { name: 'Guardando…' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Cancelar consignación' })).toBeDisabled();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  resolve({}); await waitFor(() => expect(refreshed).toHaveBeenCalledTimes(1));
  expect(mocks.save.mock.calls[0][0]).toMatchObject({ amount: '68.00', receivedDate: '2026-10-20', reference: 'Synthetic reference', previewHash: 'synthetic-preview' });
});
it('keeps the same key after a lost response', async () => {
  mocks.save.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  setup(); fill(); fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Guardar consignación y recalcular' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Guardar consignación y recalcular' }));
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  expect(mocks.save.mock.calls[0][0].key).toBe(mocks.save.mock.calls[1][0].key);
});
