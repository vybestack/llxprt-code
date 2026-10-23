/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  batchRow,
  withBatchFixture,
} from './__tests__/support/addbatch-stream-test-helpers.js';
import { computeContextRange } from './contextRange.js';
import { computeStatistics } from './curationDebugLogger.js';
import type { IContent } from './IContent.js';
import { expectScalarDurableRows } from './scalar-owner-contract-test-helpers.js';
import { expectTicketCallersReleased } from './ticket-owner-contract-test-helpers.js';
import {
  probeTransformRow,
  transformProbes,
} from './transform-value-test-helpers.js';
import type { ContextRange } from './historyEventTypes.js';

type ScalarFixture = Parameters<Parameters<typeof withBatchFixture>[0]>[0];

function appendScalarRow(
  history: ScalarFixture['history'],
  index: number,
): {
  append: Promise<void>;
  probes: ReturnType<typeof transformProbes>;
} {
  const row = batchRow(index);
  const probes = transformProbes();
  probeTransformRow(row, probes);
  return { append: history.addBatch([row]), probes };
}

async function checkPendingScalarAppend(
  {
    history,
    recorder,
    owners,
    pauseWriter,
    waitForPausedWrite,
    releaseWriter,
  }: ScalarFixture,
  size: number,
): Promise<void> {
  let emitted: ContextRange | undefined;
  history.on('contextRangeChanged', (range) => {
    emitted = range;
  });
  pauseWriter();
  const { append, probes } = appendScalarRow(history, size);
  try {
    await waitForPausedWrite;
    expect(history.length()).toBe(size + 1);
    expect(history.getTotalTokens()).toBe(4 * size);
    expect(emitted).toBeUndefined();
    await expectTicketCallersReleased(probes);
    expect(owners.snapshot().liveRows).toBe(0);
    expect(owners.snapshot().liveSerializedBytes).toBe(0);
    expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
      true,
    );
  } finally {
    releaseWriter();
    await append;
  }
  await history.waitForCommit();
  expect(history.length()).toBe(size + 1);
  expect(history.getTotalTokens()).toBe(4 * (size + 1));
  if (emitted === undefined)
    throw new Error('Expected acknowledged range event');
  expect(history.getContextRange()).toStrictEqual(emitted);
  expect(await history.getLastUserContent()).toStrictEqual(
    size % 3 === 0 ? batchRow(size) : scalarRow(size - (size % 3)),
  );
  expect(await history.removeLastIfMatches(batchRow(size + 10))).toBe(false);
  await expectScalarDurableRows(recorder, size + 1, (index) =>
    index === size ? batchRow(index) : scalarRow(index),
  );
}

function scalarRow(index: number): IContent {
  const row = batchRow(index);
  return {
    ...row,
    metadata: {
      ...row.metadata,
      usage: {
        totalTokens: index % 7,
        promptTokens: index % 7,
        completionTokens: 0,
      },
      ...(index % 19 === 0
        ? {
            chronologyReplaced: {
              fromSeq: index + 2,
              toSeq: index + 4,
              itemCount: 3,
            },
          }
        : {}),
    },
  };
}

describe('scalar queries over mixed journal history', () => {
  it.each([512, 8192])(
    'derives counts, last speakers and range from all %i rows without eager history',
    async (size) => {
      await withBatchFixture(async (fixture) => {
        const { history, owners, reads } = fixture;
        const expected = Array.from({ length: size }, (_, index) =>
          scalarRow(index),
        );
        await history.detachedValues.append(
          (async function* () {
            for (let index = 0; index < size; index++) yield scalarRow(index);
          })(),
        );
        expect(history.length()).toBe(size);
        expect(history.isEmpty()).toBe(false);
        expect(history.getStatistics()).toStrictEqual(
          computeStatistics(expected),
        );
        expect(history.getContextRange()).toStrictEqual(
          computeContextRange(expected),
        );
        expect(await history.getLastUserContent()).toStrictEqual(
          expected
            .slice()
            .reverse()
            .find((row) => row.speaker === 'human'),
        );
        expect(await history.getLastAIContent()).toStrictEqual(
          expected
            .slice()
            .reverse()
            .find((row) => row.speaker === 'ai'),
        );
        expect(history.getTotalTokens()).toBe(4 * size);
        expect(reads.snapshot().peakDecodedRows).toBeLessThanOrEqual(2);
        expect(
          owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
        ).toBe(true);
        await checkPendingScalarAppend(fixture, size);
        expect(owners.snapshot().liveRows).toBe(0);
        expect(owners.snapshot().liveSerializedBytes).toBe(0);
      });
    },
    180000,
  );
});

describe('scalar empty and single-row membership', () => {
  it('reports empty membership and reads a first atomic append without a history copy', async () => {
    await withBatchFixture(async ({ history, owners }) => {
      expect(history.length()).toBe(0);
      expect(history.isEmpty()).toBe(true);
      expect(await history.getLastAIContent()).toBeUndefined();
      expect(await history.getLastUserContent()).toBeUndefined();
      expect(history.getStatistics().totalMessages).toBe(0);
      expect(await history.pop()).toBeUndefined();
      await history.addBatch([batchRow(0)]);
      expect(history.length()).toBe(1);
      expect(await history.getLastUserContent()).toStrictEqual(batchRow(0));
      await history.waitForCommit();
      expect(history.getTotalTokens()).toBe(4);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('reads the first synchronous append after its commit without eager history', async () => {
    await withBatchFixture(async ({ history, owners }) => {
      history.add(batchRow(0));
      await history.waitForCommit();
      expect(history.length()).toBe(1);
      expect(await history.getLastUserContent()).toStrictEqual(batchRow(0));
      expect(history.getTotalTokens()).toBe(4);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  });

  it('returns the entire valid last row above eight MiB without imposing a fixture cap', async () => {
    await withBatchFixture(async ({ history, owners }) => {
      const row = batchRow(0, 9 * 1024 * 1024);
      await history.addBatch([row]);
      expect(history.length()).toBe(1);
      const last = await history.getLastUserContent();
      expect(last).toStrictEqual(row);
      expect(Buffer.byteLength(JSON.stringify(last))).toBeGreaterThan(
        8 * 1024 * 1024,
      );
      expect(history.getContextRange().lastSeq).toBe(1);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  }, 180000);
});
