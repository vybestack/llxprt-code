/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  journalMediaParticipant as mediaParticipant,
  rejectedValue,
  rollbackRow,
  rowBodies,
  rowsOf,
  withRollbackFixture,
} from './chronology-rollback-test-helpers.js';

describe('history mutation cleanup after marker restoration failure', () => {
  it('ignores a callback that poisons a caller marker and still cleans up rows and ownership', async () => {
    await withRollbackFixture(async (history) => {
      const before = [rollbackRow(0)];
      await history.addBatch(before);
      const marker = { seq: 700, userTurn: 90, step: 3, recordedAt: 0 };
      const poisoned = { ...rollbackRow(1), metadata: { chronology: marker } };
      const fresh = rollbackRow(2);
      const primary = new Error('callback failed');
      let ownership = 'baseline';
      await history.registerMediaOwner(
        mediaParticipant(() => ({
          publish: () => {
            ownership = 'replacement';
          },
          rollback: () => {
            ownership = 'baseline';
          },
        })),
      );
      const error = await rejectedValue(
        history.replaceBatch([poisoned, fresh], undefined, {
          afterPublication: () => {
            poisoned.metadata.chronology = { ...marker, seq: 900 };
            Object.freeze(poisoned.metadata);
            throw primary;
          },
        }),
      );
      expect(error).toBe(primary);
      expect(fresh.metadata).toBeUndefined();
      expect(ownership).toBe('baseline');
      expect(rowBodies(await rowsOf(history))).toStrictEqual(rowBodies(before));
      expect(history.getTotalTokens()).toBe(4);
      const following = rollbackRow(3);
      await history.addBatch([following]);
      expect((await rowsOf(history))[1].metadata?.chronology?.seq).toBe(2);
    });
  });
});

describe('chronology identity with caller-owned strong marker references', () => {
  for (const count of [512, 8192]) {
    it(`does not retain or restore ${count} caller marker identities after callback overwrite and GC`, async () => {
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
          expect(row.metadata.chronology).toStrictEqual(markers[index]);
          expect(row.metadata.chronology).not.toBe(markers[index]);
        }
        expect(await rowsOf(history)).toStrictEqual([]);
      });
    }, 120_000);
  }
});
