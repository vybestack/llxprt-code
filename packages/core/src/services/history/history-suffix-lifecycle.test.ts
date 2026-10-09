/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import { HistoryJournalStore } from './historyJournalStore.js';
import { rowIndex } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { withCoreSuffixFixture } from './core-suffix-fixture-test-helpers.js';

type Query = 'recent' | 'tokens';
type Exit = 'return' | 'break' | 'throw' | 'abort';

function scratchDirectories(): string[] {
  return fs
    .readdirSync(tmpdir())
    .filter((name) =>
      /llxprt-(row-directory|resolver|density-index)-/.test(name),
    )
    .map((name) => join(tmpdir(), name));
}

function queryStream(
  service: HistoryService,
  query: Query,
  signal?: AbortSignal,
): AsyncGenerator<IContent, void, unknown> {
  return query === 'recent'
    ? service.getRecent(0, signal)
    : service.getWithinTokenLimit(Infinity, () => 0, signal);
}

async function consumeExit(
  iterator: AsyncGenerator<IContent, void, unknown>,
  exit: Exit,
): Promise<void> {
  for await (const row of iterator) {
    if (rowIndex(row) !== 1) throw new Error('Incorrect second row');
    if (exit === 'throw') throw new Error('consumer failed');
    break;
  }
}

async function exitStream(
  iterator: AsyncGenerator<IContent, void, unknown>,
  exit: Exit,
  controller: AbortController,
): Promise<string | undefined> {
  try {
    if (exit === 'return') await iterator.return();
    else if (exit === 'abort') {
      controller.abort(new Error('suffix cancelled'));
      await iterator.next();
    } else await consumeExit(iterator, exit);
    return undefined;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
}

async function verifyExit(query: Query, exit: Exit): Promise<number> {
  return withCoreSuffixFixture(512, async (service, ownership) => {
    const controller = new AbortController();
    const before = scratchDirectories();
    const iterator = queryStream(service, query, controller.signal);
    const first = await iterator.next();
    if (first.done === true) throw new Error('Expected a suffix row');
    expect(rowIndex(first.value)).toBe(0);
    expect(ownership.snapshot().liveRows).toBe(1);
    const created = scratchDirectories().filter(
      (directory) => !before.includes(directory),
    );
    expect(created.length).toBeGreaterThan(0);
    try {
      const failure = await exitStream(iterator, exit, controller);
      const expected: Record<Exit, string | undefined> = {
        abort: 'suffix cancelled',
        throw: 'consumer failed',
        return: undefined,
        break: undefined,
      };
      expect(failure).toBe(expected[exit]);
      expect(created.every((directory) => !fs.existsSync(directory))).toBe(
        true,
      );
      return ownership.snapshot().liveRows;
    } finally {
      await iterator.return();
    }
  });
}

for (const query of ['recent', 'tokens'] as const) {
  describe(`${query} suffix cursor ownership and cancellation`, () => {
    for (const exit of ['return', 'break', 'throw', 'abort'] as const) {
      it(`releases rows and disk scratch on ${exit}`, async () => {
        expect(await verifyExit(query, exit)).toBe(0);
      });
    }
    it('does not open a cursor after pre-cancellation or return-before-next', async () => {
      await withCoreSuffixFixture(4, async (service, ownership) => {
        const controller = new AbortController();
        controller.abort(new Error('already cancelled'));
        const before = scratchDirectories();
        await expect(
          queryStream(service, query, controller.signal).next(),
        ).rejects.toThrow('already cancelled');
        await queryStream(service, query).return();
        expect(
          scratchDirectories().filter(
            (directory) => !before.includes(directory),
          ),
        ).toHaveLength(0);
        expect(ownership.snapshot().acquisitions).toBe(0);
      });
    });
  });
}

describe('token suffix selection failures', () => {
  it('propagates a token callback failure and closes its row and scratch', async () => {
    await withCoreSuffixFixture(4, async (service, ownership) => {
      const before = scratchDirectories();
      const stream = service.getWithinTokenLimit(100, (row) => {
        if (rowIndex(row) === 2) throw new Error('token count failed');
        return 1;
      });
      await expect(stream.next()).rejects.toThrow('token count failed');
      expect(ownership.snapshot().acquisitions).toBe(2);
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(
        scratchDirectories().filter((directory) => !before.includes(directory)),
      ).toHaveLength(0);
    });
  });
  it('cancels during reverse selection without evaluating the remaining rows', async () => {
    await withCoreSuffixFixture(512, async (service, ownership) => {
      const controller = new AbortController();
      let evaluated = 0;
      const stream = service.getWithinTokenLimit(
        Infinity,
        () => {
          evaluated++;
          controller.abort(new Error('selection cancelled'));
          return 0;
        },
        controller.signal,
      );
      await expect(stream.next()).rejects.toThrow('selection cancelled');
      expect(evaluated).toBe(1);
      expect(ownership.snapshot().liveRows).toBe(0);
    });
  });
});

async function verifyBoundedTraversal(size: number): Promise<number> {
  return withCoreSuffixFixture(
    size,
    async (service, ownership, counters) => {
      const eager = spyOn(
        HistoryJournalStore.prototype,
        'materialize',
      ).mockImplementation(() => {
        throw new Error('eager history trap');
      });
      const wholeFile = spyOn(fs, 'readFileSync').mockImplementation(() => {
        throw new Error('whole file trap');
      });
      try {
        for (const query of ['recent', 'tokens'] as const) {
          let count = 0;
          for await (const row of queryStream(service, query)) {
            expect(rowIndex(row)).toBe(count++);
            expect(ownership.snapshot().liveRows).toBe(1);
          }
          expect(count).toBe(size);
        }
        expect(counters.snapshot().peakDecodedRows).toBe(1);
        expect(ownership.within({ rows: 1, serializedBytes: 1_048_576 })).toBe(
          true,
        );
        return ownership.snapshot().liveRows;
      } finally {
        wholeFile.mockRestore();
        eager.mockRestore();
      }
    },
    2048,
  );
}

describe('bounded suffix traversal without eager journal reads', () => {
  for (const size of [512, 8192]) {
    it(`streams ${size} payload rows with one decoded owner and bounded bytes`, async () => {
      expect(await verifyBoundedTraversal(size)).toBe(0);
    }, 120_000);
  }
  it('rejects the same owner bound when a consumer retains the full suffix', async () => {
    await withCoreSuffixFixture(
      512,
      async (service, ownership) => {
        const retained: IContent[] = [];
        try {
          for await (const row of service.getRecent(0)) {
            ownership.retain(row);
            retained.push(row);
          }
          expect(
            ownership.within({ rows: 1, serializedBytes: 1_048_576 }),
          ).toBe(false);
          expect(ownership.snapshot().peakSerializedBytes).toBeGreaterThan(
            1_048_576,
          );
        } finally {
          for (const row of retained) ownership.release(row);
        }
        expect(ownership.snapshot().liveRows).toBe(0);
      },
      4096,
    );
  });
});
