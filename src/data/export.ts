import type { Cycle, CycleMember, SavingsContribution, Workspace } from '../lib/types';

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
