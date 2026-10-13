import type {
  Cycle,
  CycleMember,
  BankAccount,
  BankReconciliation,
  FinancialOperation,
  LedgerEntry,
  LoanProfitDistribution,
  LoanProfitDistributionAllocation,
  LoanProfitDistributionPayment,
  LoanProfitDistributionPolicy,
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
import type { MigrationDryRunReport } from '../domain/migrationD';

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

export function buildBlockDExport(input: {
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
  bankAccounts: BankAccount[];
  bankReconciliations: BankReconciliation[];
  memberSettlements: MemberSettlement[];
  memberSettlementPayments: MemberSettlementPayment[];
  loanProfitDistributions: LoanProfitDistribution[];
  loanProfitDistributionPayments: LoanProfitDistributionPayment[];
  loanProfitDistributionPolicies?: LoanProfitDistributionPolicy[];
  loanProfitDistributionAllocations?: LoanProfitDistributionAllocation[];
  migrationDryRun?: MigrationDryRunReport | null;
  migrationBatch?: Record<string, unknown> | null;
  attachmentManifest?: Record<string, unknown>[] | null;
}) {
  return {
    format: 'natillera-manager.abcd.v1',
    exportedAt: new Date().toISOString(),
    scope: 'A+B+C mas metadatos de migracion D: staging, mapeos, incidencias, conciliacion y manifiesto de adjuntos disponibles.',
    warning: 'No contiene secretos, usuarios Auth con credenciales ni fuentes legacy reales. Los comprobantes solo cuentan como restaurables si hay bytes y hash en el manifiesto.',
    restorePolicy: {
      authUsers: 'Reprovisionar acceso por bootstrap local; no se exportan credenciales.',
      target: 'Restaurar solo en destino vacio aislado y comparar inventario, dinero, relaciones y hashes.',
      blockers: 'No declarar migracion completa si quedan incidencias financieras criticas.'
    },
    migration: {
      dryRun: input.migrationDryRun ?? null,
      batch: input.migrationBatch ?? null,
      attachmentManifest: input.attachmentManifest ?? []
    },
    data: {
      workspace: input.workspace,
      cycle: input.cycle,
      cycleMembers: input.cycleMembers,
      contributions: input.contributions,
      operations: input.operations,
      ledgerEntries: input.ledgerEntries,
      loans: input.loans,
      loanPayments: input.loanPayments,
      loanSchedules: input.loanSchedules,
      pollaActivities: input.pollaActivities,
      pollaContributions: input.pollaContributions,
      pollaPrizes: input.pollaPrizes,
      bankAccounts: input.bankAccounts,
      bankReconciliations: input.bankReconciliations,
      memberSettlements: input.memberSettlements,
      memberSettlementPayments: input.memberSettlementPayments,
      loanProfitDistributions: input.loanProfitDistributions,
      loanProfitDistributionPayments: input.loanProfitDistributionPayments,
      loanProfitDistributionPolicies: input.loanProfitDistributionPolicies ?? [],
      loanProfitDistributionAllocations: input.loanProfitDistributionAllocations ?? []
    }
  };
}
