/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from './IContent.js';
import type { HistoryJournalStore } from './historyJournalStore.js';
import type {
  ChronologyStamper,
  ChronologyState,
} from './historyChronology.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import type {
  HistoryBatchOptions,
  HistoryMediaOwner,
  PreparedHistoryBatchEffect,
} from './historyBatchContracts.js';
import { DensitySpanRows } from './densitySpanRows.js';
import { detachedHistorySink } from './detachedHistoryDensity.js';
import { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import { captureDetachedHistory } from './detachedHistoryCapture.js';
import { DetachedHistoryPublication } from './detachedHistoryPublication.js';
import {
  historyMutationFailure,
  rollbackMutationEffects,
} from './historyMutationEffects.js';
import { finalizeMutationEffects } from './historyMutationFailure.js';
import { mergeCommitSpans, buildContextRangeSnapshot } from './contextRange.js';
import { trackMutationOwners } from './historyMutationOwnership.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import { validateHistoryEntry } from './historyBatchContracts.js';

export interface DetachedHistoryOptions
  extends Omit<HistoryBatchOptions, 'replaceAll'> {
  readonly signal?: AbortSignal;
  readonly onAcknowledged?: () => void | Promise<void>;
  /** Publish batch/token observers before participant finalization, as replaceBatch does. */
  readonly publishBatch?: boolean;
  readonly publishTokens?: boolean;
}
export interface DetachedHistorySource {
  readonly length: number;
  streamRows(signal?: AbortSignal): AsyncIterable<IContent>;
}
export interface DetachedHistorySink {
  appendValue(row: IContent): void;
  appendReplacement(sourceOrdinal: number, row: IContent): void;
  removeValue(sourceOrdinal: number): void;
}
export type DetachedHistoryTransform = (
  source: DetachedHistorySource,
  sink: DetachedHistorySink,
) => Promise<void>;
export interface DetachedHistoryTask {
  append?: boolean;
  transform: DetachedHistoryTransform | undefined;
  dispose?(): void;
}
export interface DetachedState {
  readonly tokens: number;
  readonly spans: readonly RemovedInteriorSpan[];
  readonly chronology: ChronologyState;
}
export interface DetachedHistoryHost {
  readonly journal: HistoryJournalStore;
  readonly chronology: ChronologyStamper;
  readonly ownership?: RowOwnership;
  readonly mediaOwner?: HistoryMediaOwner;
  snapshot(): DetachedState;
  apply(tokens: number, spans: readonly RemovedInteriorSpan[]): void;
  waitForTokenUpdates(): Promise<void>;
  estimate(
    rows: Iterable<IContent>,
    modelName?: string,
    signal?: AbortSignal,
  ): Promise<number>;
  notify(
    tokensDelta: number,
    range: ReturnType<typeof buildContextRangeSnapshot>,
  ): void;
  notifyBatch(
    tokensDelta: number,
    rows: DetachedHistoryJournal,
    start: number,
  ): void;
  notifyTokens(tokensDelta: number): void;
  notifyRange(range: ReturnType<typeof buildContextRangeSnapshot>): void;
}

export function detachedValueSubmission(
  rows: Iterable<IContent> | AsyncIterable<IContent>,
  ownership?: RowOwnership,
  append = false,
): DetachedHistoryTask {
  const input: { rows: typeof rows | undefined; release: () => void } = {
    rows,
    release: Array.isArray(rows)
      ? trackMutationOwners(rows, ownership)
      : (): void => {},
  };
  const dispose = (): void => {
    input.release();
    input.rows = undefined;
    input.release = (): void => {};
  };
  return {
    append,
    dispose,
    transform: async (_source, sink): Promise<void> => {
      try {
        if (input.rows === undefined)
          throw new Error('Detached submission already consumed');
        let index = 0;
        for await (const row of input.rows) {
          validateHistoryEntry(row, index++);
          sink.appendValue(
            append ? sanitizeProviderContentForSerialization(row) : row,
          );
        }
      } finally {
        dispose();
      }
    },
  };
}
async function* scopedRows(
  previous: DetachedHistoryJournal,
  assertActive: () => void,
  signal: AbortSignal | undefined,
  close: () => void,
): AsyncGenerator<IContent, void, unknown> {
  try {
    for await (const row of previous.streamRows(signal)) {
      assertActive();
      yield row;
    }
    assertActive();
  } finally {
    close();
  }
}

async function transformCandidate(
  task: DetachedHistoryTask,
  previous: DetachedHistoryJournal,
  next: DetachedHistoryJournal,
  spans: DensitySpanRows,
  signal?: AbortSignal,
): Promise<void> {
  let active = true;
  const assertActive = (): void => {
    if (!active) throw new Error('Detached history scope is closed');
    signal?.throwIfAborted();
  };
  const cursors = new Set<AsyncGenerator<IContent, void, unknown>>();
  const source: DetachedHistorySource = {
    length: previous.length,
    streamRows(cursorSignal): AsyncGenerator<IContent, void, unknown> {
      assertActive();
      const cursor = scopedRows(previous, assertActive, cursorSignal, () => {
        cursors.delete(cursor);
      });
      cursors.add(cursor);
      return cursor;
    },
  };
  let failure: { error: unknown } | undefined;
  try {
    assertActive();
    if (task.transform === undefined)
      throw new Error('Detached transform already consumed');
    const sink = detachedHistorySink(previous, next, spans, assertActive);
    if (task.append === true) {
      for await (const row of source.streamRows(signal)) sink.appendValue(row);
    }
    await task.transform(source, sink);
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
  cursors.clear();
  if (failure !== undefined)
    throw historyMutationFailure(failure.error, failures);
  if (failures.length > 0)
    throw new AggregateError(failures, 'Detached cursor cleanup failed');
}

export async function withDetachedHistoryMutation(
  task: DetachedHistoryTask,
  host: DetachedHistoryHost,
  modelName: string | undefined,
  options: DetachedHistoryOptions,
): Promise<void> {
  let previous: DetachedHistoryJournal | undefined;
  let next: DetachedHistoryJournal | undefined;
  let densitySpans: DensitySpanRows | undefined;
  let failure: { error: unknown } | undefined;
  try {
    previous = new DetachedHistoryJournal(host.ownership);
    next = new DetachedHistoryJournal(host.ownership);
    densitySpans = new DensitySpanRows();
    await captureDetachedHistory(
      host.journal,
      previous,
      host.ownership,
      options.signal,
      () => host.waitForTokenUpdates(),
    );
    await transformCandidate(
      task,
      previous,
      next,
      densitySpans,
      options.signal,
    );
    if (task.append !== true || next.length > previous.length)
      await commitDetachedHistory(
        host,
        previous,
        next,
        densitySpans,
        modelName,
        options,
        task.append === true,
      );
  } catch (error) {
    failure = { error };
  }
  task.transform = undefined;
  const failures: unknown[] = [];
  try {
    task.dispose?.();
  } catch (error) {
    failures.push(error);
  }
  for (const rows of [densitySpans, next, previous]) {
    try {
      rows?.close();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failure !== undefined)
    throw historyMutationFailure(failure.error, failures);
  if (failures.length > 0)
    throw new AggregateError(failures, 'Detached mutation cleanup failed');
}

export async function restoreDetachedHistory(
  checkpoint: DetachedHistoryJournal,
  state: DetachedState,
  host: DetachedHistoryHost,
): Promise<void> {
  const previous = new DetachedHistoryJournal(host.ownership);
  const spans = new DensitySpanRows();
  try {
    await captureDetachedHistory(
      host.journal,
      previous,
      host.ownership,
      undefined,
      () => host.waitForTokenUpdates(),
    );
    await commitDetachedHistory(
      host,
      previous,
      checkpoint,
      spans,
      undefined,
      {},
      false,
      state,
    );
  } finally {
    try {
      spans.close();
    } finally {
      previous.close();
    }
  }
}

function rowsFrom(
  rows: DetachedHistoryJournal,
  start: number,
): Iterable<IContent> {
  return {
    *[Symbol.iterator](): Generator<IContent, void, unknown> {
      let ordinal = 0;
      for (const row of rows) if (ordinal++ >= start) yield row;
    },
  };
}

function notifyPublishedTokens(
  host: DetachedHistoryHost,
  next: DetachedHistoryJournal,
  start: number,
  delta: number,
  options: DetachedHistoryOptions,
): void {
  if (options.publishBatch === true) host.notifyBatch(delta, next, start);
  else if (options.publishTokens === true) host.notifyTokens(delta);
}

function stampCandidate(
  host: DetachedHistoryHost,
  next: DetachedHistoryJournal,
  signal?: AbortSignal,
): void {
  let index = 0;
  for (const row of next) {
    signal?.throwIfAborted();
    host.chronology.stamp(row);
    next.writeRow(index++, row);
  }
}

async function finishDetachedPublication(
  host: DetachedHistoryHost,
  publishedStart: number,
  next: DetachedHistoryJournal,
  spans: readonly RemovedInteriorSpan[],
  delta: number,
  effects: readonly PreparedHistoryBatchEffect[],
  options: DetachedHistoryOptions,
): Promise<void> {
  notifyPublishedTokens(host, next, publishedStart, delta, options);
  await options.onAcknowledged?.();
  options.signal?.throwIfAborted();
  await options.afterPublication?.();
  options.signal?.throwIfAborted();
  await finalizeMutationEffects(effects);
  options.signal?.throwIfAborted();
  const range = buildContextRangeSnapshot(next, spans);
  if (options.publishBatch === true || options.publishTokens === true)
    host.notifyRange(range);
  else host.notify(delta, range);
}

function awaitFinalAcknowledgement(
  appendOnly: boolean,
  options: DetachedHistoryOptions,
): boolean {
  return (
    !appendOnly ||
    options.streamPublication !== true ||
    options.awaitDurableCommit === true ||
    options.onAcknowledged !== undefined
  );
}

async function publishDetachedEffects(
  host: DetachedHistoryHost,
  previous: DetachedHistoryJournal,
  next: DetachedHistoryJournal,
  effects: PreparedHistoryBatchEffect[],
  options: DetachedHistoryOptions,
): Promise<void> {
  if (host.mediaOwner !== undefined)
    effects.push(
      await host.mediaOwner.prepareReplacement({
        previous,
        next,
        adopted: options.adoptedOwners ?? [],
        ownership: host.ownership,
      }),
    );
  for (const effect of effects) {
    options.signal?.throwIfAborted();
    await effect.publish();
  }
}

async function commitDetachedHistory(
  host: DetachedHistoryHost,
  previous: DetachedHistoryJournal,
  next: DetachedHistoryJournal,
  densitySpans: DensitySpanRows,
  modelName: string | undefined,
  options: DetachedHistoryOptions,
  appendOnly: boolean,
  restoredState?: DetachedState,
): Promise<void> {
  const state = host.snapshot();
  const effects: PreparedHistoryBatchEffect[] = [];
  const publication = new DetachedHistoryPublication(
    host.journal,
    host.ownership,
  );
  try {
    options.signal?.throwIfAborted();
    if (restoredState === undefined) stampCandidate(host, next, options.signal);
    const published = appendOnly ? rowsFrom(next, previous.length) : next;
    const tokens =
      restoredState?.tokens ??
      (appendOnly ? state.tokens : 0) +
        (await host.estimate(published, modelName, options.signal));
    const spans =
      restoredState?.spans ??
      densitySpans.project(
        state.spans,
        mergeCommitSpans([], undefined, previous, next),
      );
    await publishDetachedEffects(host, previous, next, effects, options);
    await publication.publish(
      previous,
      next,
      options.signal,
      appendOnly,
      awaitFinalAcknowledgement(appendOnly, options),
    );
    if (restoredState !== undefined)
      host.chronology.restore(restoredState.chronology);
    host.apply(tokens, spans);
    await finishDetachedPublication(
      host,
      appendOnly ? previous.length : 0,
      next,
      spans,
      tokens - state.tokens,
      effects,
      options,
    );
  } catch (error) {
    const failures: unknown[] = [];
    if (publication.admittedCount > 0) {
      try {
        await publication.compensate(previous, next, appendOnly);
      } catch (failure) {
        failures.push(failure);
      }
    }
    try {
      host.apply(state.tokens, state.spans);
    } catch (failure) {
      failures.push(failure);
    }
    try {
      host.chronology.restore(state.chronology);
    } catch (failure) {
      failures.push(failure);
    }
    failures.push(...(await rollbackMutationEffects(effects)));
    throw historyMutationFailure(error, failures);
  } finally {
    publication.close();
  }
}
