import { describe, expect, it } from 'vitest';
import { buildMigrationDryRun } from './migrationD';

function fixtureJson() {
  return JSON.stringify({
    exportedAt: '2026-10-09T12:00:00-05:00',
    socios: [
      { id: 'S001', nombre: 'Persona', apellido: 'Uno', cuotaMensual: 100000 },
      { id: 'S002', nombreCompleto: 'Persona Retirada', cuotaMensual: '100.000', participaPolla: true }
    ],
    cuotas: [
      { id: 'C001', socioId: 'S001', monto: 100000, fecha: '2026-09-23', mes: 'Octubre', metodo: 'transferencia' },
      { id: 'C002', socioId: 'S002', monto: 100000, fecha: '2026-02-05', mes: 'Febrero' },
      { id: 'C003', socioId: 'S002', monto: 100000, mes: 'Marzo' }
    ],
    prestamos: [
      { id: 'P000', socioId: 'S001', principal: 250000, fechaInicio: '2026-03-01', metodo: 'fixed_interest', tasa: 0 },
      { id: 'P013', deudorExterno: 'Externo fixture', principal: 500000, fechaInicio: '2026-04-01', referidoPor: 'S001' }
    ],
    pagos: { 'P000#1': true },
    premios: [
      { id: 'PR1', ganadorId: 'S002', bruto: 40000, estado: 'pagado' },
      { id: 'PR2', bruto: 40000 }
    ],
    movimientos: [{ id: 'M1', monto: 1000, fecha: '2026-10-09', ubicacion: 'banco' }],
    liquidaciones: [{ id: 'L1', socioId: 'S002', fechaCorte: '2026-10-06' }],
    comprobantes: [{ ref: 'local://foto-1' }]
  });
}

describe('buildMigrationDryRun', () => {
  it('inventaria fuentes y solo marca como publicables hechos completos', () => {
    const report = buildMigrationDryRun({
      jsonText: fixtureJson(),
      sourceHash: 'abc123',
      sourceNames: ['fixture.json'],
      now: new Date('2026-10-09T17:00:00Z')
    });

    expect(report.format).toBe('natillera-manager.migration-d.dry-run.v1');
    expect(report.inventory.members).toBe(2);
    expect(report.inventory.savings).toBe(3);
    expect(report.inventory.latestDateFound).toBe('2026-10-09');
    expect(report.mappings.filter((mapping) => mapping.type === 'savings_contribution' && mapping.status === 'ready')).toHaveLength(2);
    expect(report.mappings.filter((mapping) => mapping.type === 'savings_contribution' && mapping.status === 'staged_only')).toHaveLength(1);
    expect(report.issues.some((issue) => issue.code === 'PAYMENT_MARK_WITHOUT_FACTS')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'P013_REQUIRES_EXPLICIT_EVIDENCE')).toBe(true);
    expect(report.issues.some((issue) => issue.code === 'SETTLEMENT_POLICY_REQUIRES_APPROVAL')).toBe(true);
  });

  it('bloquea migracion completa cuando falta JSON vigente', () => {
    const report = buildMigrationDryRun({
      csvText: 'CUOTAS\nFecha,Mes,Socio,Monto\n2026-01-05,Enero,Persona,100000',
      sourceHash: 'csv-only'
    });

    expect(report.inventory.csvSections.CUOTAS).toBe(1);
    expect(report.issues.some((issue) => issue.code === 'SOURCE_JSON_MISSING' && issue.category === 'blocking')).toBe(true);
  });

  it('no convierte comprobantes referenciados en bytes migrados', () => {
    const report = buildMigrationDryRun({
      jsonText: JSON.stringify({
        socios: [],
        cuotas: [{ id: 'C1', socioId: 'S1', monto: 10, fecha: '2026-01-01', mes: 1, comprobante: 'indexeddb://x' }],
        prestamos: [],
        premios: [],
        movimientos: []
      }),
      sourceHash: 'attachments'
    });

    expect(report.inventory.attachmentReferences).toBe(1);
    expect(report.inventory.attachmentBytes).toBe(0);
    expect(report.issues.some((issue) => issue.code === 'ATTACHMENT_BYTES_MISSING')).toBe(true);
  });
});

