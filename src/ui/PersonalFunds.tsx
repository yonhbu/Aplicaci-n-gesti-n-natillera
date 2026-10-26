import { useRef, useState, type ReactNode } from 'react';
import { supabase } from '../lib/supabase';
import type { BankAccount, Cycle, FinancialOperation } from '../lib/types';
import { formatCop, parseCop, toDatabaseMoney } from '../domain/money';
import { userSafeError } from '../lib/userMessages';
import { clearPendingFinancialOperation, getOrCreatePendingFinancialOperation } from '../lib/pendingFinancialOperationStorage';

export function PersonalFunds({ cycle, accounts, operations, today, onSaved, undo }: {
  cycle: Cycle; accounts: BankAccount[]; operations: FinancialOperation[]; today: string; onSaved: () => Promise<void>; undo: (id: string) => ReactNode;
}) {
  const [direction, setDirection] = useState('in'), [bank, setBank] = useState(accounts[0]?.id ?? '');
  const [date, setDate] = useState(''), [amount, setAmount] = useState(''), [reference, setReference] = useState(''), [note, setNote] = useState('');
  const [verified, setVerified] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const inFlight = useRef(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); if (inFlight.current || !verified) return;
    const scope = 'personal-funds:' + cycle.id;
    try {
      const value = parseCop(amount); if (!value.gt(0)) throw Error('Indica un importe mayor que cero.');
      const payload = { p_cycle_id: cycle.id, p_bank_account_id: bank, p_effective_date: date, p_amount: toDatabaseMoney(value), p_direction: direction, p_reference: reference.trim(), p_note: note.trim(), p_verified: verified };
      inFlight.current = true; setBusy(true); setMessage('');
      const pending = getOrCreatePendingFinancialOperation(scope, payload, () => 'ui-' + crypto.randomUUID());
      const { error } = await supabase.rpc('record_personal_funds', { ...payload, p_idempotency_key: pending.idempotencyKey });
      if (error) throw Object.assign(new Error(error.message), { code: error.code });
      clearPendingFinancialOperation(scope); await onSaved();
      setDate(''); setAmount(''); setReference(''); setNote(''); setVerified(false); setMessage('Movimiento personal guardado. El dinero de la natillera no cambió.');
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && /^(P0001|22|23|40|42501|PGRST)/.test(String(error.code))) clearPendingFinancialOperation(scope);
      setMessage(userSafeError(error));
    } finally { inFlight.current = false; setBusy(false); }
  }
  return <details className="home-card personal-funds"><summary>Dinero personal en la cuenta</summary>
    <p>Solo registra tus movimientos personales documentados. Se separan de los fondos de la natillera y no quedan disponibles para préstamos o pagos de socios.</p>
    <form className="sheet-form" onSubmit={event => void save(event)} aria-label="Registrar movimiento personal">
      <label>Movimiento personal<select value={direction} onChange={event => setDirection(event.target.value)} disabled={busy}><option value="in">Entrada personal</option><option value="out">Devolución personal</option></select></label>
      <label>Cuenta del movimiento personal<select required value={bank} onChange={event => setBank(event.target.value)} disabled={busy}><option value="">Selecciona una cuenta</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.display_name}</option>)}</select></label>
      <label>Fecha del movimiento personal<input type="date" min={cycle.starts_on} max={today < cycle.closes_on ? today : cycle.closes_on} required value={date} onChange={event => setDate(event.target.value)} disabled={busy} /></label>
      <label>Importe personal<input inputMode="decimal" required value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} /></label>
      <label>Referencia personal<input required value={reference} onChange={event => setReference(event.target.value)} disabled={busy} /></label>
      <label>Motivo del movimiento personal<input required value={note} onChange={event => setNote(event.target.value)} disabled={busy} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} disabled={busy} />Verifiqué el movimiento y que no está registrado antes.</label>
      <button type="submit" disabled={busy || !verified || !bank}>{busy ? 'Guardando…' : 'Guardar movimiento personal'}</button>
    </form>
    {message ? <p role="status">{message}</p> : null}
    <ul className="row-list">{operations.filter(operation => operation.operation_type.startsWith('personal_funds_')).map(operation => <li key={operation.id}><div className="row-static"><span className="row-main"><strong>{operation.operation_type === 'personal_funds_received' ? 'Entrada personal' : 'Devolución personal'} · {formatCop(String(operation.payload.amount ?? 0), 2)}</strong><span className="row-sub">{operation.effective_date} · {String(operation.payload.reference ?? '')}{operations.some(item => item.reverses_operation_id === operation.id) ? ' · Anulado' : ''}</span></span>{undo(operation.id)}</div></li>)}</ul>
  </details>;
}
