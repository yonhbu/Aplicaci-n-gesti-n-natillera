import { useState } from 'react';
import type { BankAccount, FinancialOperation, LedgerEntry } from '../lib/types';
import { bankPosition } from '../domain/bankPosition';
import { formatCop } from '../domain/money';
import { displayDate } from './displayDate';

const labels: Record<string, string> = {
  savings_contribution_linked: 'Ahorro recibido', legacy_opening: 'Registro inicial de ahorro',
  loan_disbursement: 'Préstamo entregado', loan_payment: 'Cobro de préstamo', loan_prepayment: 'Pago anticipado de préstamo',
  bank_interest_received: 'Intereses ganados en Pibank', bank_fee: 'Cobro del banco', liquidity_transfer: 'Cambio de ubicación del dinero',
  cash_location_corrected: 'Corrección de ubicación de un cobro', legacy_loan_cash_correction: 'Ajuste de préstamos anteriores a la app',
  polla_contribution: 'Aporte de polla', polla_prize_paid: 'Premio entregado', admin_fine_received: 'Multa del administrador',
  admin_withdrawal: 'Retiro del administrador', member_settlement_paid: 'Pago de cuenta final',
  member_settlement_completion: 'Consignación para completar cuenta final', manual_income: 'Dinero recibido', manual_expense: 'Dinero entregado',
  bank_opening: 'Saldo inicial del banco', bank_external_financing: 'Financiación recibida', loan_profit_distribution_paid: 'Ganancia entregada',
};
export function BankPositionCard({ accounts, operations, entries, cutDate }: {
  accounts: BankAccount[]; operations: FinancialOperation[]; entries: LedgerEntry[]; cutDate: string;
}) {
  const preferred = accounts.find(account => /pibank/i.test(account.display_name + ' ' + account.institution_name)) ?? accounts[0];
  const [selected, setSelected] = useState('');
  const account = accounts.find(item => item.id === selected) ?? preferred;
  if (!account) return <article className="home-card"><h3>Dinero de la natillera en el banco</h3><p>Registra una cuenta y asigna los movimientos para calcular su saldo.</p></article>;
  const position = bankPosition(operations, entries, account.id, cutDate);
  return <article className="home-card bank-position" aria-label="Dinero de la natillera en el banco">
    <h3>Dinero de la natillera en {account.display_name}</h3>
    <p className="muted">Movimientos registrados hasta {displayDate(cutDate)}.</p>
    {accounts.length > 1 ? <label>Cuenta del resumen<select value={account.id} onChange={event => setSelected(event.target.value)}>{accounts.map(item => <option key={item.id} value={item.id}>{item.display_name}</option>)}</select></label> : null}
    <dl className="statement-figures">
      <div><dt>Dinero sin rendimientos bancarios</dt><dd>{formatCop(position.base, 2)}</dd></div>
      <div><dt>Intereses bancarios recibidos</dt><dd>{formatCop(position.interest, 2)}</dd></div>
      <div><dt>Total que debería haber en la cuenta</dt><dd>{formatCop(position.balance, 2)}</dd></div>
    </dl>
    <small>Los intereses ya están incluidos en el total.</small>
    {!position.personal.isZero() ? <dl className="statement-figures"><div><dt>Dinero personal documentado, separado de la natillera</dt><dd>{formatCop(position.personal, 2)}</dd></div><div><dt>Total registrado en esta cuenta, incluidos fondos personales</dt><dd>{formatCop(position.balance.plus(position.personal), 2)}</dd></div></dl> : null}
    <details><summary>Ver movimientos que forman este saldo</summary>
      {position.rows.length ? <ul className="row-list">{position.rows.map(({ operation, amount, kind }) => <li key={operation.id}>
        <div className="row-static"><span className="row-main"><strong>{operation.reverses_operation_id ? 'Anulación · ' : ''}{labels[kind] ?? 'Movimiento bancario'}</strong><span className="row-sub">{displayDate(operation.effective_date)}{typeof operation.payload?.reference === 'string' ? ' · ' + operation.payload.reference : ''}</span></span><span className="row-amount">{formatCop(amount, 2)}</span></div>
      </li>)}</ul> : <p>No hay movimientos en esta cuenta hasta el corte.</p>}
    </details>
  </article>;
}

export function BankInterestHistory({ accounts, operations, entries, cutDate, onMovements }: {
  accounts: BankAccount[]; operations: FinancialOperation[]; entries: LedgerEntry[]; cutDate: string; onMovements: () => void;
}) {
  const rows = accounts.flatMap(account => bankPosition(operations, entries, account.id, cutDate).rows
    .filter(row => row.kind === 'bank_interest_received').map(row => ({ ...row, account })))
    .sort((a,b) => b.operation.effective_date.localeCompare(a.operation.effective_date));
  return <section className="list-card bank-interest-history" aria-labelledby="abonos-pibank-titulo">
    <div className="card-head"><h3 id="abonos-pibank-titulo">Abonos Pibank recibidos</h3><button type="button" className="link-button" onClick={onMovements}>Ver movimientos</button></div>
    <p className="muted">Hasta {displayDate(cutDate)}. Ya están incluidos en el saldo del banco.</p>
    {rows.length ? <ul className="row-list">{rows.map(({ operation, amount, account }) => <li key={operation.id + account.id}><div className="row-static"><span className="row-main"><strong>{operation.reverses_operation_id ? 'Anulación de abono' : 'Abono recibido'} · {displayDate(operation.effective_date)}</strong><span className="row-sub">{account.display_name}{typeof operation.payload?.reference === 'string' ? ' · ' + operation.payload.reference : ''}</span></span><strong className="row-amount">{formatCop(amount,2)}</strong></div></li>)}</ul> : <p className="muted">No hay abonos recibidos hasta esta fecha.</p>}
  </section>;
}
