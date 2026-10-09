import type {
  Cycle,
  CycleMember,
  FinancialOperation,
  LedgerEntry,
  LoanContract,
  LoanPayment,
  LoanSchedule,
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
}) {
  return {
    format: 'natillera-manager.ab.v1',
    exportedAt: new Date().toISOString(),
    scope: 'Modulos implementados en A+B: workspace, ciclo, socios, aportes de ahorro, operaciones financieras, prestamos, cobros, pollas y premios.',
    warning: 'No es respaldo completo del legacy ni incluye comprobantes privados, banco real, conciliacion, liquidaciones ni migracion productiva.',
    data: input
  };
}
