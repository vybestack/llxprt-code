/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { expectTicketCallersReleased } from './ticket-owner-contract-test-helpers.js';
import {
  captureTicketWrite,
  expectTicketDisk,
} from './ticket-disk-contract-test-helpers.js';
import {
  recordScalarOwners,
  expectNoScalarOwners,
} from './scalar-test-evidence.js';
import { batchRow, withBatchFixture } from './addbatch-stream-test-helpers.js';
import { computeStatistics } from './curationDebugLogger.js';
import { computeContextRange } from './contextRange.js';
import type { IContent } from './IContent.js';
import type { ContextRange } from './historyEventTypes.js';

import {
  expectScalarCharge,
  expectScalarDurableRows,
  scalarRowCharge,
} from './scalar-owner-contract-test-helpers.js';

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

import {
  transformProbes,
  probeTransformRow,
} from './transform-value-test-helpers.js';

function appendScalarRow(
  history: ScalarFixture['history'],
  size: number,
): { append: Promise<void>; probes: ReturnType<typeof transformProbes> } {
  const row = batchRow(size);
  const probes = transformProbes();
  probeTransformRow(row, probes);
  return {
    append: history.addBatch([row], undefined, { streamPublication: true }),
    probes,
  };
}

type ScalarFixture = Parameters<Parameters<typeof withBatchFixture>[0]>[0];

async function checkPendingScalarAppend(
  {
    history,
    recorder,
    owners,
    pauseWriter,
    waitForPausedWrite,
    releaseWriter,
  }: Pick<
    ScalarFixture,
    | 'history'
    | 'recorder'
    | 'owners'
    | 'pauseWriter'
    | 'waitForPausedWrite'
    | 'releaseWriter'
  >,
  size: number,
): Promise<void> {
  let emitted: ContextRange | undefined;
  history.on('contextRangeChanged', (range) => {
    emitted = range;
  });
  pauseWriter();
  const { append, probes } = appendScalarRow(history, size);
  await waitForPausedWrite;
  expect(history.length()).toBe(size + 1);
  expect(history.getLastUserContent()).toStrictEqual(
    size % 3 === 0 ? batchRow(size) : scalarRow(size - (size % 3)),
  );
  expect(emitted).toBeUndefined();
  expect(history.getTotalTokens()).toBe(0);
  expectScalarCharge(owners, 1, scalarRowCharge(batchRow(size)));
  const ticket = captureTicketWrite(recorder);
  await expectTicketCallersReleased(probes);
  expect(owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 })).toBe(
    true,
  );
  recordScalarOwners('journal-before-ack', size, owners);
  releaseWriter();
  await append;
  await expectTicketDisk(recorder, ticket, 1, () => batchRow(size));
  await history.waitForCommit();
  if (emitted === undefined)
    throw new Error('Expected acknowledged range event');
  expect(history.getTotalTokens()).toBe(4);
  expect(await history.removeLastIfMatches(batchRow(size + 10))).toBe(false);
  expect(history.getContextRange()).toStrictEqual(emitted);
  expectNoScalarOwners(owners);
  recordScalarOwners('journal-after-ack', size, owners);
  await expectScalarDurableRows(recorder, size + 1, (index) =>
    index === size ? batchRow(index) : scalarRow(index),
  );
  expect(history.getContextRange()).toStrictEqual(emitted);
}

describe('scalar queries over mixed disk history', () => {
  it.each([512, 8192])(
    'derives counts, last speakers and range from all %i rows without eager history',
    async (size) => {
      await withBatchFixture(
        async ({
          history,
          recorder,
          owners,
          reads,
          pauseWriter,
          waitForPausedWrite,
          releaseWriter,
        }) => {
          const expected = Array.from({ length: size }, (_, index) =>
            scalarRow(index),
          );
          for (const content of expected)
            await recorder.commit('content', { content });
          expect(history.length()).toBe(size);
          expect(history.isEmpty()).toBe(false);
          expect(history.getStatistics()).toStrictEqual(
            computeStatistics(expected),
          );
          expect(history.getContextRange()).toStrictEqual(
            computeContextRange(expected),
          );
          expect(history.getLastUserContent()).toStrictEqual(
            expected
              .slice()
              .reverse()
              .find((row) => row.speaker === 'human'),
          );
          expect(history.getLastAIContent()).toStrictEqual(
            expected
              .slice()
              .reverse()
              .find((row) => row.speaker === 'ai'),
          );
          expect(history.getTotalTokens()).toBe(0);
          recordScalarOwners('durable-scalar', size, owners);
          expect(reads.snapshot().rowsDecoded).toBeGreaterThan(size);
          expect(reads.snapshot().peakDecodedRows).toBeLessThanOrEqual(2);
          expect(
            owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
          ).toBe(true);
          expectNoScalarOwners(owners);
          await checkPendingScalarAppend(
            {
              history,
              recorder,
              owners,
              pauseWriter,
              waitForPausedWrite,
              releaseWriter,
            },
            size,
          );
        },
      );
    },
    180000,
  );
});

describe('scalar empty and single-row membership', () => {
  it('reports empty membership and reads a first atomic append without a history copy', async () => {
    await withBatchFixture(async ({ history, owners }) => {
      expect(history.length()).toBe(0);
      expect(history.isEmpty()).toBe(true);
      expect(history.getLastAIContent()).toBeUndefined();
      expect(history.getLastUserContent()).toBeUndefined();
      expect(history.getStatistics().totalMessages).toBe(0);
      expect(await history.pop()).toBeUndefined();
      await history.addBatch([batchRow(0)]);
      expect(history.length()).toBe(1);
      expect(history.getLastUserContent()).toStrictEqual(batchRow(0));
      await history.waitForTokenUpdates();
      await history.waitForCommit();
      expect(history.getTotalTokens()).toBe(4);
      expectNoScalarOwners(owners);
    });
  });

  it('reads the first synchronous append without eager history in the empty check', async () => {
    await withBatchFixture(async ({ history, owners }) => {
      history.add(batchRow(0));
      expect(history.length()).toBe(1);
      expect(history.getLastUserContent()).toStrictEqual(batchRow(0));
      await history.waitForTokenUpdates();
      await history.waitForCommit();
      expect(history.getTotalTokens()).toBe(4);
      expectNoScalarOwners(owners);
    });
  });

  it('returns the entire valid last row above eight MiB without imposing a fixture cap', async () => {
    await withBatchFixture(async ({ history, recorder, owners }) => {
      const row = batchRow(0, 9 * 1024 * 1024);
      await recorder.commit('content', { content: row });
      expect(history.length()).toBe(1);
      const last = history.getLastUserContent();
      expect(last).toStrictEqual(row);
      expect(Buffer.byteLength(JSON.stringify(last))).toBeGreaterThan(
        8 * 1024 * 1024,
      );
      expect(history.getContextRange().lastSeq).toBe(1);
      expectNoScalarOwners(owners);
    });
  }, 180000);
});
