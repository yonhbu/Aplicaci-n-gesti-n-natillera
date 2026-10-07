import { describe, expect, it } from 'vitest';
import { prevalidateLegacySources } from './legacyPrevalidation';

describe('prevalidateLegacySources', () => {
  it('lee CSV por secciones y reporta aportes de mayo fechados en marzo', () => {
    const csv = [
      'CUOTAS',
      'Fecha,Mes,Socio,Monto,Metodo',
      '2026-03-05,Mayo,Persona Sintetica,100000,Transferencia',
      '',
      'PRESTAMOS',
      'Id,Socio,Monto',
      'P001,Persona Sintetica,500000'
    ].join('\n');

    const report = prevalidateLegacySources({ csvText: csv, now: new Date('2026-10-06T12:00:00Z') });

    expect(report.inventory.csvSections.CUOTAS).toBe(1);
    expect(report.inventory.detectedLoans).toBe(1);
    expect(report.issues.some((issue) => issue.code === 'EARLY_OR_WRONG_MONTH_CONTRIBUTION')).toBe(true);
  });

  it('valida JSON legacy sin exigir datos privados reales', () => {
    const report = prevalidateLegacySources({
      jsonText: JSON.stringify({
        socios: [{ id: 1, nombre: 'Persona', apellido: 'Sintetica' }],
        cuotas: [{ id: 'c1' }],
        pagos: { 'P001#1': true },
        prestamos: [],
        premios: [],
        movimientos: []
      })
    });

    expect(report.inventory.detectedMembers).toBe(1);
    expect(report.inventory.paymentMarks.true).toBe(1);
  });

  it('cuenta premios de secciones de polla y no suma falsamente CSV y JSON', () => {
    const csv = [
      'CUOTAS',
      'Fecha,Mes,Socio,Monto,Metodo',
      '2026-01-05,Enero,Persona Sintetica,100000,Transferencia',
      '',
      'PREMIOS POLLA',
      'Fecha,Socio,Monto',
      ...Array.from({ length: 8 }, (_, index) => `2026-0${(index % 6) + 1}-10,Persona ${index},50000`)
    ].join('\n');

    const report = prevalidateLegacySources({
      csvText: csv,
      jsonText: JSON.stringify({ cuotas: [{ id: 'misma-cuota' }], premios: [] })
    });

    expect(report.inventory.csvContributions).toBe(1);
    expect(report.inventory.jsonContributions).toBe(1);
    expect(report.inventory.detectedContributions).toBe(1);
    expect(report.inventory.detectedPrizes).toBe(8);
  });

  it('reporta JSON vacio y registros nulos sin lanzar excepcion', () => {
    const empty = prevalidateLegacySources({ jsonText: '{}' });
    expect(empty.issues.some((issue) => issue.code === 'JSON_EMPTY_BACKUP')).toBe(true);

    const withNull = prevalidateLegacySources({ jsonText: '{"socios":[null]}' });
    expect(withNull.issues.some((issue) => issue.code === 'JSON_SCHEMA_ERROR')).toBe(true);
  });

  it('cuenta adjuntos multiples y distingue pagos verdaderos, falsos y otros', () => {
    const report = prevalidateLegacySources({
      jsonText: JSON.stringify({
        socios: [],
        cuotas: [{ adjuntos: ['a', 'b'], comprobante: 'c' }],
        pagos: { 'P001#1': true, 'P001#2': false, 'P001#3': 'legacy' }
      })
    });

    expect(report.inventory.attachmentReferences).toBe(3);
    expect(report.inventory.paymentMarks).toEqual({ total: 3, true: 1, false: 1, other: 1 });
  });
});
