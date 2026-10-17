/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryStorePort } from './historyStorePort.js';
import type { HistoryServiceCore } from './HistoryServiceCore.js';
import type { ChronologyStamper } from './historyChronology.js';
import type { SpanWindow } from './historySpanWindow.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import {
  emitHistoryBatchValues,
  type HistoryBatchRows,
} from './history-batch-values.js';
import { withDetachedHistoryCheckpoint } from './detachedHistoryCheckpoint.js';
import { withDetachedRollbackCheckpoint } from './detachedRollbackCheckpoint.js';
import type { HistoryIndexedRows } from './historyMutationSnapshot.js';
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
  withRollbackCheckpoint<T>(
    execute: (restore: () => Promise<void>) => Promise<T>,
  ): Promise<T>;
  withCheckpoint<T>(
    execute: (checkpoint: HistoryIndexedRows) => Promise<T>,
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
): void {
  emitHistoryBatchValues(history, rows, start, ownership);
  history.emit('tokensUpdated', {
    totalTokens: history.getTotalTokens(),
    addedTokens,
    contentId: null,
  });
}

function notifyDetachedRow(
  history: HistoryServiceCore,
  ownership: RowOwnership | undefined,
  row: IContent,
): void {
  emitHistoryBatchValues(
    history,
    { length: 1, readRow: () => row },
    0,
    ownership,
  );
}

export function createDetachedHistoryAPI(
  history: HistoryServiceCore,
  journal: HistoryStorePort,
  chronology: ChronologyStamper,
  spans: SpanWindow,
  ownership: RowOwnership | undefined,
  getMediaOwner: () => HistoryMediaOwner | undefined,
  enqueue: (execute: () => Promise<void>) => Promise<void>,
  setTokens: (tokens: number) => void,
): DetachedHistoryAPI {
  const host = (): DetachedHistoryHost => ({
    journal,
    chronology,
    ownership,
    mediaOwner: getMediaOwner(),
    snapshot: () => ({
      tokens: history.getTotalTokens() - history.getBaseTokenOffset(),
      spans: spans.get(),
      chronology: chronology.snapshot(),
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
    notifyRow: (row) => notifyDetachedRow(history, ownership, row),
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
    withRollbackCheckpoint: (execute) =>
      withDetachedRollbackCheckpoint(host(), enqueue, execute),
    withCheckpoint: (execute, signal) =>
      withDetachedHistoryCheckpoint(
        journal,
        ownership,
        enqueue,
        () => history.waitForTokenUpdates(),
        execute,
        signal,
      ),
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
