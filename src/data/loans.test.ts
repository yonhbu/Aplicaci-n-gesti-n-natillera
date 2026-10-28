import { beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));
import { confirmLoanPrepayment, recordLoanPayment } from './loans';
beforeEach(() => { rpc.mockReset().mockResolvedValue({ data: { id: 'synthetic-payment' }, error: null }); });
const receipt = { loanId: 'loan', idempotencyKey: 'same-key', paymentDate: '2026-10-26', amount: '200000.00', capitalAmount: '200000.00', interestAmount: '0.00', kind: 'regular' as const };
it('usa RPC atómica con nota y destino sin alterar importes', async () => {
  await recordLoanPayment({ ...receipt, bankAccountId: 'bank', note: 'Abono al capital' });
  expect(rpc).toHaveBeenCalledWith('record_noted_loan_payment', expect.objectContaining({ p_bank_account_id: 'bank', p_note: 'Abono al capital', p_capital_amount: '200000.00', p_amount: '200000.00', p_interest_amount: '0.00', p_idempotency_key: 'same-key' }));
});
it('mantiene reintentos anteriores sin nota en su RPC original', async () => {
  await recordLoanPayment(receipt);
  expect(rpc.mock.calls[0][0]).toBe('record_loan_payment');
  expect(rpc.mock.calls[0][1]).not.toHaveProperty('p_note');
  await recordLoanPayment({ ...receipt, bankAccountId: null });
  expect(rpc.mock.calls[1][0]).toBe('record_located_loan_payment');
});
it('pago total usa hash y nota sin enviar importes de pantalla', async () => {
  await confirmLoanPrepayment('loan', '2026-10-26', 'same-key', 'quote-hash', null, 'Cancelación');
  expect(rpc).toHaveBeenCalledWith('confirm_noted_loan_prepayment', { p_loan_id: 'loan', p_payment_date: '2026-10-26', p_idempotency_key: 'same-key', p_quote_hash: 'quote-hash', p_bank_account_id: null, p_note: 'Cancelación' });
});
it('propaga rechazos SQL sin simular confirmación', async () => {
  rpc.mockResolvedValue({ data: null, error: { message: 'No tiene permiso sobre este prestamo.' } });
  await expect(recordLoanPayment({ ...receipt, note: null })).rejects.toThrow('No tiene permiso');
});
it.each(['payment', 'prepayment'])('explica la migración pendiente en %s sin fallback ni pérdida de nota', async kind => {
  rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Function not found in schema cache' } });
  const result = kind === 'payment'
    ? recordLoanPayment({ ...receipt, note: 'Nota que no se debe perder' })
    : confirmLoanPrepayment('loan', '2026-10-26', 'same-key', 'quote-hash', null, 'Nota que no se debe perder');
  await expect(result).rejects.toThrow('Requiere la migración 20261108000100');
  expect(rpc).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0][1].p_note).toBe('Nota que no se debe perder');
});
