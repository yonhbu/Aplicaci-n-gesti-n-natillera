import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { from: mock.from } }));

import { listBankYieldDistributions, listLoanProfitPeriodAllocations, listLoanProfitPeriodDistributions } from './blockC';

// Simulate PostgREST's default cap and its lazy, thenable query. Duplicated dates
// deliberately require an ID tie breaker across pages, rather than assuming
// timestamps/dates uniquely identify a distribution.
function cappedPostgrest(failSecondPage = false) {
  const source = Array.from({ length: 1005 }, (_, index) => ({
    id: 'row-' + String(index).padStart(5, '0'),
    cut_date: '2026-10-26', created_at: '2026-10-26T12:00:00Z', amount: '1.00'
  })).reverse();
  const queries: { table: string; filters: [string, string][]; orders: [string, boolean][]; range?: [number, number] }[] = [];
  mock.from.mockImplementation((table: string) => {
    const query: (typeof queries)[number] = { table, filters: [], orders: [] };
    queries.push(query);
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((column: string, value: string) => { query.filters.push([column, value]); return builder; }),
      order: vi.fn((column: string, options?: { ascending?: boolean }) => { query.orders.push([column, options?.ascending !== false]); return builder; }),
      range: vi.fn((from: number, to: number) => { query.range = [from, to]; return builder; }),
      then(resolve: (value: { data: typeof source | null; error: { message: string } | null }) => unknown) {
        if (failSecondPage && query.range?.[0] === 1000) return Promise.resolve(resolve({ data: null, error: { message: 'Fallo sintético de la segunda página' } }));
        const sorted = [...source].sort((a, b) => {
          for (const [column, ascending] of query.orders) {
            const result = String(a[column as keyof typeof a]).localeCompare(String(b[column as keyof typeof b]));
            if (result) return ascending ? result : -result;
          }
          return 0;
        });
        const [from, to] = query.range ?? [0, 999];
        return Promise.resolve(resolve({ data: sorted.slice(from, to + 1), error: null }));
      }
    };
    return builder;
  });
  return { source, queries };
}

const cases = [
  { name: 'repartos bancarios', list: listBankYieldDistributions, table: 'bank_yield_distributions', filter: 'cycle_id', order: 'cut_date', ascending: false },
  { name: 'repartos por períodos', list: listLoanProfitPeriodDistributions, table: 'loan_profit_period_distributions', filter: 'cycle_id', order: 'created_at', ascending: false },
  { name: 'asignaciones individuales', list: listLoanProfitPeriodAllocations, table: 'loan_profit_period_allocations', filter: 'distribution_id', order: 'id', ascending: true }
];

describe('lecturas completas de repartos y asignaciones', () => {
  beforeEach(() => mock.from.mockReset());
  for (const scenario of cases) {
    it(`${scenario.name}: no oculta beneficiarios después de la fila 1000 y pagina con orden estable`, async () => {
      const { queries } = cappedPostgrest();
      const rows = await scenario.list('synthetic-scope');
      expect(rows).toHaveLength(1005);
      expect(new Set(rows.map(row => row.id)).size).toBe(1005);
      expect(queries.map(query => query.range)).toEqual([[0, 999], [1000, 1999]]);
      for (const query of queries) {
        expect(query.table).toBe(scenario.table);
        expect(query.filters).toEqual([[scenario.filter, 'synthetic-scope']]);
        expect(query.orders[0]).toEqual([scenario.order, scenario.ascending]);
        expect(query.orders.at(-1)).toEqual(['id', scenario.ascending]);
      }
      const ids = rows.map(row => row.id);
      expect(ids).toEqual([...ids].sort((a, b) => scenario.ascending ? a.localeCompare(b) : b.localeCompare(a)));
    });

    it(`${scenario.name}: propaga un fallo de página posterior sin presentar un listado parcial como completo`, async () => {
      cappedPostgrest(true);
      const result = await scenario.list('synthetic-scope').then(() => null, error => String(error.message));
      expect(result).toBe('Fallo sintético de la segunda página');
    });
  }
});
