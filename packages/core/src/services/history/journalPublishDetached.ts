/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import { DensitySpanRows } from './densitySpanRows.js';
import type {
  DetachedHistoryHost,
  DetachedHistoryOptions,
  DetachedHistorySource,
  DetachedHistoryTask,
} from './detachedHistoryMutation.js';
import type { PreparedHistoryBatchEffect } from './historyBatchContracts.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import {
  historyMutationFailure,
  rollbackMutationEffects,
} from './historyMutationEffects.js';
import { finalizeMutationEffects } from './historyMutationFailure.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import { JournalCandidate } from './journalDetachedCandidate.js';
import { snapshotRows } from './journalDetachedCapture.js';
import { JournalDetachedPublication } from './journalDetachedPublication.js';
import { pullFeed, type PullFeed } from './journalDetachedStream.js';
import type { JournalHistoryStore } from './journalHistoryStore.js';

type MediaFeed = PullFeed<MediaReferenceBlock, void>;

/**
 * Runs a detached task against the rows of the version the queue has reached
 * and publishes what it produces (design 4.5). The transform's output streams
 * into the store one row at a time (backpressure through the sink's promises),
 * so nothing history-sized is held between them. A result that equals the
 * previous rows writes nothing and a cut tail is one rewind; any other result
 * is one `replace` group opened at the first row that differs. A failure
 * mid-stream aborts the group before its trailer, so the previous version stays
 * published.
 */
export async function publishDetachedOnJournal(
  store: JournalHistoryStore,
  task: DetachedHistoryTask,
  host: DetachedHistoryHost,
  modelName: string | undefined,
  options: DetachedHistoryOptions,
): Promise<void> {
  const snapshot = await store.settledSnapshot(
    () => host.waitForTokenUpdates(),
    options.signal,
  );
  const state = host.snapshot();
  const appendOnly = task.append === true;
  const effects: PreparedHistoryBatchEffect[] = [];
  const densitySpans = new DensitySpanRows();
  const publication = new JournalDetachedPublication(store);
  const media = mediaFeed(host, appendOnly, effects);
  const candidate = new JournalCandidate({
    snapshot,
    host,
    modelName,
    signal: options.signal,
    publication,
    densitySpans,
    appendOnly,
    baseTokens: appendOnly ? state.tokens : 0,
    media,
  });
  const scope = store.openPublication();
  let derived: Parameters<DetachedHistoryHost['apply']> | undefined;
  let failure: { error: unknown } | undefined;
  try {
    await candidate.seedRange();
    await transformCandidate(task, snapshot, candidate, options.signal);
    if (!appendOnly || candidate.count > 0) {
      const rewound = await candidate.rewoundSpan();
      const spans = densitySpans.project(
        state.spans,
        rewound === undefined ? [] : mergeRemovedInteriorSpans([rewound]),
      );
      derived = [candidate.tokens, spans];
      await media?.close();
      await candidate.finish();
      host.apply(candidate.tokens, spans);
      await finishPublication(store, host, candidate, spans, state.tokens, {
        effects,
        options,
        appendOnly,
      });
      scope.close(true);
    }
  } catch (error) {
    failure = { error };
    await media?.abort(error);
    await candidate.abort(error);
    const failures = await compensate({
      host,
      state,
      publication,
      derived,
      effects,
      appendOnly,
    });
    failure = { error: historyMutationFailure(error, failures) };
  } finally {
    scope.close(false);
  }
  const closing = closeTask(task, densitySpans);
  if (failure !== undefined) throw failure.error;
  if (closing.length > 0)
    throw new AggregateError(closing, 'Detached mutation cleanup failed');
}

function mediaFeed(
  host: DetachedHistoryHost,
  appendOnly: boolean,
  effects: PreparedHistoryBatchEffect[],
): MediaFeed | undefined {
  const owner = host.mediaOwner;
  if (owner === undefined) return undefined;
  if (appendOnly) {
    throw new Error(
      'not implemented: S06 (media ownership of an appended detached batch)',
    );
  }
  const prepare = owner.prepareReferenceReplacement?.bind(owner);
  if (prepare === undefined) {
    throw new Error('History media owner does not support journal replacement');
  }
  return pullFeed<MediaReferenceBlock, void>(async (references) => {
    const effect = await prepare(references, host.ownership);
    effects.push(effect);
    await effect.publish();
  });
}

async function transformCandidate(
  task: DetachedHistoryTask,
  snapshot: VersionSnapshot,
  candidate: JournalCandidate,
  signal: AbortSignal | undefined,
): Promise<void> {
  let active = true;
  const assertActive = (): void => {
    if (!active) throw new Error('Detached history scope is closed');
    signal?.throwIfAborted();
  };
  const cursors = new Set<AsyncGenerator<IContent, void, unknown>>();
  const source: DetachedHistorySource = {
    length: snapshot.rows,
    streamRows(cursorSignal) {
      assertActive();
      const cursor = scopedRows(
        snapshotRows(snapshot, cursorSignal),
        assertActive,
        () => cursors.delete(cursor),
      );
      cursors.add(cursor);
      return cursor;
    },
  };
  let failure: { error: unknown } | undefined;
  try {
    assertActive();
    if (task.transform === undefined)
      throw new Error('Detached transform already consumed');
    await task.transform(source, candidate.sink(assertActive));
    assertActive();
  } catch (error) {
    failure = { error };
  }
  active = false;
  task.transform = undefined;
  const failures: unknown[] = [];
  for (const cursor of cursors) {
    try {
      await cursor.return();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failure !== undefined)
    throw historyMutationFailure(failure.error, failures);
  if (failures.length > 0)
    throw new AggregateError(failures, 'Detached cursor cleanup failed');
}

async function* scopedRows(
  rows: AsyncGenerator<IContent, void, unknown>,
  assertActive: () => void,
  close: () => void,
): AsyncGenerator<IContent, void, unknown> {
  try {
    for await (const row of rows) {
      assertActive();
      yield row;
    }
    assertActive();
  } finally {
    close();
  }
}

interface FinishInput {
  readonly effects: readonly PreparedHistoryBatchEffect[];
  readonly options: DetachedHistoryOptions;
  readonly appendOnly: boolean;
}

/** After the ack: observers, the caller's hooks, media finalization, then the context range. */
async function finishPublication(
  store: JournalHistoryStore,
  host: DetachedHistoryHost,
  candidate: JournalCandidate,
  spans: readonly RemovedInteriorSpan[],
  previousTokens: number,
  { effects, options, appendOnly }: FinishInput,
): Promise<void> {
  const delta = candidate.tokens - previousTokens;
  if (options.publishBatch === true) {
    // One event, after the ack, over the committed version: observers never hear of rows a failed group dropped.
    host.notifyRows(
      store.committedBatch(appendOnly ? candidate.count : undefined),
    );
    host.notifyTokens(delta);
  } else if (options.publishTokens === true) host.notifyTokens(delta);
  await options.onAcknowledged?.();
  options.signal?.throwIfAborted();
  await options.afterPublication?.();
  options.signal?.throwIfAborted();
  await finalizeMutationEffects(effects);
  options.signal?.throwIfAborted();
  const range = candidate.range.snapshot(spans);
  if (options.publishBatch === true || options.publishTokens === true)
    host.notifyRange(range);
  else host.notify(delta, range);
}

interface CompensationInput {
  readonly host: DetachedHistoryHost;
  readonly state: ReturnType<DetachedHistoryHost['snapshot']>;
  readonly publication: JournalDetachedPublication;
  readonly derived: Parameters<DetachedHistoryHost['apply']> | undefined;
  readonly effects: readonly PreparedHistoryBatchEffect[];
  readonly appendOnly: boolean;
}

/**
 * Takes back what the failed publication admitted. Derived state follows the
 * durable version: when the replacement is durable and could not be undone it
 * holds the new rows, so the new tokens and spans stay; otherwise the previous
 * rows are still the version.
 */
async function compensate(input: CompensationInput): Promise<unknown[]> {
  const { host, state, publication, derived, effects, appendOnly } = input;
  const failures: unknown[] = [];
  let compensated = true;
  if (publication.admittedCount > 0) {
    try {
      await publication.compensate();
    } catch (error) {
      failures.push(error);
      compensated = false;
    }
  }
  const keepNew =
    !compensated && !appendOnly && publication.durable && derived !== undefined;
  try {
    if (keepNew) host.apply(derived[0], derived[1]);
    else {
      host.apply(state.tokens, state.spans);
      host.chronology.restore(state.chronology);
    }
  } catch (error) {
    failures.push(error);
  }
  failures.push(...(await rollbackMutationEffects(effects)));
  return failures;
}

function closeTask(
  task: DetachedHistoryTask,
  densitySpans: DensitySpanRows,
): unknown[] {
  task.transform = undefined;
  const failures: unknown[] = [];
  for (const close of [() => task.dispose?.(), () => densitySpans.close()]) {
    try {
      close();
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}
