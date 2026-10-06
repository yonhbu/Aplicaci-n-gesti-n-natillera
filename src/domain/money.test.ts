import { describe, expect, it } from 'vitest';
import { parseCop } from './money';

describe('parseCop', () => {
  it('interpreta miles colombianos sin convertir 100.000 en 100', () => {
    expect(parseCop('100.000').toFixed(2)).toBe('100000.00');
  });

  it('interpreta coma decimal sin convertir 5,5 en 55', () => {
    expect(parseCop('5,5').toFixed(2)).toBe('5.50');
  });

  it('rechaza formatos ambiguos', () => {
    expect(() => parseCop('100,000.00')).toThrow();
  });
});
