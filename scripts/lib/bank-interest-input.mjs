import Decimal from 'decimal.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function date(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T12:00:00Z'))
    && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;
}
function money(value) {
  if (!/^\d+(\.\d{1,2})?$/.test(String(value))) throw Error('Importe inválido; use decimal exacto con punto y hasta dos decimales.');
  return new Decimal(value);
}

// Confirmed posting dates are not an assertion about the month that earned interest.
export function validateBankInterestInput(data, through, today) {
  if (!date(through) || !date(today) || through > today) throw Error('La fecha de confirmación no puede ser inválida ni futura.');
  if (![data?.cycleId, data?.bankId].every(v => uuid.test(v ?? ''))) throw Error('Ciclo/cuenta inválidos.');
  if (!Array.isArray(data.receipts) || !data.receipts.length) throw Error('Faltan abonos confirmados.');
  const dates = new Set();
  const receipts = data.receipts.map(r => {
    if (!date(r?.date) || r.date > through || dates.has(r.date)) throw Error('Fecha o duplicado inválido; no se registran proyecciones.');
    dates.add(r.date);
    const amount = money(r.amount);
    if (amount.lte(0)) throw Error('El abono debe ser mayor que cero.');
    return { date: r.date, amount: amount.toFixed(2) };
  });
  const total = receipts.reduce((sum, r) => sum.plus(r.amount), new Decimal(0));
  if (data.expectedTotal !== undefined && !total.eq(money(data.expectedTotal))) {
    throw Error(`La suma de abonos (${total.toFixed(2)}) no coincide con el total declarado (${money(data.expectedTotal).toFixed(2)}). No se escribe nada.`);
  }
  return { cycleId: data.cycleId, bankId: data.bankId, receipts, total: total.toFixed(2) };
}
