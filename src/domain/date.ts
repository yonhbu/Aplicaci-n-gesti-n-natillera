export type CivilDate = `${number}-${number}-${number}`;

const civilDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export function assertCivilDate(value: string, fieldName = 'fecha'): CivilDate {
  if (!civilDatePattern.test(value)) {
    throw new Error(`${fieldName} debe tener formato YYYY-MM-DD.`);
  }

  const [year, month, day] = value.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error(`${fieldName} no es una fecha civil valida.`);
  }

  return value as CivilDate;
}

export function daysBetween(start: CivilDate, end: CivilDate): number {
  const startMs = Date.UTC(...toUtcParts(start));
  const endMs = Date.UTC(...toUtcParts(end));
  return Math.floor((endMs - startMs) / 86_400_000);
}

export function compareCivilDates(left: CivilDate, right: CivilDate): number {
  return left.localeCompare(right);
}

function toUtcParts(value: CivilDate): [number, number, number] {
  const [year, month, day] = value.split('-').map(Number);
  return [year, month - 1, day];
}

export function monthKey(year: number, month: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('El ano aplicado no es valido.');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('El mes aplicado debe estar entre 1 y 12.');
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}
