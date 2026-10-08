import Decimal from 'decimal.js';
import { roundCurrency } from './money';

export interface PrizeNetResult {
  gross: Decimal;
  adminCommission: Decimal;
  net: Decimal;
}

export function calculatePollaPrizeNet(grossPrize: Decimal.Value, fixedCommission: Decimal.Value = 5000): PrizeNetResult {
  const gross = new Decimal(grossPrize);
  const adminCommission = new Decimal(fixedCommission);
  if (gross.lt(0)) {
    throw new Error('El premio bruto no puede ser negativo.');
  }
  if (adminCommission.lt(0)) {
    throw new Error('La comision no puede ser negativa.');
  }
  if (gross.lt(adminCommission)) {
    throw new Error('Falta regla para premios menores que la comision fija.');
  }
  return {
    gross: roundCurrency(gross),
    adminCommission: roundCurrency(adminCommission),
    net: roundCurrency(gross.minus(adminCommission))
  };
}
