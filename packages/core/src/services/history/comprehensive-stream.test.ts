import { collectJournalRowsForAssertions } from '../../test-utils/collect-rows-for-assertions.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { existsSync } from 'node:fs';
import {
  journalShapeRow,
  scratchDirectories,
} from './history-clone-trace-test-helpers.js';
import { suffixRow, withSuffixFixture } from './history-suffix-test-helpers.js';
import type { IContent } from './IContent.js';

function comprehensiveRow(index: number, payloadBytes: number): IContent {
  const row = journalShapeRow(index, payloadBytes);
  if (index % 7 === 0) return { ...row, speaker: 'ai', blocks: [] };
  if (index % 7 === 1)
    return { ...row, speaker: 'ai', blocks: [{ type: 'text', text: '' }] };
  return {
    ...row,
    blocks: [
      ...row.blocks,
      {
        type: 'tool_response',
        callId: `failed-${index}`,
        toolName: 'inspect',
        result: { nested: { index, values: [null, false, 'detail'] } },
        error: 'read failed',
      },
    ],
  };
}

for (const size of [512, 8192]) {
  describe(`comprehensive real journal traversal: ${size} rows`, () => {
    it('streams every row including invalid and empty content with bounded owners', async () => {
      await withSuffixFixture(
        size,
        async (service, ownership, counters) => {
          const stream = service.getComprehensive();
          expect(Symbol.asyncIterator in stream).toBe(true);
          let count = 0;
          for await (const row of stream) {
            expect(row).toStrictEqual(comprehensiveRow(count, 2048));
            ownership.retain(row);
            expect(ownership.snapshot().liveRows).toBe(1);
            ownership.release(row);
            count++;
          }
          expect(count).toBe(size);
          expect(counters.snapshot().peakDecodedRows).toBe(1);
          expect(ownership.snapshot().peakRows).toBe(1);
          expect(ownership.snapshot().liveRows).toBe(0);
        },
        2048,
        comprehensiveRow,
      );
    }, 120_000);

    it('preserves the eager content values after compressed membership replacement', async () => {
      await withSuffixFixture(size, async (service, ownership) => {
        const replacement = Array.from({ length: size }, (_, index) =>
          comprehensiveRow(index + size, 0),
        );
        await service.replaceAll(replacement, 'test');
        await service.waitForTokenUpdates();
        await collectJournalRowsForAssertions(service, async (expected) => {
          let count = 0;
          for await (const row of service.getComprehensive()) {
            expect(row).toStrictEqual(expected[count]);
            count++;
          }
          expect(count).toBe(expected.length);
        });
        expect(ownership.snapshot().peakRows).toBe(1);
        expect(ownership.snapshot().liveRows).toBe(0);
      });
    }, 120_000);
  });
}

describe('comprehensive snapshot and content identity', () => {
  it('captures at first next and keeps pinned membership across clear and append', async () => {
    await withSuffixFixture(2, async (service, ownership) => {
      const unused = service.getComprehensive();
      await unused.return();
      expect(ownership.snapshot().acquisitions).toBe(0);
      const stream = service.getComprehensive();
      service.add(suffixRow(2));
      await collectJournalRowsForAssertions(service, async (expected) => {
        const first = await stream.next();
        expect(first.done).toBe(false);
        service.clear();
        service.add(suffixRow(3));
        expect<ReadonlyArray<IContent | void>>([
          first.value,
          ...(await Array.fromAsync(stream)),
        ]).toStrictEqual(expected);
      });
      await collectJournalRowsForAssertions(service, async (expected) => {
        expect<readonly IContent[]>(
          await Array.fromAsync(service.getComprehensive()),
        ).toStrictEqual(expected);
      });
      expect(ownership.snapshot().liveRows).toBe(0);
    });
  });

  it('reads independent durable objects without sanitizing or sharing nested content', async () => {
    await withSuffixFixture(
      3,
      async (service) => {
        const first = await Array.fromAsync(service.getComprehensive());
        const second = await Array.fromAsync(service.getComprehensive());
        const expected = Array.from({ length: 3 }, (_, index) =>
          comprehensiveRow(index, 0),
        );
        expect(first).toStrictEqual(expected);
        expect(first[2]).not.toBe(second[2]);
        expect(first[2].blocks).not.toBe(second[2].blocks);
        expect(first[2].metadata).not.toBe(second[2].metadata);
        const call = first[2].blocks[1];
        const nextCall = second[2].blocks[1];
        if (call.type !== 'tool_call' || nextCall.type !== 'tool_call')
          throw new Error('Missing tool call');
        expect(call.parameters).not.toBe(nextCall.parameters);
        if (typeof call.parameters !== 'object' || call.parameters === null)
          throw new Error('Missing tool parameters');
        Object.assign(call.parameters, { changed: true });
        expect(second).toStrictEqual(expected);
        expect(await Array.fromAsync(service.getComprehensive())).toStrictEqual(
          expected,
        );
      },
      0,
      comprehensiveRow,
    );
  });
});

type Exit = 'return' | 'throw' | 'break' | 'consumer-throw';
async function exitFailure(
  stream: AsyncGenerator<IContent, void, unknown>,
  exit: Exit,
): Promise<string | undefined> {
  try {
    if (exit === 'return') {
      await stream.return();
      return undefined;
    }
    if (exit === 'throw') {
      await stream.throw(new Error('iterator failed'));
      return undefined;
    }
    for await (const row of stream) {
      void row;
      if (exit === 'consumer-throw') throw new Error('consumer failed');
      break;
    }
    return undefined;
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return error.message;
  }
}

describe('comprehensive cursor exits', () => {
  const failures: Record<Exit, string | undefined> = {
    return: undefined,
    throw: 'iterator failed',
    break: undefined,
    'consumer-throw': 'consumer failed',
  };
  for (const exit of ['return', 'throw', 'break', 'consumer-throw'] as const) {
    it(`releases row ownership and scratch on ${exit}`, async () => {
      await withSuffixFixture(512, async (service, ownership) => {
        const before = scratchDirectories();
        const stream = service.getComprehensive();
        try {
          expect((await stream.next()).done).toBe(false);
          expect(ownership.snapshot().liveRows).toBe(1);
          const opened = scratchDirectories().filter(
            (directory) => !before.includes(directory),
          );
          expect(opened.length).toBeGreaterThan(0);
          expect(await exitFailure(stream, exit)).toBe(failures[exit]);
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(opened.every((directory) => !existsSync(directory))).toBe(
            true,
          );
        } finally {
          await stream.return();
        }
      });
    });
  }

  it('rejects a pre-aborted read without opening scratch or acquiring rows', async () => {
    await withSuffixFixture(2, async (service, ownership) => {
      const before = scratchDirectories();
      const controller = new AbortController();
      controller.abort(new Error('before read'));
      await expect(
        service.getComprehensive(controller.signal).next(),
      ).rejects.toThrow('before read');
      expect(ownership.snapshot().acquisitions).toBe(0);
      expect(
        scratchDirectories().filter((dir) => !before.includes(dir)),
      ).toStrictEqual([]);
    });
  });

  it('cancels a suspended read without yielding another row and closes scratch', async () => {
    await withSuffixFixture(512, async (service, ownership) => {
      const before = scratchDirectories();
      const controller = new AbortController();
      const stream = service.getComprehensive(controller.signal);
      expect((await stream.next()).done).toBe(false);
      const opened = scratchDirectories().filter(
        (directory) => !before.includes(directory),
      );
      expect(ownership.snapshot().liveRows).toBe(1);
      controller.abort(new Error('comprehensive cancelled'));
      await expect(stream.next()).rejects.toThrow('comprehensive cancelled');
      expect(ownership.snapshot().liveRows).toBe(0);
      expect(opened.every((directory) => !existsSync(directory))).toBe(true);
    });
  });
});
