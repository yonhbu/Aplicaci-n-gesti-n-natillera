import { describe, expect, it } from 'vitest';
import { fetchAllPages } from './pagination';

describe('fetchAllPages', () => {
  it('recupera mas de 1000 filas sin truncar totales', async () => {
    const source = Array.from({ length: 1005 }, (_, index) => ({ id: index + 1 }));
    const calls: Array<[number, number]> = [];

    const rows = await fetchAllPages(async (from, to) => {
      calls.push([from, to]);
      return source.slice(from, to + 1);
    });

    expect(rows).toHaveLength(1005);
    expect(calls).toEqual([[0, 999], [1000, 1999]]);
  });
});
