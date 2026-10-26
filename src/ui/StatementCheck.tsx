import { useRef, useState } from 'react';
import type { BankAccount, Cycle } from '../lib/types';
import { formatCop, parseCop, toDatabaseMoney } from '../domain/money';
import { confirmReconciliation, previewReconciliation, recordFine, recordStatement, reverseReconciliation } from '../data/reconciliation';
import { userSafeError } from '../lib/userMessages';
import { clearPendingFinancialOperation, getOrCreatePendingFinancialOperation } from '../lib/pendingFinancialOperationStorage';
const balanceNames: Record<string, string> = { cash: 'Dinero disponible', loans_receivable: 'Por cobrar (préstamos)', savings_liability: 'Ahorro de los socios', admin_payable: 'Mi ganancia como administrador', member_loan_profit_fund: 'Ganancia de préstamos', common_income: 'Ingresos comunes', legacy_migration_equity: 'Ajuste de préstamos anteriores a la app', bank_opening_equity: 'Saldo inicial del banco', prizes_payable: 'Premios por entregar', polla_pool: 'Fondo de polla', bank_interest_income: 'Intereses ganados en Pibank', settlement_completion_liability: 'Consignaciones para completar cuentas finales' };

export function StatementCheck({ cycle, accounts = [], onSaved }: { cycle: Cycle; accounts?: BankAccount[]; onSaved?: () => Promise<void> }) {
  const [form, setForm] = useState<'statement' | 'fine' | null>(null);
  const [bank, setBank] = useState(accounts[0]?.id ?? '');
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [message, setMessage] = useState('');
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof previewReconciliation>> | null>(null);
  const [detail, setDetail] = useState(false);
  const [reverseReason, setReverseReason] = useState('');
  const changed = () => { setQuote(null); setMessage(''); };
  async function run(scope: string, payload: Record<string, unknown>, action: (key: string) => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setMessage('');
    try {
      const pending = getOrCreatePendingFinancialOperation(scope, payload, () => `ui-${crypto.randomUUID()}`);
      await action(pending.idempotencyKey);
      clearPendingFinancialOperation(scope);
      setForm(null); setQuote(null);
      await onSaved?.();
      setMessage('Registro guardado y consultado nuevamente en la base de datos.');
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && /^(P0001|22|23|40|42501|PGRST)/.test(String(error.code))) clearPendingFinancialOperation(scope);
      setMessage(userSafeError(error));
    }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className="statement-area">
    {onSaved && accounts.length ? <div className="statement-tools">
      <button type="button" disabled={busy} onClick={() => { changed(); setForm('statement'); }}>Comparar extracto</button>
      <button type="button" disabled={busy} onClick={() => { changed(); setForm('fine'); }}>Registrar multa recibida</button>
      <button type="button" disabled={busy} onClick={async () => {
        if (inFlight.current) return;
        inFlight.current = true; setBusy(true); changed();
        try { setQuote(await previewReconciliation(cycle.id)); } catch (error) { setMessage(userSafeError(error)); }
        finally { inFlight.current = false; setBusy(false); }
      }}>Revisar saldo inicial</button>
    </div> : null}
    {form ? <form className="panel sheet-form" aria-label={form === 'statement' ? 'Comparar extracto' : 'Registrar multa recibida'} onSubmit={event => {
      event.preventDefault();
      try {
        const parsed = parseCop(amount, 'monto');
        if (parsed.lt(0) || (form === 'fine' && parsed.eq(0))) throw new Error('Revisa el monto.');
        const payload = { cycleId: cycle.id, bankId: bank, date, amount: toDatabaseMoney(parsed), note: note.trim() };
        void run(`phasea:${form}:${cycle.id}`, payload, key => form === 'statement' ? recordStatement({ ...payload, key }) : recordFine({ ...payload, key }));
      } catch (error) { setMessage(userSafeError(error)); }
    }}>
      <h3>{form === 'statement' ? 'Comparar extracto' : 'Registrar multa recibida'}</h3>
      {form === 'fine' ? <p>Solo registra multas ya recibidas. El 100 % se reconoce al fondo del administrador y entra al banco elegido.</p> : <p>Conserva la comparación anterior. No registra ingresos ni ajustes.</p>}
      <label>Cuenta del registro<select value={bank} onChange={e => setBank(e.target.value)} required disabled={busy}><option value="">Selecciona una cuenta</option>{accounts.map(a => <option key={a.id} value={a.id}>{a.display_name}</option>)}</select></label>
      <label>Fecha del registro<input type="date" required value={date} onChange={e => setDate(e.target.value)} disabled={busy} /></label>
      <label>{form === 'statement' ? 'Saldo del extracto' : 'Valor de la multa'}<input required inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} disabled={busy} /></label>
      <label>{form === 'statement' ? 'Nota de la comparación' : 'Motivo de la multa'}<textarea required={form === 'fine'} value={note} onChange={e => setNote(e.target.value)} disabled={busy} /></label>
      <div className="statement-tools"><button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar registro'}</button><button type="button" disabled={busy} onClick={() => setForm(null)}>Cancelar</button></div>
    </form> : null}
    {quote ? <section className="panel" aria-label="Previsualización de conciliación">
      <h3>Revisión del saldo inicial</h3>
      {quote.state !== 'ready' ? <p>{quote.state === 'applied' ? 'Esta conciliación ya está aplicada.' : 'Esta conciliación fue revertida y requiere revisión antes de volver a aplicarla.'}</p> : <>
        <p>Intereses anteriores: {formatCop(quote.historic_interest ?? 0)} · Corrección de caja: {formatCop(quote.net_cash_correction ?? 0)} · Multas al administrador: {formatCop(quote.fines ?? 0)}</p>
        <p>Son {quote.operations?.length} operaciones. No crea pagos de préstamos. Los intereses anteriores usan el vencimiento como fecha de reconocimiento, sin afirmar una fecha real de cobro.</p>
        <button type="button" onClick={() => setDetail(!detail)} aria-expanded={detail}>Ver operaciones y saldos</button>
        {detail ? <div className="statement-details"><ol>{quote.operations?.map((o, i) => <li key={i}>{o.part === 'A1' ? 'Interés anterior' : o.part === 'A2' ? 'Caja de préstamo' : 'Multas'} · {String(o.payload.loan_code ?? '')} · {o.date} · {formatCop(String(o.payload.interest ?? o.payload.net_cash ?? o.payload.amount ?? 0))}</li>)}</ol>
          <h4>Saldos antes y después</h4><p>Se muestran los saldos contables con su signo.</p>
          <dl className="statement-figures">{quote.after?.map((row, i) => <div key={i}><dt>{balanceNames[row.account] ?? 'Otro saldo'}{row.account === 'cash' ? ` · ${row.liquidity_location === 'bank' ? 'banco' : row.liquidity_location === 'cash' ? 'efectivo' : 'sin ubicar'}` : ''}</dt><dd>{formatCop(quote.before?.find(b => b.account === row.account && b.liquidity_location === row.liquidity_location && b.bank_account_id === row.bank_account_id)?.amount ?? 0, 2)} → {formatCop(row.amount, 2)}</dd></div>)}</dl></div> : null}
        <button type="button" disabled={busy} onClick={() => { if (quote.preview_hash) void run(`phasea:reconcile:${cycle.id}`, { hash: quote.preview_hash }, key => confirmReconciliation(cycle.id, key, quote.preview_hash!)); }}>{busy ? 'Confirmando…' : 'Confirmar revisión del saldo inicial'}</button>
      </>}
      {quote.state === 'applied' ? <div className="sheet-form"><p>La anulación completa restituye las partidas anteriores con sus fechas originales. Se bloqueará si hay operaciones dependientes.</p><label>Motivo para revertir conciliación<input value={reverseReason} onChange={e => setReverseReason(e.target.value)} disabled={busy} /></label><button type="button" disabled={busy || !reverseReason.trim()} onClick={() => void run(`phasea:reverse:${cycle.id}`, { reason: reverseReason.trim() }, key => reverseReconciliation(cycle.id, key, reverseReason.trim()))}>Anular conciliación completa</button></div> : null}
      <button type="button" disabled={busy} onClick={() => setQuote(null)}>Cerrar revisión</button>
    </section> : null}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
