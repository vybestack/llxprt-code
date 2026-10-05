/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import {
  indices,
  rowIndex,
  suffixRow,
  tokenWeight,
  withSuffixFixture,
} from './history-suffix-test-helpers.js';

describe('lazy chronological recent journal suffix', () => {
  for (const size of [512, 8192]) {
    it(`preserves slice(-count) semantics on ${size} real journal rows`, async () => {
      await withSuffixFixture(size, async (service, ownership, counters) => {
        const oracle = Array.from({ length: size }, (_, index) => index);
        for (const count of [
          0,
          -0,
          1,
          17,
          size,
          size + 1,
          -3,
          0.5,
          2.5,
          -2.5,
          NaN,
          Infinity,
          -Infinity,
        ]) {
          const stream = service.getRecent(count);
          expect(Symbol.asyncIterator in stream).toBe(true);
          expect(await indices(stream)).toStrictEqual(oracle.slice(-count));
          expect(ownership.snapshot().liveRows).toBe(0);
        }
        expect(counters.snapshot().peakDecodedRows).toBe(1);
        expect(ownership.snapshot().peakRows).toBe(1);
      });
    }, 120_000);
  }

  it('captures on first next, pins membership, and closes without starting', async () => {
    const service = new HistoryService();
    try {
      service.add(suffixRow(0));
      const abandoned = service.getRecent(0)[Symbol.asyncIterator]();
      await abandoned.return();
      const stream = service.getRecent(0)[Symbol.asyncIterator]();
      service.add(suffixRow(1));
      const first = await stream.next();
      if (first.done === true) throw new Error('Expected first suffix row');
      expect(rowIndex(first.value)).toBe(0);
      service.add(suffixRow(2));
      const second = await stream.next();
      if (second.done === true) throw new Error('Expected second suffix row');
      expect(rowIndex(second.value)).toBe(1);
      expect((await stream.next()).done).toBe(true);
    } finally {
      service.dispose();
    }
  });
});

describe('lazy token-budget journal suffix', () => {
  for (const size of [512, 8192]) {
    it(`matches a reverse contiguous-suffix oracle on ${size} real journal rows`, async () => {
      await withSuffixFixture(size, async (service, ownership, counters) => {
        for (const budget of [-1, 0, 1, 25, 100, Infinity, NaN]) {
          let start = size;
          let total = 0;
          const visited: number[] = [];
          while (start > 0 && total + ((start - 1) % 7) <= budget) {
            total += (start - 1) % 7;
            start--;
          }
          const expected = Array.from(
            { length: size - start },
            (_, offset) => start + offset,
          );
          const stream = service.getWithinTokenLimit(budget, (row) => {
            visited.push(rowIndex(row));
            return tokenWeight(row);
          });
          expect(visited).toHaveLength(0);
          expect(Symbol.asyncIterator in stream).toBe(true);
          expect(await indices(stream)).toStrictEqual(expected);
          expect(visited).toStrictEqual(
            Array.from(
              { length: Math.min(size, size - start + 1) },
              (_, offset) => size - offset - 1,
            ),
          );
          expect(ownership.snapshot().liveRows).toBe(0);
        }
        expect(counters.snapshot().peakDecodedRows).toBe(1);
      });
    }, 120_000);

    it(`does not cap zero-weight rows at ${size}`, async () => {
      await withSuffixFixture(size, async (service, ownership) => {
        let count = 0;
        for await (const row of service.getWithinTokenLimit(0, () => 0)) {
          expect(rowIndex(row)).toBe(count++);
        }
        expect(count).toBe(size);
        expect(ownership.snapshot().peakRows).toBe(1);
        expect(ownership.snapshot().liveRows).toBe(0);
      });
    }, 120_000);
  }
});

describe('token-budget suffix edge cases', () => {
  it('stops at the first overflowing row rather than skipping it', async () => {
    await withSuffixFixture(4, async (service) => {
      expect(
        await indices(
          service.getWithinTokenLimit(2, (row) =>
            rowIndex(row) === 2 ? 100 : 1,
          ),
        ),
      ).toStrictEqual([3]);
    });
  });

  it('preserves numeric token-callback behavior without coercion', async () => {
    await withSuffixFixture(4, async (service) => {
      expect(
        await indices(service.getWithinTokenLimit(0, () => -1)),
      ).toStrictEqual([0, 1, 2, 3]);
      expect(
        await indices(service.getWithinTokenLimit(Infinity, () => Infinity)),
      ).toStrictEqual([0, 1, 2, 3]);
      expect(
        await indices(service.getWithinTokenLimit(10, () => NaN)),
      ).toStrictEqual([]);
      expect(
        await indices(service.getWithinTokenLimit(0.5, () => 0.25)),
      ).toStrictEqual([2, 3]);
    });
  });

  it('handles both APIs on an empty journal', async () => {
    const service = new HistoryService();
    try {
      expect(await indices(service.getRecent(0))).toStrictEqual([]);
      expect(
        await indices(
          service.getWithinTokenLimit(0, () => {
            throw new Error('empty callback');
          }),
        ),
      ).toStrictEqual([]);
    } finally {
      service.dispose();
    }
  });
});
