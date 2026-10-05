/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

function aggregate(error: unknown): AggregateError {
  expect(error).toBeInstanceOf(AggregateError);
  if (!(error instanceof AggregateError)) throw new Error('Missing aggregate');
  return error;
}

describe('history mutation cleanup after compensation failure', () => {
  it('orders primary, partially admitted compensation and ownership failures while restoring local state', async () => {
    await withRollbackFixture(async (history, recorder) => {
      await history.addBatch([rollbackRow(0)]);
      const primary = new Error('publication failed');
      const ownershipFailure = new Error('ownership rollback failed');
      history.registerMediaOwner(
        mediaParticipant(() => ({
          publish: () => undefined,
          rollback: () => {
            throw ownershipFailure;
          },
        })),
      );
      const replacement = [rollbackRow(1), rollbackRow(2)];
      const error = aggregate(
        await rejectedValue(
          history.replaceBatch(replacement, undefined, {
            afterPublication: () => {
              recorder.failAdmissionAfter(1);
              throw primary;
            },
          }),
        ),
      );
      expect(error.errors).toStrictEqual([
        primary,
        recorder.failure,
        ownershipFailure,
      ]);
      expect(replacement.map((row) => row.metadata)).toStrictEqual([
        undefined,
        undefined,
      ]);
      expect(history.getTotalTokens()).toBe(4);
      const following = rollbackRow(3);
      await history.addBatch([following]);
      expect(following.metadata?.chronology?.seq).toBe(2);
    });
  });
});

describe('history mutation cleanup after marker restoration failure', () => {
  it('continues row and ownership cleanup when a callback makes one marker unrestorable', async () => {
    await withRollbackFixture(async (history) => {
      const before = [rollbackRow(0)];
      await history.addBatch(before);
      const marker = { seq: 700, userTurn: 90, step: 3, recordedAt: 0 };
      const poisoned = { ...rollbackRow(1), metadata: { chronology: marker } };
      const fresh = rollbackRow(2);
      const primary = new Error('callback failed');
      let ownership = 'baseline';
      history.registerMediaOwner(
        mediaParticipant(() => ({
          publish: () => {
            ownership = 'replacement';
          },
          rollback: () => {
            ownership = 'baseline';
          },
        })),
      );
      const error = aggregate(
        await rejectedValue(
          history.replaceBatch([poisoned, fresh], undefined, {
            afterPublication: () => {
              poisoned.metadata.chronology = { ...marker, seq: 900 };
              Object.freeze(poisoned.metadata);
              throw primary;
            },
          }),
        ),
      );
      expect(error.errors).toHaveLength(2);
      expect(error.errors[0]).toBe(primary);
      expect(error.errors[1]).toBeInstanceOf(TypeError);
      expect(fresh.metadata).toBeUndefined();
      expect(ownership).toBe('baseline');
      expect(await rowsOf(history)).toStrictEqual(before);
      expect(history.getTotalTokens()).toBe(4);
      const following = rollbackRow(3);
      await history.addBatch([following]);
      expect(following.metadata?.chronology?.seq).toBe(2);
    });
  });
});

describe('chronology identity with caller-owned strong marker references', () => {
  for (const count of [512, 8192]) {
    it(`restores ${count} caller-owned identities after callback overwrite and GC`, async () => {
      await withRollbackFixture(async (history) => {
        const markers = Array.from({ length: count }, (_unused, index) => ({
          seq: index + 10,
          userTurn: 2,
          step: index + 1,
          recordedAt: 0,
        }));
        const rows = markers.map((chronology, index) => ({
          ...rollbackRow(index),
          metadata: { chronology },
        }));
        const primary = new Error('displaced caller markers');
        const error = await rejectedValue(
          history.replaceBatch(rows, undefined, {
            afterPublication: async () => {
              for (const row of rows) {
                row.metadata.chronology = { ...row.metadata.chronology };
              }
              await Bun.sleep(0);
              Bun.gc(true);
              throw primary;
            },
          }),
        );
        expect(error).toBe(primary);
        for (const [index, row] of rows.entries()) {
          expect(row.metadata.chronology).toBe(markers[index]);
        }
        expect(await rowsOf(history)).toStrictEqual([]);
      });
    }, 120_000);
  }
});
