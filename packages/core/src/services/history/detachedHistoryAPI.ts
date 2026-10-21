/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { SemanticPurgeSnapshot } from './semantic-purge-native.js';
import type { HistoryStorePort } from './historyStorePort.js';
import { releaseRead } from '../../journal/pinLease.js';
import type { HistoryServiceCore } from './HistoryServiceCore.js';
import type { ChronologyStamper } from './historyChronology.js';
import type { SpanWindow } from './historySpanWindow.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import {
  emitHistoryBatchValues,
  type HistoryBatchRows,
  type HistoryBatchRowSource,
} from './history-batch-values.js';
import type { HistoryCheckpoint } from './historyCheckpointRows.js';
import {
  detachedValueSubmission,
  type DetachedHistoryTask,
  type DetachedHistoryHost,
  type DetachedHistoryTransform,
  type DetachedHistoryOptions,
} from './detachedHistoryMutation.js';
export type {
  DetachedHistoryTransform,
  DetachedHistoryOptions,
  DetachedHistorySource,
  DetachedHistorySink,
} from './detachedHistoryMutation.js';

export interface DetachedHistoryAPI {
  openSemanticPurgeSnapshot(): Promise<SemanticPurgeSnapshot | undefined>;
  /** The service-side policy a store needs to publish a detached group of its own. */
  host(): DetachedHistoryHost;
  withRollbackCheckpoint<T>(
    execute: (restore: () => Promise<void>) => Promise<T>,
  ): Promise<T>;
  withCheckpoint<T>(
    execute: (checkpoint: HistoryCheckpoint) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
  append(
    rows: Iterable<IContent> | AsyncIterable<IContent>,
    modelName?: string,
    options?: DetachedHistoryOptions,
  ): Promise<void>;
  replace(
    rows: Iterable<IContent> | AsyncIterable<IContent>,
    modelName?: string,
    options?: DetachedHistoryOptions,
  ): Promise<void>;
  transform(
    transform: DetachedHistoryTransform,
    modelName?: string,
    options?: DetachedHistoryOptions,
  ): Promise<void>;
}

function notifyDetachedBatch(
  history: HistoryServiceCore,
  ownership: RowOwnership | undefined,
  addedTokens: number,
  rows: HistoryBatchRows,
  start: number,
): Promise<void> | undefined {
  const emitTokens = (): void => {
    history.emit('tokensUpdated', {
      totalTokens: history.getTotalTokens(),
      addedTokens,
      contentId: null,
    });
  };
  const drained = emitHistoryBatchValues(history, rows, start, ownership);
  if (drained === undefined) {
    emitTokens();
    return undefined;
  }
  return drained.then(emitTokens);
}

/** The committed batch as one `contentBatchAdded`; the row ownership census counts each row while a listener holds it. */
export function notifyDetachedRows(
  history: HistoryServiceCore,
  ownership: RowOwnership | undefined,
  source: HistoryBatchRowSource,
): void | Promise<void> {
  try {
    history.emit(
      'contentBatchAdded',
      ownership === undefined
        ? source
        : {
            length: source.length,
            async *rows() {
              for await (const row of source.rows()) {
                ownership.retain(row);
                try {
                  yield row;
                } finally {
                  ownership.release(row);
                }
              }
            },
            retire: () => source.retire(),
          },
    );
  } catch (error) {
    const released = releaseRead({ close: () => source.retire() }, { error });
    if (released !== undefined) {
      return released.then(() => {
        throw error;
      });
    }
    throw error;
  }
  return source.retire();
}

export function createDetachedHistoryAPI(
  history: HistoryServiceCore,
  journal: HistoryStorePort,
  getChronology: () => ChronologyStamper,
  spans: SpanWindow,
  ownership: RowOwnership | undefined,
  getMediaOwner: () => HistoryMediaOwner | undefined,
  enqueue: (execute: () => Promise<void>) => Promise<void>,
  setTokens: (tokens: number) => void,
): DetachedHistoryAPI {
  const host = (): DetachedHistoryHost => ({
    journal,
    get chronology(): ChronologyStamper {
      return getChronology();
    },
    ownership,
    mediaOwner: getMediaOwner(),
    snapshot: () => ({
      tokens: history.getTotalTokens() - history.getBaseTokenOffset(),
      spans: spans.get(),
      chronology: getChronology().snapshot(),
    }),
    apply: (tokens, nextSpans) => {
      setTokens(tokens);
      spans.set(nextSpans);
    },
    waitForTokenUpdates: () => history.waitForTokenUpdates(),
    estimate: (rows, model, signal) =>
      history.estimateTokensForContents(rows, model, signal),
    notify: (addedTokens, range) => {
      history.emit('tokensUpdated', {
        totalTokens: history.getTotalTokens(),
        addedTokens,
        contentId: null,
      });
      history.emit('contextRangeChanged', range);
    },
    notifyBatch: (addedTokens, rows, start) =>
      notifyDetachedBatch(history, ownership, addedTokens, rows, start),
    notifyRows: (rows) => notifyDetachedRows(history, ownership, rows),
    notifyTokens: (addedTokens) => {
      history.emit('tokensUpdated', {
        totalTokens: history.getTotalTokens(),
        addedTokens,
        contentId: null,
      });
    },
    notifyRange: (range) => history.emit('contextRangeChanged', range),
  });
  const submit = (
    task: DetachedHistoryTask,
    model: string | undefined,
    options: DetachedHistoryOptions,
  ): Promise<void> =>
    enqueue(() => journal.publishDetached(task, host(), model, options));
  return {
    host,
    openSemanticPurgeSnapshot: async () => {
      if (journal.openSemanticPurgeSnapshot === undefined) return undefined;
      const captured: { snapshot?: SemanticPurgeSnapshot } = {};
      await enqueue(async () => {
        captured.snapshot = await journal.openSemanticPurgeSnapshot?.(host());
      });
      const snapshot = captured.snapshot;
      if (snapshot === undefined)
        throw new Error('Semantic purge snapshot was not captured');
      return {
        length: snapshot.length,
        streamRows: (signal) => snapshot.streamRows(signal),
        readRow: (index) => snapshot.readRow(index),
        isCurrent: () => snapshot.isCurrent(),
        restore: () => enqueue(() => snapshot.restore()),
        close: () => snapshot.close(),
      };
    },
    withRollbackCheckpoint: (execute) =>
      journal.withRollbackCheckpoint(host(), enqueue, execute),
    withCheckpoint: (execute, signal) =>
      journal.withCheckpoint(host(), enqueue, execute, signal),
    append: (rows, model, options = {}) =>
      submit(detachedValueSubmission(rows, ownership, true), model, {
        ...options,
        publishBatch: true,
      }),
    replace: (rows, model, options = {}) =>
      submit(detachedValueSubmission(rows, ownership), model, options),
    transform: (transform, model, options = {}) =>
      submit({ transform }, model, options),
  };
}
