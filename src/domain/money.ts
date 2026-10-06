import Decimal from 'decimal.js';

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export type Money = Decimal;

const copPattern = /^(?:0|[1-9]\d{0,2}(?:\.\d{3})+|[1-9]\d*)(?:,\d{1,2})?$/;

export function parseCop(value: string | number | Decimal, fieldName = 'importe'): Decimal {
  if (value instanceof Decimal) {
    assertPositiveScale(value, fieldName);
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error(`${fieldName} no es un numero valido.`);
    }
    const decimal = new Decimal(value);
    assertPositiveScale(decimal, fieldName);
    return decimal;
  }

  const normalized = value.trim();
  if (!copPattern.test(normalized)) {
    throw new Error(`${fieldName} debe ser COP sin simbolo, con miles por punto y centavos por coma si aplica.`);
  }

  const decimal = new Decimal(normalized.replaceAll('.', '').replace(',', '.'));
  assertPositiveScale(decimal, fieldName);
  return decimal;
}

export function requirePositiveMoney(value: Decimal, fieldName = 'importe'): Decimal {
  if (value.lte(0)) {
    throw new Error(`${fieldName} debe ser mayor que cero.`);
  }
  return value;
}

export function toDatabaseMoney(value: Decimal): string {
  assertPositiveScale(value, 'importe');
  return value.toFixed(2);
}

export function formatCop(value: Decimal | string | number, fractionDigits = 0): string {
  const decimal = value instanceof Decimal ? value : new Decimal(value);
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(decimal.toNumber());
}

export function roundCurrency(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function roundPeso(value: Decimal): Decimal {
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

function assertPositiveScale(value: Decimal, fieldName: string) {
  if (!value.isFinite()) {
    throw new Error(`${fieldName} no es un numero valido.`);
  }
  if (value.decimalPlaces() > 2) {
    throw new Error(`${fieldName} no puede tener mas de dos decimales.`);
  }
}
