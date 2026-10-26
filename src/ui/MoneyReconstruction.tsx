import type { FinancialOperation, LedgerEntry } from '../lib/types';
import { moneyConcepts, reconstructMoney } from '../domain/financialReconstruction';
import { formatCop } from '../domain/money';
import { displayDate } from './displayDate';

const names: Record<string, string> = {
  savings_liability: 'Ahorro de los socios, incluidos premios acreditados', polla_pool: 'Polla pendiente de jugar',
  prizes_payable: 'Premios por entregar', admin_payable: 'Mi ganancia como administrador',
  member_loan_profit_fund: 'Ganancia de préstamos de los socios', bank_interest_income: 'Rendimientos bancarios por asignar',
  settlements_payable: 'Derechos de socios con cuenta final', utility_distribution_payable: 'Ganancias pendientes de entrega',
  settlement_completion_liability: 'Pagos para completar cuentas finales', personal_funds_payable: 'Dinero personal por devolver',
  bank_opening_equity: 'Saldo inicial documentado', legacy_migration_equity: 'Contrapartida del corte consolidado',
  common_income: 'Otros ingresos', common_expense: 'Gastos comunes', savings_yield_expense: 'Rendimiento reconocido al ahorro',
  bank_fee_expense: 'Gastos bancarios', settlement_policy_pending: 'Partidas pendientes de clasificación', liquidity_reserve: 'Reserva de dinero',
};
export function MoneyReconstruction({ operations, entries, cutDate }: { operations: FinancialOperation[]; entries: LedgerEntry[]; cutDate: string }) {
  const position = reconstructMoney(operations, entries, cutDate);
  return <details className="home-card money-reconstruction">
    <summary>Cómo se calcula el dinero al {displayDate(cutDate)}</summary>
    <dl className="statement-figures">
      <div><dt>Banco de la natillera</dt><dd>{formatCop(position.bank, 2)}</dd></div>
      <div><dt>Efectivo</dt><dd>{formatCop(position.physicalCash, 2)}</dd></div>
      <div><dt>Sin asignar a banco o efectivo</dt><dd>{formatCop(position.unknown, 2)}</dd></div>
      <div><dt>Dinero disponible</dt><dd>{formatCop(position.cash, 2)}</dd></div>
    </dl>
    <details><summary>Entradas y salidas por concepto</summary>
      <dl className="statement-figures">{[...position.concepts].filter(([, amount]) => !amount.isZero()).map(([kind, amount]) => <div key={kind}><dt>{moneyConcepts[kind] ?? 'Otros movimientos registrados'}</dt><dd>{formatCop(amount, 2)}</dd></div>)}</dl>
      <p>Las compensaciones y los movimientos entre fondos no crean entradas. Los ajustes del corte consolidado conservan su procedencia y fecha contable.</p>
    </details>
    <details><summary>Operaciones y saldo acumulado</summary>
      <p>Las fechas son las registradas. Un corte consolidado no demuestra cuándo ocurrió cada cobro anterior.</p>
      <ol className="row-list">{position.rows.map(row => <li key={row.operation.id}>
        <div className="row-static"><span className="row-main"><strong>{row.operation.reverses_operation_id ? 'Anulación · ' : ''}{row.concept}</strong>
          <span className="row-sub">{displayDate(row.operation.effective_date)} · {row.provenance}</span>
          <span className="row-sub">Movimiento: {formatCop(row.cash, 2)} · Acumulado: {formatCop(row.cumulative, 2)}</span>
          {row.kind === 'loan_payment' || row.kind === 'loan_prepayment' ? <span className="row-sub">Capital recuperado {formatCop(row.capitalRecovered, 2)} · interés cobrado {formatCop(row.interestCollected, 2)}</span> : null}
          <span className="row-sub">Operación {row.operation.id}</span>
        </span></div>
      </li>)}</ol>
    </details>
    <details><summary>Activos y derechos al mismo corte</summary>
      <dl className="statement-figures">
        <div><dt>Dinero disponible + capital por cobrar + fondos personales separados</dt><dd>{formatCop(position.assets, 2)}</dd></div>
        {[...position.accounts].filter(([account, amount]) => !['cash', 'loans_receivable', 'personal_bank_cash'].includes(account) && !amount.isZero()).map(([account, amount]) => <div key={account}><dt>{names[account] ?? account}</dt><dd>{formatCop(amount.negated(), 2)}</dd></div>)}
        <div><dt>Total de derechos y contrapartidas</dt><dd>{formatCop(position.claims, 2)}</dd></div>
        <div><dt>Diferencia contable</dt><dd>{formatCop(position.accountingDifference, 2)}</dd></div>
      </dl>
      <p>La igualdad contable no verifica un extracto ni convierte las declaraciones del corte consolidado en comprobantes bancarios.</p>
      {position.orphanEntries || position.unbalancedOperations ? <p role="alert">Hay partidas incompletas que requieren revisión: {position.orphanEntries} sin operación y {position.unbalancedOperations} operaciones sin balance.</p> : null}
    </details>
  </details>;
}
