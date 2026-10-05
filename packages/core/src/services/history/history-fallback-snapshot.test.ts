/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { readdirSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  withRollbackFixture,
  rollbackRow,
} from './chronology-rollback-test-helpers.js';

function scratch(): string[] {
  return readdirSync(tmpdir())
    .filter(
      (name) =>
        name.startsWith('history-mutation-') ||
        name.startsWith('history-density-'),
    )
    .sort();
}

describe('scoped raw fallback snapshot', () => {
  it('restores the caller marker object after overwrite and forced GC', async () => {
    await withRollbackFixture(async (history, _recorder, release) => {
      const row = rollbackRow(0);
      history.add(row);
      await history.waitForTokenUpdates();
      if (row.metadata?.chronology === undefined)
        throw new Error('Missing fixture marker');
      const weak = new WeakRef(row.metadata.chronology);
      await history.withRawHistorySnapshot(async (snapshot) => {
        await history.replaceAll([rollbackRow(1)]);
        row.metadata = {
          chronology: { seq: 999, userTurn: 999, step: 999, recordedAt: 0 },
        };
        Bun.gc(true);
        await history.restoreRawHistorySnapshot(snapshot);
        const restored = snapshot.readRow(0);
        expect(restored).toBe(row);
        expect(restored.metadata?.chronology).toBe(weak.deref());
        expect(restored.metadata?.chronology?.seq).toBe(1);
      });
      release();
    }, true);
  });

  it('pins membership across live replacement and rejects a damaged snapshot before publication', async () => {
    await withRollbackFixture(async (history, recorder) => {
      await history.transformRows(async (_source, sink) => {
        sink.appendDetached(rollbackRow(0));
      });
      await recorder.flush();
      const before = scratch();
      await history.withRawHistorySnapshot(async (snapshot) => {
        const added = scratch().filter((name) => !before.includes(name));
        expect(added.length).toBe(1);
        await history.transformRows(async (_source, sink) => {
          sink.appendDetached(rollbackRow(1));
        });
        expect(snapshot.readRow(0).blocks[0]).toStrictEqual(
          rollbackRow(0).blocks[0],
        );
        truncateSync(join(tmpdir(), added[0], 'index'), 0);
        await expect(
          history.restoreRawHistorySnapshot(snapshot),
        ).rejects.toThrow(/boundary/);
        const current: unknown[] = [];
        for await (const row of history.streamRawHistory())
          current.push(row.blocks);
        expect(current).toStrictEqual([rollbackRow(1).blocks]);
      });
      expect(scratch().filter((name) => !before.includes(name))).toStrictEqual(
        [],
      );
    });
  });

  it('closes scratch after consumer throw and pre-abort', async () => {
    await withRollbackFixture(async (history) => {
      history.add(rollbackRow(0));
      const before = scratch();
      await expect(
        history.withRawHistorySnapshot(async () => {
          throw new Error('consumer failed');
        }),
      ).rejects.toThrow('consumer failed');
      const abort = new AbortController();
      abort.abort(new Error('cancelled snapshot'));
      await expect(
        history.withRawHistorySnapshot(async () => {
          throw new Error('must not run');
        }, abort.signal),
      ).rejects.toThrow('cancelled snapshot');
      expect(scratch().filter((name) => !before.includes(name))).toStrictEqual(
        [],
      );
    });
  });
});
