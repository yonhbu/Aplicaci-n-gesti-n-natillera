import Decimal from 'decimal.js';
import './money';
import type { FinancialOperation, LedgerEntry, LoanContract } from '../lib/types';

export const moneyConcepts: Record<string, string> = {
  savings_contribution_linked: 'Ahorros recibidos', legacy_opening: 'Saldos del corte consolidado',
  polla_contribution: 'Polla recibida', admin_fine_received: 'Multas recibidas',
  loan_disbursement: 'Préstamos entregados', loan_payment: 'Cobros de préstamos', loan_prepayment: 'Pagos anticipados de préstamos',
  bank_interest_received: 'Rendimientos Pibank recibidos', bank_fee: 'Gastos bancarios',
  admin_withdrawal: 'Retiros del administrador', member_settlement_paid: 'Cuentas finales pagadas',
  loan_profit_distribution_paid: 'Ganancias pagadas', polla_prize_paid: 'Premios entregados',
  liquidity_transfer: 'Mover entre banco y efectivo', cash_location_corrected: 'Corrección de ubicación',
  legacy_loan_cash_correction: 'Efecto de préstamos del corte consolidado',
  legacy_loan_interest_correction: 'Intereses del corte consolidado', legacy_fine_reclassification: 'Clasificación de multas',
  member_settlement_completion: 'Pagos para completar cuentas finales', bank_opening: 'Saldo inicial documentado',
  bank_external_financing: 'Financiación documentada', manual_income: 'Otros ingresos', manual_expense: 'Otros pagos',
  personal_funds_received: 'Dinero personal recibido', personal_funds_returned: 'Dinero personal devuelto',
};

export function validCutDate(value: string, start: string, end: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < start || value > end) return false;
  const date = new Date(value + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Descriptive original principal, including fully paid consolidated contracts with no opening receivable. Never added to cash. */
export function originalPrincipalAtCut(loans: LoanContract[], operations: FinancialOperation[], cutDate: string) {
  return loans.reduce((sum, loan) => {
    const disbursements = operations.filter(operation => operation.id === loan.disbursed_operation_id
      || !!loan.id && operation.operation_type === 'loan_disbursement' && operation.reference_table === 'loan_contracts' && operation.reference_id === loan.id);
    if (disbursements.length) {
      const received = disbursements.some(disbursement => disbursement.effective_date <= cutDate
        && !operations.some(operation => operation.reverses_operation_id === disbursement.id && operation.effective_date <= cutDate));
      return received ? sum.plus(loan.principal) : sum;
    }
    const declared = !!loan.legacy_id && ['active', 'paid'].includes(loan.status);
    return loan.start_date <= cutDate && (declared || !!loan.disbursed_operation_id) ? sum.plus(loan.principal) : sum;
  }, new Decimal(0));
}

/** One source: dated ledger entries. Entity tables explain provenance; never add their amounts again. */
export function reconstructMoney(operations: FinancialOperation[], entries: LedgerEntry[], cutDate: string) {
  const byId = new Map(operations.map(operation => [operation.id, operation]));
  const grouped = new Map<string, LedgerEntry[]>();
  const accounts = new Map<string, Decimal>();
  const banks = new Map<string, Decimal>();
  const personalBanks = new Map<string, Decimal>();
  let physicalCash = new Decimal(0), unknown = new Decimal(0);
  let orphanEntries = 0;
  for (const entry of entries) {
    const operation = byId.get(entry.operation_id);
    if (!operation) { orphanEntries++; continue; }
    if (operation.effective_date > cutDate) continue;
    const group = grouped.get(operation.id) ?? []; group.push(entry); grouped.set(operation.id, group);
    accounts.set(entry.account, (accounts.get(entry.account) ?? new Decimal(0)).plus(entry.amount));
    if (entry.account === 'personal_bank_cash') {
      const source = operation.reverses_operation_id ? byId.get(operation.reverses_operation_id) : operation;
      const bankId = source?.payload?.bank_account_id;
      if (typeof bankId === 'string') personalBanks.set(bankId, (personalBanks.get(bankId) ?? new Decimal(0)).plus(entry.amount));
    }
    if (entry.account !== 'cash') continue;
    if (entry.liquidity_location === 'bank' && entry.bank_account_id) banks.set(entry.bank_account_id, (banks.get(entry.bank_account_id) ?? new Decimal(0)).plus(entry.amount));
    else if (entry.liquidity_location === 'cash') physicalCash = physicalCash.plus(entry.amount);
    else unknown = unknown.plus(entry.amount);
  }
  let cumulative = new Decimal(0);
  const rows = [...grouped].map(([id, postings]) => {
    const operation = byId.get(id)!;
    const original = operation.reverses_operation_id ? byId.get(operation.reverses_operation_id) : undefined;
    const kind = original?.operation_type ?? operation.operation_type;
    const sum = (account: string) => postings.filter(entry => entry.account === account).reduce((total, entry) => total.plus(entry.amount), new Decimal(0));
    const cash = sum('cash');
    const receivable = sum('loans_receivable');
    const capitalRecovered = ['loan_payment', 'loan_prepayment'].includes(kind) ? receivable.negated() : new Decimal(0);
    const interestCollected = ['loan_payment', 'loan_prepayment'].includes(kind) ? cash.minus(capitalRecovered) : new Decimal(0);
    const provenance = kind.startsWith('legacy_') || (original ?? operation).idempotency_key?.startsWith('legacy-') ? 'Corte consolidado; no acredita fecha bancaria individual' : 'Operación registrada';
    return { operation, postings, kind, concept: moneyConcepts[kind] ?? 'Movimiento interno', cash, receivable,
      capitalRecovered, interestCollected, provenance, cumulative: new Decimal(0) };
  }).sort((a, b) => a.operation.effective_date.localeCompare(b.operation.effective_date)
    || (a.operation.created_at ?? '').localeCompare(b.operation.created_at ?? '') || a.operation.id.localeCompare(b.operation.id));
  const concepts = new Map<string, Decimal>();
  for (const row of rows) {
    cumulative = cumulative.plus(row.cash); row.cumulative = cumulative;
    concepts.set(row.kind, (concepts.get(row.kind) ?? new Decimal(0)).plus(row.cash));
  }
  const cash = accounts.get('cash') ?? new Decimal(0);
  const bank = [...banks.values()].reduce((sum, amount) => sum.plus(amount), new Decimal(0));
  const personal = accounts.get('personal_bank_cash') ?? new Decimal(0);
  const receivable = accounts.get('loans_receivable') ?? new Decimal(0);
  const assets = cash.plus(receivable).plus(personal);
  const otherAccounts = [...accounts].filter(([account]) => !['cash', 'loans_receivable', 'personal_bank_cash'].includes(account));
  const claims = otherAccounts.reduce((sum, [, value]) => sum.minus(value), new Decimal(0));
  return { rows, concepts, accounts, banks, personalBanks, cash, bank, physicalCash, unknown, personal, receivable, assets, claims,
    accountingDifference: assets.minus(claims), orphanEntries,
    unbalancedOperations: rows.filter(row => !row.postings.reduce((sum, entry) => sum.plus(entry.amount), new Decimal(0)).isZero()).length };
}
