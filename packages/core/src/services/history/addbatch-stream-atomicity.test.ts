/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { gcAndSweep } from 'bun:jsc';
import type { HistoryBatchValues } from './history-batch-values.js';
import { batchGate, batchRow } from './addbatch-stream-test-helpers.js';
import {
  durableRowsOf,
  mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

async function retryAfterFailure(
  size: number,
  observer: boolean,
): Promise<void> {
  await withRollbackFixture(async (history, recorder) => {
    await history.addBatch([batchRow(20000)]);
    await history.waitForCommit();
    const batch = Array.from({ length: size }, (_, index) => batchRow(index));
    const ready = batchGate();
    const release = batchGate();
    const failure = new Error('observer rollback');
    if (!observer) recorder.failAdmissionAfter(7);
    const operation = history.addBatch(batch, undefined, {
      streamPublication: true,
      afterPublication: async () => {
        if (!observer) return;
        ready.resolve();
        await release.promise;
        throw failure;
      },
    });
    if (observer) await ready.promise;
    const queued = rollbackRow(90000);
    history.add(queued);
    release.resolve();
    expect(await rejectedValue(operation)).toBe(
      observer ? failure : recorder.failure,
    );
    await history.waitForTokenUpdates();
    expect(history.getTotalTokens()).toBe(8);
    const prior = await rowsOf(history);
    expect(prior).toHaveLength(2);
    expect(prior[0]).toStrictEqual(batchRow(20000));
    expect(prior[1]).toStrictEqual(queued);
    expect(queued.metadata?.chronology?.seq).toBe(20002);
    await history.waitForCommit();
    expect(await durableRowsOf(recorder)).toStrictEqual(prior);
    await history.addBatch(batch, undefined, { streamPublication: true });
    expect(history.getTotalTokens()).toBe(8 + 4 * size);
    const retried = await rowsOf(history);
    expect(retried).toStrictEqual([...prior, ...batch]);
    await history.waitForCommit();
    expect(await durableRowsOf(recorder)).toStrictEqual(retried);
  });
}

describe('addBatch streamed atomicity', () => {
  it('does not await a caller-paused writer in default publication or compensation', async () => {
    await withRollbackFixture(async (history, recorder, releaseWriter) => {
      const batch = [rollbackRow(0), rollbackRow(1)];
      const failure = new Error('pending batch listener');
      history.once('contentBatchAdded', () => {
        throw failure;
      });
      expect(await rejectedValue(history.addBatch(batch))).toBe(failure);
      expect(await rowsOf(history)).toStrictEqual([]);
      expect(batch.map((row) => row.metadata)).toStrictEqual([
        undefined,
        undefined,
      ]);
      expect(history.getTotalTokens()).toBe(0);
      await history.addBatch(batch);
      expect(await rowsOf(history)).toStrictEqual(batch);
      releaseWriter();
      await history.waitForCommit();
      expect(await durableRowsOf(recorder)).toStrictEqual(batch);
    }, true);
  });
  it.each([512, 8192])(
    'compensates partial admission of %i mixed rows before a queued add and retries',
    async (size) => {
      await expect(retryAfterFailure(size, false)).resolves.toBeUndefined();
    },
    180000,
  );
  it.each([512, 8192])(
    'compensates observer rejection of %i mixed rows before a queued add and retries',
    async (size) => {
      await expect(retryAfterFailure(size, true)).resolves.toBeUndefined();
    },
    180000,
  );
});

describe('addBatch marker and serialization rollback', () => {
  it('restores displaced original marker identities after GC and repeated fresh inputs', async () => {
    await withRollbackFixture(async (history) => {
      const marker = { seq: 90, userTurn: 40, step: 7, recordedAt: 123 };
      const caller = { ...rollbackRow(0), metadata: { chronology: marker } };
      const fresh = rollbackRow(1);
      const failure = new Error('displaced batch marker');
      expect(
        await rejectedValue(
          history.addBatch([caller, fresh, fresh], undefined, {
            afterPublication: () => {
              caller.metadata.chronology = { ...marker, seq: 900 };
              gcAndSweep();
              throw failure;
            },
          }),
        ),
      ).toBe(failure);
      expect(caller.metadata.chronology).toBe(marker);
      expect(fresh.metadata).toBeUndefined();
      expect(await rowsOf(history)).toStrictEqual([]);
      history.once('contentBatchAdded', (published) => {
        published.withRows((cursor) => {
          cursor.next();
          cursor.next();
          const item = cursor.next();
          if (item.done === true) throw new Error('Missing third event row');
          expect(item.value.metadata?.chronology).not.toBe(marker);
          expect(item.value.metadata?.chronology).toStrictEqual(marker);
          expect(cursor.next().done).toBe(true);
        });
      });
      await history.addBatch([fresh, fresh, caller]);
      expect(fresh.metadata?.chronology?.seq).toBe(1);
      expect(await rowsOf(history)).toStrictEqual([fresh, fresh, caller]);
      expect(history.getTotalTokens()).toBe(12);
    });
  });
});

describe('addBatch serialization rollback', () => {
  it.each([512, 8192])(
    'compensates later serialization of %i rows and retries without changing markers',
    async (size) => {
      await withRollbackFixture(async (history, recorder) => {
        await history.addBatch([batchRow(20000)]);
        await history.waitForCommit();
        const batch = Array.from({ length: size }, (_, index) =>
          batchRow(index),
        );
        let failSerialization = false;
        const fault = new Error('later serialization failed');
        Object.defineProperty(batch[10].metadata, 'timestamp', {
          enumerable: true,
          get: () => {
            if (failSerialization) throw fault;
            return 1700000000010;
          },
        });
        history.registerMediaOwner(
          mediaParticipant(() => ({
            publish: () => {
              failSerialization = true;
            },
            rollback: () => {
              failSerialization = false;
            },
          })),
        );
        expect(
          await rejectedValue(
            history.addBatch(batch, undefined, { streamPublication: true }),
          ),
        ).toBe(fault);
        expect(await rowsOf(history)).toStrictEqual([batchRow(20000)]);
        expect(history.getTotalTokens()).toBe(4);
        await history.waitForCommit();
        expect(await durableRowsOf(recorder)).toStrictEqual([batchRow(20000)]);
        history.registerMediaOwner(
          mediaParticipant(() => ({ publish: () => {}, rollback: () => {} })),
        );
        await history.addBatch(batch, undefined, { streamPublication: true });
        expect(history.getTotalTokens()).toBe(4 + 4 * size);
        expect(await rowsOf(history)).toStrictEqual([
          batchRow(20000),
          ...batch,
        ]);
      });
    },
    180000,
  );
});

describe('addBatch scaled caller identity rollback', () => {
  it.each([512, 8192])(
    'restores displaced markers after GC for %i external rows and duplicate identities',
    async (size) => {
      await withRollbackFixture(async (history) => {
        const batch = Array.from({ length: size }, (_, index) =>
          batchRow(index, 64),
        );
        batch[1] = batch[0];
        for (let index = 64; index < size; index += 64) {
          const metadata = batch[index].metadata;
          if (metadata === undefined)
            throw new Error('Missing fixture metadata');
          metadata.chronology = batch[0].metadata?.chronology;
        }
        const markers = batch.map((row) => {
          const marker = row.metadata?.chronology;
          if (marker === undefined) throw new Error('Missing fixture marker');
          return new WeakRef(marker);
        });
        const failure = new Error('scaled marker displacement');
        let eventRows = 0;
        const observe = (published: HistoryBatchValues): void => {
          eventRows = published.length;
          published.withRows((cursor) => {
            for (let index = 0; index < 2; index++) {
              const item = cursor.next();
              if (item.done === true)
                throw new Error('Missing duplicate event row');
              expect(item.value).not.toBe(batch[0]);
              expect(item.value).toStrictEqual(batch[0]);
            }
          });
        };
        history.once('contentBatchAdded', observe);
        expect(
          await rejectedValue(
            history.addBatch(batch, undefined, {
              streamPublication: true,
              afterPublication: () => {
                for (const row of batch) {
                  const metadata = row.metadata;
                  const marker = metadata?.chronology;
                  if (metadata === undefined || marker === undefined)
                    throw new Error('Missing stamped marker');
                  metadata.chronology = { ...marker, seq: 900000 };
                }
                gcAndSweep();
                throw failure;
              },
            }),
          ),
        ).toBe(failure);
        expect(eventRows).toBe(size);
        expect(await rowsOf(history)).toStrictEqual([]);
        expect(history.getTotalTokens()).toBe(0);
        for (let index = 0; index < size; index++) {
          expect(markers[index].deref()).toBeDefined();
          expect(batch[index].metadata?.chronology).toBe(
            markers[index].deref(),
          );
        }
        const fresh = rollbackRow(size);
        await history.addBatch([fresh], undefined, { streamPublication: true });
        expect(fresh.metadata?.chronology?.seq).toBe(1);
        await history.addBatch(batch, undefined, { streamPublication: true });
        expect(await rowsOf(history)).toStrictEqual([fresh, ...batch]);
        expect(history.getTotalTokens()).toBe(4 * size + 4);
      });
    },
    180000,
  );
});
