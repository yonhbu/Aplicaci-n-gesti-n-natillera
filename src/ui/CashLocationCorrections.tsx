import { useRef, useState } from 'react';
import Decimal from 'decimal.js';
import type { BankAccount, FinancialOperation, LedgerEntry } from '../lib/types';
import { annulCashLoanLocation, correctCashLoanLocation } from '../data/reconciliation';
import { clearPendingFinancialOperation, getOrCreatePendingFinancialOperation } from '../lib/pendingFinancialOperationStorage';
import { formatCop } from '../domain/money';
import { userSafeError } from '../lib/userMessages';

export function CashLocationCorrections({ accounts, operations, entries, onSaved }: {
  accounts: BankAccount[]; operations: FinancialOperation[]; entries: LedgerEntry[]; onSaved: () => Promise<void>;
}) {
  const [bank, setBank] = useState(accounts[0]?.id ?? ''), [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [verified, setVerified] = useState(false);
  const inFlight = useRef(false);
  const rows = operations.filter(operation => ['loan_payment', 'loan_prepayment'].includes(operation.operation_type)).map(operation => {
    const cash = entries.filter(entry => entry.operation_id === operation.id && entry.account === 'cash');
    const amount = cash.reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0));
    const corrections = operations.filter(item => item.operation_type === 'cash_location_corrected' && item.payload.root_operation_id === operation.id && !operations.some(undo => undo.reverses_operation_id === item.id));
    return { operation, amount, corrections, reversed: operations.some(item => item.reverses_operation_id === operation.id), eligible: cash.length > 0 && cash.every(entry => entry.liquidity_location === 'cash') && amount.gt(0) };
  }).filter(row => row.eligible);
  async function run(id: string, undo: boolean) {
    if (inFlight.current || !bank || !reason.trim() || !verified) return;
    inFlight.current = true; setBusy(true); setMessage('');
    const scope = 'cash-location:' + id + ':' + undo;
    try {
      const payload = { operationId: id, bankId: undo ? null : bank, reason: reason.trim(), undo };
      const pending = getOrCreatePendingFinancialOperation(scope, payload, () => 'ui-' + crypto.randomUUID());
      if (undo) await annulCashLoanLocation(id, pending.idempotencyKey, payload.reason);
      else await correctCashLoanLocation(id, bank, pending.idempotencyKey, payload.reason);
      clearPendingFinancialOperation(scope);
      await onSaved();
      setMessage('Ubicación guardada y saldos consultados nuevamente. No se creó otro cobro.');
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && /^(P0001|22|23|40|42501|PGRST)/.test(String(error.code))) clearPendingFinancialOperation(scope);
      setMessage(userSafeError(error));
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (!rows.length) return null;
  return <details className="home-card"><summary>Corregir cobros ubicados como efectivo</summary>
    <p>Usa esta corrección solo cuando el cobro entró directamente al banco. Conserva el pago, sus aplicaciones y las anulaciones con sus fechas. No representa un traslado de efectivo que ocurrió hoy.</p>
    <label>Banco donde ingresó<select value={bank} onChange={event => setBank(event.target.value)} disabled={busy}>{accounts.map(account => <option key={account.id} value={account.id}>{account.display_name}</option>)}</select></label>
    <label>Evidencia y motivo de la corrección<input value={reason} onChange={event => setReason(event.target.value)} disabled={busy} /></label>
    <label className="checkbox-label"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} disabled={busy} />Confirmo la ubicación real del cobro seleccionado.</label>
    <ul className="row-list">{rows.map(({ operation, amount, corrections, reversed }) => <li key={operation.id}><div className="sheet-form">
      <strong>{operation.effective_date} · {formatCop(amount, 2)}{reversed ? ' · cobro anulado' : ''}</strong>
      <small>Referencia {operation.id.slice(0, 8)}{corrections.length ? ' · ubicación corregida' : ' · figura en efectivo'}</small>
      <button type="button" disabled={busy || !bank || !reason.trim() || !verified} onClick={() => void run(operation.id, corrections.length > 0)}>{corrections.length ? 'Anular corrección de ubicación' : 'Corregir ubicación a banco'}</button>
    </div></li>)}</ul>
    {message ? <p role="status">{message}</p> : null}
  </details>;
}
