/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { collectRawHistory } from '@vybestack/llxprt-code-test-utils/core/collect-raw-history.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { describe, expect, it } from 'bun:test';
import { withNativeDetachedFixture } from './__tests__/support/detached-contract-fixture.js';
import type { DetachedIOFaults } from './__tests__/support/detached-io-faults.js';

import { JournalCorruptionError } from '../../journal/errors.js';
import { JournalShortReadError } from '../../journal/positionalFile.js';
import { rejectedValue } from './chronology-rollback-test-helpers.js';
interface DescriptorWork {
  readonly reads: number;
  readonly readBytes: number;
  readonly writes: number;
}

async function measuredWork(
  io: DetachedIOFaults,
  action: () => Promise<void>,
): Promise<DescriptorWork> {
  const reads = io.descriptorReads;
  const readBytes = io.descriptorReadBytes;
  const writes = io.descriptorWrites;
  await action();
  return {
    reads: io.descriptorReads - reads,
    readBytes: io.descriptorReadBytes - readBytes,
    writes: io.descriptorWrites - writes,
  };
}

function expectBoundedWork(work: DescriptorWork, first: DescriptorWork): void {
  expect(work.readBytes).toBeGreaterThan(64 * 1024);
  expect(work.reads).toBeGreaterThan(0);
  expect(work.writes).toBeGreaterThan(0);
  expect(work.reads).toBeLessThanOrEqual(512 * 16);
  expect(work.writes).toBeLessThanOrEqual(512 * 4);
  expect(work.reads).toBeLessThanOrEqual(first.reads + 16);
  expect(work.writes).toBeLessThanOrEqual(first.writes + 4);
}

describe('bounded disk publication work', () => {
  it('does not replay the growing durable density prefix for every removal batch', async () => {
    await withNativeDetachedFixture(async ({ history, io }) => {
      await history.detachedValues.replace(
        (function* () {
          for (let index = 0; index < 512; index++) yield suffixRow(index);
        })(),
      );
      const removeBatch = async (): Promise<void> => {
        await history.optimizeDensityRows(() => ({
          removalCount: 256,
          replacementCount: 0,
          metadata: {
            readWritePairsPruned: 0,
            fileDeduplicationsPruned: 0,
            recencyPruned: 256,
          },
          decision: (index) =>
            index % 2 === 0 ? { kind: 'removed' } : undefined,
          close: (): void => {},
        }));
        await history.waitForCommit();
      };
      await history.detachedValues.withRollbackCheckpoint(async (restore) => {
        const initial = await measuredWork(io, removeBatch);
        expectBoundedWork(initial, initial);
        await restore();
        let first: DescriptorWork | undefined;
        for (let batch = 0; batch < 4; batch++) {
          const work = await measuredWork(io, removeBatch);
          expect(await collectRawHistory(history)).toStrictEqual(
            Array.from({ length: 256 }, (_, index) => suffixRow(index * 2 + 1)),
          );
          first ??= work;
          expectBoundedWork(work, first);
          await restore();
          expect(await collectRawHistory(history)).toStrictEqual(
            Array.from({ length: 512 }, (_, index) => suffixRow(index)),
          );
        }
      });
    });
  });

  it('publishes changed detached values without quadratic singleton-density replay', async () => {
    await withNativeDetachedFixture(async ({ history, io }) => {
      await history.detachedValues.replace(
        (function* () {
          for (let index = 0; index < 512; index++) yield suffixRow(index);
        })(),
      );
      let first: DescriptorWork | undefined;
      for (let batch = 0; batch < 4; batch++) {
        const responsesStored = batch % 2 !== 0;
        const work = await measuredWork(io, async () => {
          await history.detachedValues.transform(
            async (source, sink) => {
              let ordinal = 0;
              for await (const row of source.streamRows())
                await sink.appendDerived(ordinal++, {
                  ...row,
                  metadata: { ...row.metadata, responsesStored },
                });
            },
            undefined,
            { publishTokens: true },
          );
          await history.waitForCommit();
        });
        expect(await collectRawHistory(history)).toStrictEqual(
          Array.from({ length: 512 }, (_, index) => {
            const row = suffixRow(index);
            return {
              ...row,
              metadata: { ...row.metadata, responsesStored },
            };
          }),
        );
        first ??= work;
        expectBoundedWork(work, first);
      }
    });
  });
});

describe('journal publication addressing and cleanup', () => {
  it('preserves duplicate-marker membership and replacement precedence between batches', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      await history.addBatch([0, 1, 1, 2].map((index) => suffixRow(index)));
      await history.detachedValues.transform(async (source, sink) => {
        let ordinal = 0;
        for await (const row of source.streamRows()) {
          const at = ordinal++;
          if (row.metadata?.chronology?.seq === 2) await sink.removeValue(at);
          else await sink.appendDerived(at, row);
        }
      });
      expect(history.length()).toBe(2);
      await history.addBatch([suffixRow(1)]);
      await history.detachedValues.transform(async (source, sink) => {
        let ordinal = 0;
        for await (const row of source.streamRows()) {
          const at = ordinal++;
          if (row.metadata?.chronology?.seq === 3)
            await sink.appendDerived(at, suffixRow(1));
          else await sink.appendDerived(at, row);
        }
      });
      expect(history.length()).toBe(3);
      await history.detachedValues.transform(async (source, sink) => {
        let ordinal = 0;
        for await (const row of source.streamRows()) {
          const at = ordinal++;
          if (row.metadata?.chronology?.seq === 2) await sink.removeValue(at);
          else await sink.appendDerived(at, row);
        }
      });
      expect(history.length()).toBe(1);
      expect(await collectRawHistory(history)).toStrictEqual([suffixRow(0)]);
    });
  });

  it('restores membership after rejected publication and permits a correct retry', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      await history.addBatch([suffixRow(0), suffixRow(1)]);
      const failure = new Error('publication observer failed');
      history.once('tokensUpdated', () => {
        throw failure;
      });
      await expect(history.pop()).rejects.toBe(failure);
      expect(history.length()).toBe(2);
      expect(await collectRawHistory(history)).toStrictEqual([
        suffixRow(0),
        suffixRow(1),
      ]);
      expect(await history.pop()).toStrictEqual(suffixRow(1));
      expect(await collectRawHistory(history)).toStrictEqual([suffixRow(0)]);
    });
  });

  it('rebinds cardinality when another admission interrupts consecutive publications', async () => {
    await withNativeDetachedFixture(async ({ history }) => {
      await history.addBatch([suffixRow(0), suffixRow(1), suffixRow(2)]);
      await history.detachedValues.transform(async (source, sink) => {
        let ordinal = 0;
        for await (const row of source.streamRows()) {
          const at = ordinal++;
          if (at === 1) await sink.removeValue(at);
          else await sink.appendDerived(at, row);
        }
      });
      await history.addBatch([suffixRow(9)]);
      await history.detachedValues.transform(async (source, sink) => {
        let ordinal = 0;
        for await (const row of source.streamRows()) {
          const at = ordinal++;
          if (row.metadata?.chronology?.seq === 3) await sink.removeValue(at);
          else await sink.appendDerived(at, row);
        }
      });
      expect(history.length()).toBe(2);
      expect(await collectRawHistory(history)).toStrictEqual([
        suffixRow(0),
        suffixRow(9),
      ]);
    });
  });

  it('releases its pinned version when publication row acquisition fails', async () => {
    await withNativeDetachedFixture(async ({ history, io, session }) => {
      await history.addBatch([suffixRow(0)]);
      io.zeroNext('read');
      const failure = await rejectedValue(
        history.detachedValues.transform(async (source, sink) => {
          for await (const row of source.streamRows())
            await sink.appendDerived(0, row);
        }),
      );
      expect(failure).toBeInstanceOf(JournalCorruptionError);
      if (!(failure instanceof JournalCorruptionError))
        throw new Error('Missing journal acquisition failure');
      expect(failure.cause).toBeInstanceOf(JournalShortReadError);
      expect(await collectRawHistory(history)).toStrictEqual([suffixRow(0)]);
      await session.store.compact();
      expect(await collectRawHistory(history)).toStrictEqual([suffixRow(0)]);
    });
  });
});
