/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  collectRowsForAssertions,
  collectJournalRowsForAssertions,
} from './collect-rows-for-assertions.js';
import {
  suffixRow,
  withSuffixFixture,
} from '../services/history/history-suffix-test-helpers.js';
import type { IContent } from '../services/history/IContent.js';

function trackedSource(fail = false): {
  rows: AsyncIterable<IContent>;
  closed: () => boolean;
} {
  let closed = false;
  return {
    rows: (async function* (): AsyncGenerator<IContent> {
      try {
        yield suffixRow(0);
        if (fail) throw new Error('source failed');
        yield suffixRow(1);
      } finally {
        closed = true;
      }
    })(),
    closed: () => closed,
  };
}

function explicitCloseSource(fail: boolean): {
  rows: AsyncIterable<IContent>;
  isOpen: () => boolean;
} {
  let open = true;
  let yielded = false;
  return {
    rows: {
      [Symbol.asyncIterator]: (): AsyncIterator<IContent> => ({
        next: async (): Promise<IteratorResult<IContent>> => {
          if (yielded) {
            if (fail) throw new Error('read failed before close');
            return { done: true, value: undefined };
          }
          yielded = true;
          return { done: false, value: suffixRow(0) };
        },
        return: async (): Promise<IteratorResult<IContent>> => {
          open = false;
          return { done: true, value: undefined };
        },
      }),
    },
    isOpen: () => open,
  };
}

describe('explicit assertion cursor cleanup', () => {
  it('closes a source that remains open after exhaustion', async () => {
    const source = explicitCloseSource(false);
    await collectRowsForAssertions(source.rows, (rows) => {
      expect(rows).toStrictEqual([suffixRow(0)]);
    });
    expect(source.isOpen()).toBe(false);
  });

  it('closes a source that remains open after a read failure', async () => {
    const source = explicitCloseSource(true);
    await expect(
      collectRowsForAssertions(source.rows, () => {
        throw new Error('Must not assert incomplete rows');
      }),
    ).rejects.toThrow('read failed before close');
    expect(source.isOpen()).toBe(false);
  });
});

describe('scoped test assertion rows', () => {
  it('preserves order during async assertions and releases the assertion owner on return', async () => {
    const source = trackedSource();
    let borrowed: readonly IContent[] | undefined;
    await collectRowsForAssertions(source.rows, async (rows) => {
      borrowed = rows;
      await Promise.resolve();
      expect(rows).toStrictEqual([suffixRow(0), suffixRow(1)]);
    });
    expect(borrowed).toStrictEqual([]);
    expect(source.closed()).toBe(true);
  });

  it('propagates assertion failure and releases both cursor and row array', async () => {
    const source = trackedSource();
    let borrowed: readonly IContent[] | undefined;
    await expect(
      collectRowsForAssertions(source.rows, (rows) => {
        borrowed = rows;
        expect(rows[1]).toStrictEqual(suffixRow(1));
        throw new Error('assertion failed');
      }),
    ).rejects.toThrow('assertion failed');
    expect(borrowed).toStrictEqual([]);
    expect(source.closed()).toBe(true);
  });

  it('propagates read failure without entering assertions and closes the cursor', async () => {
    const source = trackedSource(true);
    let entered = false;
    await expect(
      collectRowsForAssertions(source.rows, () => {
        entered = true;
      }),
    ).rejects.toThrow('source failed');
    expect(entered).toBe(false);
    expect(source.closed()).toBe(true);
  });

  it('handles an empty source without retaining another scope', async () => {
    await withSuffixFixture(0, async (history, ownership) => {
      await collectRowsForAssertions(history.getComprehensive(), (rows) => {
        expect(rows).toStrictEqual([]);
      });
      expect(ownership.snapshot().liveRows).toBe(0);
    });
  });
});

for (const size of [512, 8192]) {
  describe(`independent journal assertion oracle: ${size} rows`, () => {
    it('matches fixture content and the service stream without a service materializer', async () => {
      await withSuffixFixture(size, async (history, ownership) => {
        await collectJournalRowsForAssertions(history, async (expected) => {
          expect(expected).toStrictEqual(
            Array.from({ length: size }, (_, index) => suffixRow(index)),
          );
          await collectRowsForAssertions(
            history.getComprehensive(),
            (actual) => {
              expect(actual).toStrictEqual(expected);
              expect(actual).not.toBe(expected);
            },
          );
          expect(ownership.snapshot().liveRows).toBe(0);
        });
      });
    }, 120_000);
  });
}
