import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { from: mock.from } }));
import { listLoanSchedules } from './loans';

describe('aplicaciones crudas del cronograma para cortes históricos', () => {
  beforeEach(() => mock.from.mockReset());
  it('recupera más de 1000 aplicaciones sin descartar las de recibos reversados y las une a su cuota', async () => {
    const applications = Array.from({ length: 1005 }, (_, index) => ({
      id: 'app-' + String(index).padStart(5, '0'), loan_id: 'loan', schedule_id: 'quota',
      payment_id: 'payment-' + index, capital_amount: '1.00', interest_amount: '0.00'
    }));
    const calls: { table: string; filters: [string, string][]; orders: string[]; range?: [number, number] }[] = [];
    mock.from.mockImplementation((table: string) => {
      const call: (typeof calls)[number] = { table, filters: [], orders: [] }; calls.push(call);
      const query = {
        select: vi.fn(() => query),
        eq: vi.fn((column: string, value: string) => { call.filters.push([column, value]); return query; }),
        order: vi.fn((column: string) => { call.orders.push(column); return query; }),
        range: vi.fn((from: number, to: number) => { call.range = [from, to]; return query; }),
        then(resolve: (result: { data: unknown[]; error: null }) => unknown) {
          const rows = table === 'loan_schedule_progress' ? [{ id: 'quota', loan_id: 'loan', status: 'projected' }, { id: 'empty', loan_id: 'loan', status: 'projected' }] : applications;
          const [from, to] = call.range ?? [0, 999];
          return Promise.resolve(resolve({ data: rows.slice(from, to + 1), error: null }));
        }
      };
      return query;
    });
    const rows = await listLoanSchedules('synthetic-cycle');
    expect(rows[0].payment_applications).toEqual(applications);
    expect(rows[1].payment_applications).toEqual([]);
    expect(calls.filter(c => c.table === 'loan_payment_applications').map(c => c.range)).toEqual([[0, 999], [1000, 1999]]);
    for (const call of calls) {
      expect(call.filters).toEqual([['cycle_id', 'synthetic-cycle']]);
      expect(call.orders.at(-1)).toBe('id');
    }
    // No filter joins the current posted status: reversals are resolved by date
    // in loanPosition, so a later reversal cannot erase a prior-cut application.
    expect(mock.from.mock.calls.map(([table]) => table)).not.toContain('loan_payments');
  });
  it('rechaza la carga si faltan aplicaciones por un error de lectura', async () => {
    mock.from.mockImplementation((table: string) => {
      const query = {
        select: vi.fn(() => query), eq: vi.fn(() => query), order: vi.fn(() => query), range: vi.fn(() => query),
        then(resolve: (result: unknown) => unknown) {
          return Promise.resolve(resolve(table === 'loan_schedule_progress'
            ? { data: [{ id: 'quota', loan_id: 'loan' }], error: null }
            : { data: null, error: { message: 'Aplicaciones no disponibles' } }));
        }
      };
      return query;
    });
    await expect(listLoanSchedules('synthetic-cycle')).rejects.toThrow('Aplicaciones no disponibles');
  });
});
