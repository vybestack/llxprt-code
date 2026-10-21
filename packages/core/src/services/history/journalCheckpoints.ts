/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { JournalSession } from './journalSession.js';
import type { JournalMirrors } from './journalMirrors.js';
import { ContextRangeAccumulator } from './contextRange.js';
import type {
  DetachedHistoryHost,
  DetachedState,
} from './detachedHistoryMutation.js';
import type { HistoryCheckpointRows } from './historyCheckpointRows.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';
import {
  historyMutationFailure,
  rollbackMutationEffects,
} from './historyMutationEffects.js';
import { finalizeMutationEffects } from './historyMutationFailure.js';
import {
  prepareMediaReplacement,
  snapshotReferences,
} from './journalMediaReferences.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';

type Enqueue = (execute: () => Promise<void>) => Promise<void>;

export function journalCheckpointReader(
  store: JournalHistoryStore,
  counters: () => JournalReadCounters | undefined,
): <T>(
  host: DetachedHistoryHost,
  enqueue: Enqueue,
  execute: (checkpoint: HistoryCheckpointRows) => Promise<T>,
  signal?: AbortSignal,
) => Promise<T> {
  return (host, enqueue, execute, signal) =>
    withCheckpointOnJournal(store, host, enqueue, execute, signal, counters());
}

export class JournalCheckpointLifetime {
  private holds = 0;
  private closed = false;
  private retire: (() => Promise<void>) | undefined;

  hold(): () => Promise<void> {
    if (this.closed) throw new Error('The checkpoint store is disposed');
    this.holds++;
    let released = false;
    return async (): Promise<void> => {
      if (released) throw new Error('The checkpoint hold was released twice');
      released = true;
      this.holds--;
      if (this.holds === 0) await this.finish();
    };
  }

  async close(retire: () => Promise<void>): Promise<void> {
    this.closed = true;
    this.retire = retire;
    if (this.holds === 0) await this.finish();
  }

  async closePrimary(
    primary: { mirrors: JournalMirrors; session: JournalSession },
    adopted: boolean,
  ): Promise<void> {
    try {
      await primary.mirrors.retire();
    } finally {
      if (!adopted) await this.close(() => primary.session.close());
    }
  }

  private async finish(): Promise<void> {
    const retire = this.retire;
    this.retire = undefined;
    await retire?.();
  }
}

/** The rows of `snapshot` as a checkpoint: the version is fixed, each pass reads it again. */
function snapshotCheckpoint(
  snapshot: VersionSnapshot,
  signal: AbortSignal | undefined,
  dump: JournalDumpSnapshot,
): HistoryCheckpointRows {
  return {
    length: snapshot.rows,
    humanCut: (turns, fromEnd) => dump.humanCut(turns, fromEnd),
    mediaReferences: () => dump.mediaReferences(),
    compressionInput: { previous: dump, rows: dump },
    [Symbol.asyncIterator]: () => dump.checkpointRows(signal),
  };
}

/**
 * Settles the queue and the token updates inside the service queue, then runs
 * `execute` outside it (so it can publish) over the rows of the settled
 * version.
 */
export async function withCheckpointOnJournal<T>(
  store: JournalHistoryStore,
  host: DetachedHistoryHost,
  enqueue: Enqueue,
  execute: (checkpoint: HistoryCheckpointRows) => Promise<T>,
  signal?: AbortSignal,
  counters?: JournalReadCounters,
): Promise<T> {
  const captured: { snapshot?: VersionSnapshot; dump?: JournalDumpSnapshot } =
    {};
  const release = store.checkpointLifetime.hold();
  let failure: { error: unknown } | undefined;
  try {
    await enqueue(async () => {
      captured.snapshot = await store.settledSnapshot(
        () => host.waitForTokenUpdates(),
        signal,
      );
    });
    signal?.throwIfAborted();
    if (captured.snapshot === undefined)
      throw new Error('The checkpoint was not captured');
    captured.dump = new JournalDumpSnapshot(
      captured.snapshot,
      store.resumeBoundary,
      counters,
    );
    return await execute(
      snapshotCheckpoint(captured.snapshot, signal, captured.dump),
    );
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    await releaseCheckpoint(
      captured.dump ?? captured.snapshot,
      release,
      failure,
    );
  }
}

async function releaseCheckpoint(
  snapshot: Pick<VersionSnapshot, 'close'> | undefined,
  release: () => Promise<void>,
  failure: { error: unknown } | undefined,
): Promise<void> {
  const failures: unknown[] = [];
  for (const close of [() => snapshot?.close(), release]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    if (failure !== undefined)
      throw historyMutationFailure(failure.error, failures);
    throw historyMutationFailure(failures[0], failures.slice(1));
  }
}

/**
 * A checkpoint that can put the history back: the version, the token total,
 * the spans and the chronology counters as they were. Restoring is
 * `restore(version)` of the saved version, one group, and nothing when no
 * group was published since.
 */
export async function withRollbackCheckpointOnJournal<T>(
  store: JournalHistoryStore,
  host: DetachedHistoryHost,
  enqueue: Enqueue,
  execute: (restore: () => Promise<void>) => Promise<T>,
): Promise<T> {
  const scope: { state?: DetachedState; mark?: JournalMark } = {};
  await enqueue(async () => {
    await (
      await store.settledSnapshot(() => host.waitForTokenUpdates())
    ).close();
    scope.mark = store.captureCompensation();
    scope.state = host.snapshot();
  });
  const restore = (): Promise<void> =>
    enqueue(async () => {
      const { mark, state } = scope;
      if (mark === undefined || state === undefined)
        throw new Error('Detached rollback checkpoint is closed');
      const before = host.snapshot();
      await restoreVersion(store, host, mark);
      const range = new ContextRangeAccumulator();
      for await (const row of store.streamRows()) range.add(row);
      host.chronology.restore(state.chronology);
      host.apply(state.tokens, state.spans);
      host.notify(state.tokens - before.tokens, range.snapshot(state.spans));
    });
  try {
    return await execute(restore);
  } finally {
    const { mark } = scope;
    scope.mark = undefined;
    scope.state = undefined;
    if (mark !== undefined) await store.releaseCompensation(mark);
  }
}

/**
 * Puts the saved version back. With a media owner the references of the
 * saved rows are reserved first, streamed from the saved version, and the
 * owner swaps its holdings only once the version is back; if either step
 * fails the owner's effect is rolled back and the failure reported with any
 * rollback failure.
 */
async function restoreVersion(
  store: JournalHistoryStore,
  host: DetachedHistoryHost,
  mark: JournalMark,
): Promise<void> {
  const owner = host.mediaOwner;
  if (owner === undefined) {
    await store.compensate(mark, undefined);
    return;
  }
  const effect = await prepareMediaReplacement(
    owner,
    snapshotReferences(await mark.saved),
    host.ownership,
  );
  try {
    await effect.publish();
    await store.compensate(mark, undefined);
  } catch (error) {
    throw historyMutationFailure(
      error,
      await rollbackMutationEffects([effect]),
    );
  }
  await finalizeMutationEffects([effect]);
}

type JournalMark = ReturnType<JournalHistoryStore['captureCompensation']>;
