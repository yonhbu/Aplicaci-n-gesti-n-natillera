import type {
  Cycle,
  CycleMember,
  BankAccount,
  BankReconciliation,
  FinancialOperation,
  LedgerEntry,
  LoanProfitDistribution,
  LoanProfitDistributionPayment,
  LoanContract,
  LoanPayment,
  LoanSchedule,
  MemberSettlement,
  MemberSettlementPayment,
  PollaActivity,
  PollaContribution,
  PollaPrize,
  SavingsContribution,
  Workspace
} from '../lib/types';

export function buildHu001Export(input: {
  workspace: Workspace;
  cycle: Cycle;
  cycleMembers: CycleMember[];
  contributions: SavingsContribution[];
}) {
  return {
    format: 'natillera-manager.hu001.v1',
    exportedAt: new Date().toISOString(),
    scope: 'Solo modulos implementados en HU-001: workspace, ciclo, socios y aportes de ahorro.',
    warning: 'No es respaldo completo de la natillera legacy; no incluye prestamos, pollas, premios, liquidaciones ni comprobantes.',
    data: input
  };
}

export function buildNatilleraExport(input: {
  workspace: Workspace;
  cycle: Cycle;
  cycleMembers: CycleMember[];
  contributions: SavingsContribution[];
  operations: FinancialOperation[];
  ledgerEntries: LedgerEntry[];
  loans: LoanContract[];
  loanPayments: LoanPayment[];
  loanSchedules: LoanSchedule[];
  pollaActivities: PollaActivity[];
  pollaContributions: PollaContribution[];
  pollaPrizes: PollaPrize[];
  bankAccounts?: BankAccount[];
  bankReconciliations?: BankReconciliation[];
  memberSettlements?: MemberSettlement[];
  memberSettlementPayments?: MemberSettlementPayment[];
  loanProfitDistributions?: LoanProfitDistribution[];
  loanProfitDistributionPayments?: LoanProfitDistributionPayment[];
}) {
  return {
    format: input.bankAccounts ? 'natillera-manager.abc.v1' : 'natillera-manager.ab.v1',
    exportedAt: new Date().toISOString(),
    scope: input.bankAccounts
      ? 'Modulos implementados en A+B+C: workspace, ciclo, socios, aportes, ledger, prestamos, pollas, banco, conciliacion, liquidaciones y reparto de utilidad.'
      : 'Modulos implementados en A+B: workspace, ciclo, socios, aportes de ahorro, operaciones financieras, prestamos, cobros, pollas y premios.',
    warning: 'No es respaldo completo del legacy ni incluye comprobantes privados, importacion productiva ni despliegue.',
    data: input
  };
}
