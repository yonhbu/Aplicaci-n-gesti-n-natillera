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
    expect(report.inventory.paymentMarks).toBe(1);
  });
});
