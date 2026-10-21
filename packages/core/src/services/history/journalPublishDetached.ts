/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import { DensitySpanRows } from './densitySpanRows.js';
import { JournalDensitySpans } from './journalDensitySpans.js';
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
import { historyOriginId } from './historyOriginId.js';
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
  let snapshot: VersionSnapshot | undefined;
  let publication: JournalDetachedPublication | undefined;
  let failure: { error: unknown } | undefined;
  try {
    snapshot = await store.settledSnapshot(
      () => host.waitForTokenUpdates(),
      options.signal,
    );
    publication = new JournalDetachedPublication(store);
    await publishOver(
      snapshot,
      publication,
      store,
      task,
      host,
      modelName,
      options,
    );
  } catch (error) {
    failure = { error };
  }
  task.transform = undefined;
  const failures: unknown[] = [];
  for (const close of [() => snapshot?.close(), () => task.dispose?.()]) {
    try {
      await close();
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    await publication?.release();
  } catch (error) {
    failures.push(error);
  }
  if (failure !== undefined)
    throw historyMutationFailure(failure.error, failures);
  if (failures.length > 0)
    throw new AggregateError(failures, 'Detached publication cleanup failed');
}

async function publishOver(
  snapshot: VersionSnapshot,
  publication: JournalDetachedPublication,
  store: JournalHistoryStore,
  task: DetachedHistoryTask,
  host: DetachedHistoryHost,
  modelName: string | undefined,
  options: DetachedHistoryOptions,
): Promise<void> {
  const state = host.snapshot();
  const appendOnly = task.append === true;
  const effects: PreparedHistoryBatchEffect[] = [];
  const prepared = await createCandidate(
    snapshot,
    publication,
    store,
    task,
    host,
    modelName,
    options,
    effects,
    state,
  );
  const { candidate, media } = prepared;
  const scope = store.openPublication();
  const completion = { finalized: false };
  let derived: Parameters<DetachedHistoryHost['apply']> | undefined;
  let failure: { error: unknown } | undefined;
  try {
    derived = await prepared.produce();
    if (!appendOnly || candidate.count > 0) {
      const spans = derived[1];
      host.apply(candidate.tokens, spans);
      await finishPublication(store, host, candidate, spans, state.tokens, {
        effects,
        options,
        appendOnly,
        completion,
      });
      scope.close(true);
    } else {
      // An append that added nothing: let the media consumer end with no references.
      await media?.close();
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
      store,
      completion,
    });
    failure = { error: historyMutationFailure(error, failures) };
  } finally {
    scope.close(false);
  }
  closeTask(task, prepared.spans(), failure);
}

/**
 * The interior spans after the candidate: the density spans, the span the
 * rewind removed and the spans of the summary rows it holds. The service's span
 * window is the only source of removed interior spans on the journal path (the
 * trailer aggregate has none, WIRING G2), so the compressed spans the rows name
 * enter it here, in the same set the context range event reports.
 */
interface CandidatePreparation {
  readonly candidate: JournalCandidate;
  readonly media: MediaFeed | undefined;
  spans(): DensitySpanRows | JournalDensitySpans | undefined;
  produce(): Promise<Parameters<DetachedHistoryHost['apply']>>;
}

async function createCandidate(
  snapshot: VersionSnapshot,
  publication: JournalDetachedPublication,
  store: JournalHistoryStore,
  task: DetachedHistoryTask,
  host: DetachedHistoryHost,
  modelName: string | undefined,
  options: DetachedHistoryOptions,
  effects: PreparedHistoryBatchEffect[],
  state: ReturnType<DetachedHistoryHost['snapshot']>,
): Promise<CandidatePreparation> {
  const appendOnly = task.append === true;
  let densitySpans: DensitySpanRows | JournalDensitySpans | undefined =
    appendOnly ? new DensitySpanRows() : undefined;
  const origin =
    options.origin === undefined ? undefined : historyOriginId(options.origin);
  const owner = await store.resolveOwner(appendOnly ? undefined : origin);
  const media = mediaFeed(host, appendOnly, effects);
  const activeSpans = (): DensitySpanRows | JournalDensitySpans => {
    if (densitySpans === undefined)
      throw new Error('Span preparation is not active');
    return densitySpans;
  };
  const candidate = new JournalCandidate({
    snapshot,
    host,
    modelName,
    signal: options.signal,
    publication,
    densitySpans: { append: (span) => activeSpans().append(span) },
    appendOnly,
    baseTokens: appendOnly ? state.tokens : 0,
    media,
    owner,
    origin,
  });
  const produce = (): Promise<Parameters<DetachedHistoryHost['apply']>> =>
    produceCandidate(
      task,
      snapshot,
      candidate,
      activeSpans(),
      state,
      media,
      store.resumeBoundary,
      options.signal,
    );
  return {
    candidate,
    media,
    spans: () => densitySpans,
    produce: async () => {
      if (appendOnly) return produce();
      const result: { value?: Parameters<DetachedHistoryHost['apply']> } = {};
      await publication.prepare(async (group) => {
        densitySpans = new JournalDensitySpans(group);
        result.value = await produce();
      }, owner.edits);
      if (result.value === undefined)
        throw new Error('Detached producer returned no result');
      return result.value;
    },
  };
}

async function produceCandidate(
  task: DetachedHistoryTask,
  snapshot: VersionSnapshot,
  candidate: JournalCandidate,
  densitySpans: DensitySpanRows | JournalDensitySpans,
  state: ReturnType<DetachedHistoryHost['snapshot']>,
  media: MediaFeed | undefined,
  resumeBoundary: bigint | undefined,
  signal: AbortSignal | undefined,
): Promise<Parameters<DetachedHistoryHost['apply']>> {
  await candidate.seedRange();
  try {
    await transformCandidate(task, snapshot, candidate, signal, resumeBoundary);
    const spans = await projectedSpans(candidate, densitySpans, state);
    await media?.close();
    await candidate.finish();
    if (densitySpans instanceof JournalDensitySpans)
      await densitySpans.retain(spans);
    return [candidate.tokens, spans];
  } catch (error) {
    await media?.abort(error);
    await candidate.abort(error);
    throw error;
  }
}

async function projectedSpans(
  candidate: JournalCandidate,
  densitySpans: DensitySpanRows | JournalDensitySpans,
  state: ReturnType<DetachedHistoryHost['snapshot']>,
): Promise<RemovedInteriorSpan[]> {
  const rewound = await candidate.rewoundSpan();
  const projected = await densitySpans.project(
    state.spans,
    rewound === undefined ? [] : mergeRemovedInteriorSpans([rewound]),
  );
  return candidate.range.snapshot(projected).removedInterior;
}

function mediaFeed(
  host: DetachedHistoryHost,
  appendOnly: boolean,
  effects: PreparedHistoryBatchEffect[],
): MediaFeed | undefined {
  const owner = host.mediaOwner;
  if (owner === undefined) return undefined;
  const prepare = (
    appendOnly
      ? owner.prepareReferenceAddition
      : owner.prepareReferenceReplacement
  )?.bind(owner);
  if (prepare === undefined) {
    throw new Error(
      `History media owner does not support journal ${appendOnly ? 'append' : 'replacement'}`,
    );
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
  resumeBoundary: bigint | undefined,
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
        snapshotRows(snapshot, cursorSignal, resumeBoundary),
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
  readonly completion: { finalized: boolean };
}

/** After the ack: observers, the caller's hooks, media finalization, then the context range. */
async function finishPublication(
  store: JournalHistoryStore,
  host: DetachedHistoryHost,
  candidate: JournalCandidate,
  spans: readonly RemovedInteriorSpan[],
  previousTokens: number,
  { effects, options, appendOnly, completion }: FinishInput,
): Promise<void> {
  const delta = candidate.tokens - previousTokens;
  if (options.publishBatch === true) {
    // One event, after the ack, over the committed version: observers never hear of rows a failed group dropped.
    await host.notifyRows(
      await store.committedBatch(appendOnly ? candidate.count : undefined),
    );
    host.notifyTokens(delta);
  } else if (options.publishTokens === true) host.notifyTokens(delta);
  await options.onAcknowledged?.();
  options.signal?.throwIfAborted();
  await options.afterPublication?.();
  options.signal?.throwIfAborted();
  await finalizeMutationEffects(effects);
  completion.finalized = true;
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
  readonly store: JournalHistoryStore;
  readonly completion: { readonly finalized: boolean };
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
  if (
    compensated &&
    input.completion.finalized &&
    host.mediaOwner !== undefined
  ) {
    try {
      await input.store.reconcileMedia(host.mediaOwner);
    } catch (error) {
      failures.push(error);
    }
  }
  return failures;
}

function closeTask(
  task: DetachedHistoryTask,
  densitySpans: DensitySpanRows | JournalDensitySpans | undefined,
  failure: { error: unknown } | undefined,
): void {
  task.transform = undefined;
  const closing: unknown[] = [];
  try {
    if (densitySpans instanceof DensitySpanRows) densitySpans.close();
  } catch (error) {
    closing.push(error);
  }
  if (failure !== undefined)
    throw historyMutationFailure(failure.error, closing);
  if (closing.length > 0)
    throw new AggregateError(closing, 'Detached mutation cleanup failed');
}
