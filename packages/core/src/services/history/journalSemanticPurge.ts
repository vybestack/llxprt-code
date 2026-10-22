/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DetachedHistoryHost } from './detachedHistoryMutation.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import { restoreCheckpointVersion } from './journalCheckpoints.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import { freezeSemanticPurgeValue } from './semantic-media-purge.js';
import type { SemanticPurgeSnapshot } from './semantic-purge-native.js';

export async function openJournalSemanticPurge(
  store: JournalHistoryStore,
  host: DetachedHistoryHost,
): Promise<SemanticPurgeSnapshot> {
  const snapshot = await store.settledSnapshot(() =>
    host.waitForTokenUpdates(),
  );
  const dump = new JournalDumpSnapshot(snapshot, store.resumeBoundary);
  const mark = store.captureCompensation();
  const state = host.snapshot();
  const mutation = store.mutationMark();
  let closed = false;
  return {
    requestSnapshot: snapshot,
    prepareRequestFormat: store.prepareRequestFormat,
    mediaStore: store.pinnedMediaStore(),
    length: dump.rawLength,
    readRow: async (index) => {
      const row = await dump.readRawRow(index);
      freezeSemanticPurgeValue(row);
      return row;
    },
    async *streamRows(signal) {
      for await (const row of dump.checkpointRows(signal)) {
        freezeSemanticPurgeValue(row);
        yield row;
      }
    },
    isCurrent: () => store.isCurrentMutationMark(mutation),
    restore: async () => {
      if (closed) throw new Error('Semantic media purge transaction is closed');
      const before = host.snapshot();
      await restoreCheckpointVersion(store, host, mark);
      host.chronology.restore(state.chronology);
      host.apply(state.tokens, state.spans);
      await store.waitForCommit();
      host.notify(
        state.tokens - before.tokens,
        store.contextRange(state.spans),
      );
    },
    close: async () => {
      if (closed) return;
      closed = true;
      const failures: unknown[] = [];
      for (const close of [
        () => dump.close(),
        () => store.releaseCompensation(mark),
      ]) {
        try {
          await close();
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0)
        throw historyMutationFailure(failures[0], failures.slice(1));
    },
  };
}
