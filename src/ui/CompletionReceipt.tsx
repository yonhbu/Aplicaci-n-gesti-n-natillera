import { CopInput } from './CopInput';
import { useRef, useState } from 'react';
import type { BankAccount } from '../lib/types';
import type { SettlementPreview } from '../data/blockC';
import { recordSettlementCompletion } from '../data/reconciliation';
import { clearPendingFinancialOperation, getOrCreatePendingFinancialOperation } from '../lib/pendingFinancialOperationStorage';
import { formatCop, parseCop, toDatabaseMoney } from '../domain/money';
import { userSafeError } from '../lib/userMessages';
import Decimal from 'decimal.js';

export function CompletionReceipt({ preview, inputs, accounts, today, onSaved, onBusy }: {
  preview: SettlementPreview; inputs: { cycleMemberId: string; cutDate: string; annualAdminFee: string; penaltyAmount: string; otherDiscounts: string };
  accounts: BankAccount[]; today: string; onSaved: () => Promise<void>; onBusy: (busy: boolean) => void;
}) {
  const [open, setOpen] = useState(false), [amount, setAmount] = useState(''), [date, setDate] = useState('');
  const [bank, setBank] = useState(accounts[0]?.id ?? ''), [reference, setReference] = useState('');
  const [location, setLocation] = useState<'bank' | 'cash'>(accounts.length ? 'bank' : 'cash');
  const [verified, setVerified] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const inFlight = useRef(false);
  const valid = (() => { try { return parseCop(amount).gt(0) && (location === 'cash' || !!bank) && !!date && date <= today && date <= inputs.cutDate && !!reference.trim() && verified; } catch { return false; } })();
  async function save() {
    if (!valid || inFlight.current) return;
    inFlight.current = true; setBusy(true); onBusy(true); setError('');
    const scope = 'settlement:completion:' + inputs.cycleMemberId;
    try {
      const payload = { ...inputs, receivedDate: date, amount: toDatabaseMoney(parseCop(amount)), bankId: location === 'bank' ? bank : null, reference: reference.trim(), previewHash: preview.preview_hash };
      const pending = getOrCreatePendingFinancialOperation(scope, payload, () => 'ui-' + crypto.randomUUID());
      await recordSettlementCompletion({ ...payload, key: pending.idempotencyKey });
      clearPendingFinancialOperation(scope);
      await onSaved();
      setOpen(false); setAmount(''); setDate(''); setReference(''); setVerified(false);
    } catch (failure) {
      if (typeof failure === 'object' && failure && 'code' in failure && /^(P0001|22|23|40|42501|PGRST)/.test(String(failure.code))) clearPendingFinancialOperation(scope);
      setError(userSafeError(failure));
    } finally { inFlight.current = false; setBusy(false); onBusy(false); }
  }
  if (!new Decimal(preview.net).isNegative()) return null;
  return <section className="completion-receipt" aria-label="Completar cuenta final">
    <p>Falta completar {formatCop(new Decimal(preview.net).abs(), 2)}. Registra únicamente dinero recibido y verificado; no será un aporte mensual ni otro cobro de préstamo.</p>
    {!open ? <button type="button" className="button button-quiet" onClick={() => setOpen(true)}>Registrar pago para completar la cuenta final</button> : <div className="sheet-form">
      <label>Dónde se recibió<select value={location} onChange={event => setLocation(event.target.value as 'bank' | 'cash')} disabled={busy}><option value="bank" disabled={!accounts.length}>Banco</option><option value="cash">Efectivo</option></select></label>
      <label>Importe recibido<CopInput inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} /></label>
      <label>Fecha real de la consignación<input type="date" max={inputs.cutDate < today ? inputs.cutDate : today} value={date} onChange={event => setDate(event.target.value)} disabled={busy} /></label>
      {location === 'bank' ? <label>Cuenta que recibió el dinero<select value={bank} onChange={event => setBank(event.target.value)} disabled={busy}>{accounts.map(account => <option key={account.id} value={account.id}>{account.display_name}</option>)}</select></label> : null}
      <label>Referencia de la consignación<input value={reference} onChange={event => setReference(event.target.value)} disabled={busy} /></label>
      <label className="checkbox-label"><input type="checkbox" checked={verified} onChange={event => setVerified(event.target.checked)} disabled={busy} />Verifiqué que este dinero ingresó y no está registrado en otra operación.</label>
      <p>Si recibiste más del faltante, el excedente queda a favor del socio con sus centavos completos.</p>
      <button type="button" className="button" disabled={busy || !valid} onClick={() => void save()}>{busy ? 'Guardando…' : 'Guardar consignación y recalcular'}</button>
      <button type="button" disabled={busy} onClick={() => { setOpen(false); setError(''); }}>Cancelar consignación</button>
    </div>}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
