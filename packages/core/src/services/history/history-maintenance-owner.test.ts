import { createTestScratchOwner } from '@vybestack/llxprt-code-core/storage/__tests__/support/scratch-owner.js';
import { withTestNamedWriters } from '../../journal/__tests__/support/namedWriterOwner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { DeferredMaintenance } from '../../journal/deferred-maintenance.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from '../../recording/journalRecordingService.js';
import { HistoryService } from './HistoryService.js';
const historyScratchRoots = createTestScratchOwner();

function fail(error: unknown): never {
  throw error;
}

describe('history maintenance ownership', () => {
  const directory = useTempDir('history-maintenance-owner-');

  it('shares a live suspension with delayed recorders and the admission journal after adoption', async () => {
    const history = new HistoryService({ scratchRoots: historyScratchRoots });
    const sourceScope = history.maintenanceScope;
    const recorders = ['a', 'b'].map((sessionId) =>
      JournalRecordingService.create(
        withTestNamedWriters({
          sessionId,
          projectHash: 'maintenance-owner',
          chatsDir: directory(),
          workspaceDirs: [],
          provider: 'test',
          model: 'test',
        }),
      ),
    );
    const [a, b] = recorders;
    const originA = Object.freeze({});
    const originB = Object.freeze({});
    let release: (() => void) | undefined;
    try {
      await history.attachJournal(a, false, undefined, originA);
      expect(a.getFilePath()).toBeNull();
      release = await sourceScope.suspend();
      await history.addBatch(
        [{ speaker: 'human', blocks: [{ type: 'text', text: 'a' }] }],
        undefined,
        { origin: originA },
      );
      await history.waitForCommit();
      await history.attachJournal(b, false, undefined, originB);
      await history.addBatch(
        [{ speaker: 'human', blocks: [{ type: 'text', text: 'b' }] }],
        undefined,
        { origin: originB },
      );
      await history.waitForCommit();
      const scopes = [
        sourceScope,
        history.maintenanceScope,
        (await a.session()).store.maintenanceScope,
        (await b.session()).store.maintenanceScope,
      ];
      const completed: number[] = [];
      const work = scopes.map(
        (scope, index) =>
          new DeferredMaintenance(
            scope,
            async () => {
              completed.push(index);
            },
            fail,
          ),
      );
      for (const maintenance of work) maintenance.request();
      await Promise.all(work.map((maintenance) => maintenance.settle()));
      expect(completed).toStrictEqual([]);
      release();
      release = undefined;
      await Promise.all(work.map((maintenance) => maintenance.settle()));
      expect(completed.sort()).toStrictEqual([0, 1, 2, 3]);
      expect(history.length()).toBe(2);
    } finally {
      release?.();
      await history.dispose();
      for (const recorder of recorders) await recorder.dispose();
    }
  });
});
