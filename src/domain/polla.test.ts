import { describe, expect, it } from 'vitest';
import { calculatePollaPrizeNet } from './polla';

describe('calculatePollaPrizeNet', () => {
  it('usa comision fija de 5000 y no 10%', () => {
    expect(calculatePollaPrizeNet(40_000).net.toFixed(2)).toBe('35000.00');
    expect(calculatePollaPrizeNet(50_000).net.toFixed(2)).toBe('45000.00');
  });

  it('suma tres premios de 50000 con tres comisiones fijas', () => {
    const prizes = [50_000, 50_000, 50_000].map((amount) => calculatePollaPrizeNet(amount));
    const gross = prizes.reduce((sum, prize) => sum + prize.gross.toNumber(), 0);
    const admin = prizes.reduce((sum, prize) => sum + prize.adminCommission.toNumber(), 0);
    const net = prizes.reduce((sum, prize) => sum + prize.net.toNumber(), 0);
    expect(gross).toBe(150_000);
    expect(admin).toBe(15_000);
    expect(net).toBe(135_000);
  });

  it('rechaza premio menor que la comision fija hasta confirmar regla', () => {
    expect(() => calculatePollaPrizeNet(4_000)).toThrow(/Falta regla/);
  });
});
