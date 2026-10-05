/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  batchRow,
  recordBatchOwners,
  withBatchFixture,
} from './addbatch-stream-test-helpers.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';

const bound = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

describe('addBatch actual disk publication owners', () => {
  it.each([512, 8192])(
    'holds all %i external rows while bounding internally created rows',
    async (size) => {
      await withBatchFixture(async ({ history, recorder, owners, reads }) => {
        for (let index = 0; index < size; index++)
          await recorder.commit('content', { content: batchRow(index) });
        const batch = Array.from({ length: size }, (_, index) =>
          batchRow(size + index),
        );
        owners.registerInput(batch);
        history.setBaseTokenOffset(37);
        let observed = 0;
        history.on('contentBatchAdded', (published) => {
          expect(published).toHaveLength(size);
          published.withRows((cursor) => {
            let index = 0;
            for (
              let item = cursor.next();
              item.done !== true;
              item = cursor.next()
            ) {
              expect(item.value).not.toBe(batch[index]);
              expect(item.value).toStrictEqual(batch[index]);
              expect(item.value.metadata?.chronology).toStrictEqual(
                batch[index].metadata?.chronology,
              );
              index++;
            }
            expect(index).toBe(size);
          });
          observed++;
        });
        await history.addBatch(batch, undefined, {
          streamPublication: true,
          afterPublication: () => {
            recordBatchOwners('durable-publication', size, owners);
            expect(batch).toHaveLength(size);
            expect(owners.internal.snapshot().liveRows).toBeGreaterThan(0);
            expect(owners.internal.within(bound)).toBe(true);
            expect(owners.external.snapshot().liveRows).toBeGreaterThan(440);
            expect(owners.within(bound)).toBe(
              process.env.ADDBATCH_AGGREGATE_TRAP === '1',
            );
            expect(reads.snapshot().peakDecodedRows).toBeLessThanOrEqual(440);
          },
        });
        expect(observed).toBe(1);
        expect(history.getTotalTokens()).toBe(37 + 4 * size);
        let index = 0;
        for await (const row of history.streamRawHistory()) {
          expect(row).toStrictEqual(batchRow(index));
          index++;
        }
        expect(index).toBe(2 * size);
        await history.waitForCommit();
        expect(owners.snapshot().liveRows).toBe(0);
        expect(owners.snapshot().liveSerializedBytes).toBe(0);
      });
    },
    180000,
  );
});

describe('addBatch oversized disk values', () => {
  it('accepts a complete valid row larger than the fixture byte bound', async () => {
    await withBatchFixture(async ({ history, owners }) => {
      const batch = [batchRow(0, 9 * 1024 * 1024)];
      owners.registerInput(batch);
      await history.addBatch(batch);
      let count = 0;
      for await (const row of history.streamRawHistory()) {
        expect(row).toStrictEqual(batch[0]);
        expect(Buffer.byteLength(JSON.stringify(row))).toBeGreaterThan(
          bound.serializedBytes,
        );
        count++;
      }
      expect(count).toBe(1);
      expect(history.getTotalTokens()).toBe(4);
      await history.waitForCommit();
      expect(owners.snapshot().liveRows).toBe(0);
    });
  }, 180000);
});

describe('addBatch context retaining controls', () => {
  it.each(
    [512, 8192].flatMap((size) =>
      [false, true].map((copy) => ({ size, copy })),
    ),
  )(
    'detects real $size retained rows copy=$copy',
    async ({ size, copy }) => {
      await withBatchFixture(async ({ history, owners }) => {
        const batch = Array.from({ length: size }, (_, index) =>
          batchRow(index),
        );
        owners.registerInput(batch);
        await history.addBatch(batch);
        await history.waitForCommit();
        const retained: IContent[] = [];
        const trap = new RowOwnership();
        try {
          for await (const row of history.streamRawHistory()) {
            const held = copy ? { ...row } : row;
            retained.push(held);
            trap.retain(held);
          }
          expect(retained).toHaveLength(size);
          expect(trap.snapshot().liveRows).toBeGreaterThan(440);
          expect(trap.within(bound)).toBe(
            process.env.ADDBATCH_RETAINING_TRAP === '1',
          );
        } finally {
          for (const row of retained) trap.release(row);
          retained.length = 0;
          expect(trap.snapshot().liveRows).toBe(0);
        }
      });
    },
    180000,
  );
});

describe('addBatch explicit journal backpressure', () => {
  it('waits between admissions only when the caller opts in', async () => {
    await withBatchFixture(
      async ({
        history,
        recorder,
        pauseWriter,
        waitForPausedWrite,
        releaseWriter,
      }) => {
        await recorder.commit('content', { content: batchRow(20000) });
        pauseWriter();
        const batch = [batchRow(0), batchRow(1)];
        let published = false;
        history.on('contentBatchAdded', () => {
          published = true;
        });
        const operation = history.addBatch(batch, undefined, {
          streamPublication: true,
        });
        await waitForPausedWrite;
        expect(published).toBe(false);
        let admitted = 0;
        for await (const row of history.streamRawHistory()) {
          expect(row).toStrictEqual(
            admitted === 0 ? batchRow(20000) : batch[0],
          );
          admitted++;
        }
        expect(admitted).toBe(2);
        releaseWriter();
        await operation;
        expect(published).toBe(true);
        expect(history.getTotalTokens()).toBe(8);
        await history.waitForCommit();
      },
    );
  });
});
