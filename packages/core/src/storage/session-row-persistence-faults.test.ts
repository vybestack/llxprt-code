/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readFile, readdir } from 'node:fs/promises';
import type { IContent } from '../services/history/IContent.js';
import { withCoreSuffixFixture } from '../services/history/core-suffix-fixture-test-helpers.js';
import { mergeRow } from '../services/history/history-merge-test-helpers.js';
import {
  createCursorPersistence,
  seedCursorPersistence,
} from './cursor-persistence-test-helpers.js';

async function* rowsForSave(
  row: IContent,
): AsyncGenerator<IContent, void, unknown> {
  yield row;
}

describe('streamed session row persistence failures', () => {
  it('observes actual charged row writes and compensates a rejecting observer', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      const persistence = createCursorPersistence(history, 'write-observation');
      const before = await seedCursorPersistence(persistence, mergeRow(0));
      let observed = 0;
      const primary = new Error('row observation failed');
      await expect(
        persistence.saveRows(rowsForSave(mergeRow(1)), async () => {
          observed = persistence.getPendingByteCount();
          throw primary;
        }),
      ).rejects.toBe(primary);
      expect(observed).toBeGreaterThan(0);
      expect(persistence.getPendingByteCount()).toBe(0);
      expect(await readFile(persistence.getSessionFilePath(), 'utf8')).toBe(
        before,
      );
    });
  });
  it('leaves the prior target intact when the row producer fails after a written row', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      const persistence = createCursorPersistence(history, 'producer-failure');
      const before = await seedCursorPersistence(persistence, mergeRow(0));
      const primary = new Error('producer failure after row');
      let closed = false;
      async function* failedRows(): AsyncGenerator<IContent, void, unknown> {
        try {
          yield mergeRow(1);
          throw primary;
        } finally {
          closed = true;
        }
      }
      await expect(persistence.saveRows(failedRows())).rejects.toBe(primary);
      expect(await readFile(persistence.getSessionFilePath(), 'utf8')).toBe(
        before,
      );
      expect(closed).toBe(true);
      expect(persistence.getPendingByteCount()).toBe(0);
      expect(
        (await readdir(persistence.getChatsDir())).filter((name) =>
          name.endsWith('.tmp'),
        ),
      ).toStrictEqual([]);
    });
  });
});

describe('streamed persistence queue and budget', () => {
  it('releases a failed streaming transaction before processing a queued array save', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      const persistence = createCursorPersistence(history, 'queued-save');
      const primary = new Error('queued producer failure');
      async function* failedRows(): AsyncGenerator<IContent, void, unknown> {
        yield mergeRow(0);
        throw primary;
      }
      const failed = persistence.saveRows(failedRows());
      const next = mergeRow(30);
      const queued = persistence.save([next]);
      await expect(failed).rejects.toBe(primary);
      await queued;
      const session: unknown = JSON.parse(
        await readFile(persistence.getSessionFilePath(), 'utf8'),
      );
      expect(session).toMatchObject({ history: [mergeRow(30)], generation: 2 });
      expect(persistence.getPendingByteCount()).toBe(0);
    });
  });

  it('enforces the existing write budget without replacing a valid target or retaining charges', async () => {
    await withCoreSuffixFixture(1, async (history) => {
      const persistence = createCursorPersistence(history, 'write-budget', {
        maxQueueBytes: 8192,
      });
      const before = await seedCursorPersistence(persistence, mergeRow(0, 0));
      await expect(
        persistence.saveRows(rowsForSave(mergeRow(1, 16384))),
      ).rejects.toThrow('Session persistence queue byte limit exceeded');
      expect(await readFile(persistence.getSessionFilePath(), 'utf8')).toBe(
        before,
      );
      expect(persistence.getPendingByteCount()).toBe(0);
    });
  });
});
