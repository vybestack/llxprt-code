/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryStorePort } from './historyStorePort.js';
import type { IContent } from './IContent.js';
import type { HistoryBatchRowSource } from './history-batch-values.js';
import type {
  ChronologyStamper,
  ChronologyState,
} from './historyChronology.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import type {
  HistoryBatchOptions,
  HistoryMediaOwner,
} from './historyBatchContracts.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import type { buildContextRangeSnapshot } from './contextRange.js';
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
  /** The transform is a density pass: record it as `density_mutation`, not a replacement. */
  readonly densityShape?: boolean;
}
export interface DetachedHistorySource {
  readonly length: number;
  streamRows(signal?: AbortSignal): AsyncIterable<IContent>;
}
export interface DetachedHistorySink {
  /**
   * Each call resolves when the candidate has taken the row, so a transform
   * that awaits every call cannot run ahead of the store consuming its output.
   */
  appendValue(row: IContent): Promise<void>;
  /**
   * Appends a row that is the source row at `sourceOrdinal` carried over
   * (possibly rewritten): the journal store writes it under that row's owner
   * and keeps the row's own chronology marker. `appendValue` is for rows that
   * do not come from a source row and are owned by the operation's origin.
   */
  appendDerived(sourceOrdinal: number, row: IContent): Promise<void>;
  appendReplacement(sourceOrdinal: number, row: IContent): Promise<void>;
  removeValue(sourceOrdinal: number): Promise<void>;
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
  readonly journal: HistoryStorePort;
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
  ): Promise<void> | undefined;
  /** The published batch as one event, announced after its group is acked (journal store). */
  notifyRows(rows: HistoryBatchRowSource): void | Promise<void>;
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
          await sink.appendValue(
            append ? sanitizeProviderContentForSerialization(row) : row,
          );
        }
      } finally {
        dispose();
      }
    },
  };
}
