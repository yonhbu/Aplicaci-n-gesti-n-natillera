import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { previewWithdrawal } from './withdrawal';

const fixtureDates = [
  '2026-01-05',
  '2026-02-05',
  '2026-03-01',
  '2026-04-01',
  '2026-05-05',
  '2026-06-05',
  '2026-07-03',
  '2026-08-04',
  '2026-09-05',
  '2026-09-23'
];

describe('previewWithdrawal', () => {
  it('reproduce el escenario A acordado sin utilidad de prestamos ni polla', () => {
    const preview = previewWithdrawal({
      contributions: fixtureDates.map((effectiveDate) => ({ amount: 100_000, effectiveDate })),
      cutDate: '2026-10-06',
      annualEffectiveRate: 0.12,
      pendingNetPrizes: 0,
      debts: 0,
      annualAdminFee: 20_000,
      penalty: 50_000
    });

    expect(preview.contributed.toFixed(2)).toBe('1000000.00');
    expect(preview.recognizedYield.toDecimalPlaces(6).toFixed(6)).toBe('44894.884813');
    expect(preview.net.toFixed(2)).toBe('974894.88');
    expect(preview.transferRounded.toFixed(0)).toBe('974895');
  });

  it('reproduce el escenario B con premios netos, deudas y cierre P013 explicito', () => {
    const preview = previewWithdrawal({
      contributions: fixtureDates.map((effectiveDate) => ({ amount: 100_000, effectiveDate })),
      cutDate: '2026-10-06',
      annualEffectiveRate: 0.12,
      pendingNetPrizes: 135_000,
      debts: new Decimal(549_506).plus(525_000),
      annualAdminFee: 20_000,
      penalty: 50_000
    });

    expect(preview.net.toFixed(2)).toBe('35388.88');
    expect(preview.transferRounded.toFixed(0)).toBe('35389');
  });

  it('excluye rendimiento de aportes posteriores al corte', () => {
    const preview = previewWithdrawal({
      contributions: [{ amount: 100_000, effectiveDate: '2026-10-07' }],
      cutDate: '2026-10-06',
      annualEffectiveRate: 0.12,
      pendingNetPrizes: 0,
      debts: 0,
      annualAdminFee: 0,
      penalty: 0
    });

    expect(preview.contributionYields[0].days).toBe(0);
    expect(preview.contributionYields[0].eligibleAtCut).toBe(false);
    expect(preview.contributed.toFixed(2)).toBe('0.00');
    expect(preview.recognizedYield.toFixed(2)).toBe('0.00');
    expect(preview.net.toFixed(2)).toBe('0.00');
  });

  it('maneja tasa cero, corte igual a fecha y neto negativo', () => {
    const preview = previewWithdrawal({
      contributions: [{ amount: 50_000, effectiveDate: '2026-10-06' }],
      cutDate: '2026-10-06',
      annualEffectiveRate: 0,
      pendingNetPrizes: 0,
      debts: 80_000,
      annualAdminFee: 0,
      penalty: 0
    });

    expect(preview.recognizedYield.toFixed(2)).toBe('0.00');
    expect(preview.net.toFixed(2)).toBe('-30000.00');
  });

  it('rechaza fechas invalidas', () => {
    expect(() =>
      previewWithdrawal({
        contributions: [{ amount: 100_000, effectiveDate: '2026-02-30' }],
        cutDate: '2026-10-06',
        annualEffectiveRate: 0.12,
        pendingNetPrizes: 0,
        debts: 0,
        annualAdminFee: 0,
        penalty: 0
      }),
    ).toThrow(/fecha efectiva/);
  });
});
