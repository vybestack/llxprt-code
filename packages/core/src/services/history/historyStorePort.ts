/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { IContent } from './IContent.js';
import type { HistoryDumpSnapshot } from './historyDumpSnapshot.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { HistorySuffixQuery } from './historyJournalRows.js';
import type { HistoryRowView } from './historyRowView.js';
import type { HistoryRowSummary } from './historySummaryTracker.js';
import type { ResumeProjection } from './historyResumeProjection.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import type {
  HistoryMediaOwner,
  HistoryMutationInput,
} from './historyBatchContracts.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import type { OpenReplaceTracker } from './historyReplaceOps.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { RecordingPort } from '../../recording/recordingPort.js';
import type {
  CommitWatermark,
  CompressionDetailPayload,
  DensityMutationPayload,
  SyntheticInsertPayload,
} from '../../recording/types.js';

/**
 * One durable history mutation in the P05b1 journal-op vocabulary. This is
 * the unit a store queues and the journal records.
 */
export type HistoryJournalOp = HistoryJournalOpBody & {
  /** Persisted id of the owner that published the op; absent means unowned. */
  readonly origin?: string;
};

type HistoryJournalOpBody =
  | {
      readonly kind: 'content';
      readonly content: IContent;
      /** Set on a row written inside a replace transaction. */
      readonly tx?: string;
    }
  | { readonly kind: 'replaceBegin'; readonly txId: string }
  | {
      readonly kind: 'replaceCommit';
      readonly txId: string;
      readonly rowCount: number;
    }
  | {
      readonly kind: 'replaceAbort';
      readonly txId: string;
      readonly rowCount: number;
    }
  | {
      readonly kind: 'rewind';
      readonly itemsRemoved: number;
      readonly cutSeq?: number;
    }
  | {
      readonly kind: 'compressed';
      readonly summary: IContent;
      readonly itemsCompressed: number;
    }
  | {
      readonly kind: 'compressionDetail';
      readonly payload: CompressionDetailPayload;
    }
  | {
      readonly kind: 'syntheticInsert';
      readonly payload: SyntheticInsertPayload;
    }
  | { readonly kind: 'density'; readonly payload: DensityMutationPayload };

export interface HistoryJournalAdoption {
  useDurableProjection(watermark: CommitWatermark): void;
  prepareCommit(): void;
  commit(): Promise<void>;
  rollback(): void;
}

/** Opaque journal position; see {@link HistoryStorePort.mutationMark}. */
export interface HistoryMutationMark {
  readonly binding: object;
  readonly lastSeq: number | null;
}

/** Brackets one logical publication so the fan-out sees it only if it succeeds. */
export interface HistoryPublicationScope {
  close(published: boolean): void;
}

/** One clear: the policy of HistoryService, the rows and their restore are the store's. */
export interface HistoryClearRequest {
  /** The interior spans removed before this clear. */
  readonly spans: readonly RemovedInteriorSpan[];
  readonly rollbackOnFailure: boolean;
  /** Called once the rows are gone, with the spans including the cleared ones. */
  readonly publish: (spans: RemovedInteriorSpan[]) => void;
  /** Undoes what `publish` changed in the service when the clear is rolled back. */
  readonly restore: () => void;
}

export interface HistoryRepairRequest {
  readonly ownership?: RowOwnership;
  /** Gives a row its chronology; called for rows that have one and for inserted rows. */
  readonly stamp: (row: IContent) => IContent;
}

/** The tool-pairing repair a store has published; the caller owns `close`. */
export interface HistoryRepair {
  readonly inserted: Iterable<IContent> & { readonly length: number };
  /** Takes the published repair back out of the store. */
  rollback(): void;
  close(): void;
}

/** Opaque proof that a store captured what its own compensation needs; see {@link HistoryStorePort.captureCompensation}. */
export interface HistoryCompensationMark {
  readonly store: HistoryStorePort;
}

/**
 * What HistoryService, the mutation planners and the detached history modules
 * need from the store behind them. `HistoryJournalStore` (the JSONL fold) is
 * the only implementation until the journal-backed store lands (#854 phase 4).
 */
export interface HistoryStorePort {
  // Recorder binding, fan-out and late attach.
  onRetired(listener: () => void): () => void;
  isRecorder(recorder: RecordingPort): boolean;
  isAdoptingRecorder(recorder: RecordingPort): boolean;
  primaryOriginId(): string | undefined;
  adoptedOrigin(origin: string | undefined): void;
  journalPath(): string | null;
  attachJournal(
    recorder: RecordingPort,
    replace?: boolean,
    onAttached?: () => void,
    origin?: string,
  ): Promise<void>;
  detachJournal(recorder: RecordingPort): Promise<void>;
  adoptJournal(
    recorder: RecordingPort,
    watermark: CommitWatermark,
    stripResumeMarkers?: boolean,
    projection?: ResumeProjection,
  ): HistoryJournalAdoption;

  // Writes and publication.
  apply(op: HistoryJournalOp): void;
  openPublication(): HistoryPublicationScope;
  withPublicationOrdinals(action: () => Promise<void>): Promise<void>;
  capturePublicationOwners(): Iterable<IContent>;
  mutationMark(): HistoryMutationMark;
  isCurrentMutationMark(mark: HistoryMutationMark): boolean;
  adoptMutationBoundary(durableTail: number): void;

  // Durability.
  waitForDurable(): Promise<void>;
  settleFanout(): Promise<void>;
  retireIdleTicketStorage(): void;

  // Reads.
  getLength(): number;
  materialize(): IContent[];
  streamRows(
    query?: HistorySuffixQuery,
    signal?: AbortSignal,
  ): AsyncIterable<IContent>;
  /** The newest row, optionally of one speaker. Nothing is retained between calls. */
  lastContent(speaker?: IContent['speaker']): Promise<IContent | undefined>;
  /**
   * Row facts for a mutation that runs inside the mutation queue. The view is
   * valid until the callback settles.
   */
  readRows<T>(
    execute: (view: HistoryRowView) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
  withRowSummary<T>(read: (summary: HistoryRowSummary) => T): T;
  openDumpSnapshot(): Promise<HistoryDumpSnapshot>;
  withMutationSnapshot<T>(
    execute: (snapshot: HistoryMutationSnapshot) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;

  // Whole operations. Each one reads the rows it needs itself, so the caller
  // holds no cursor. They run inside HistoryService's synchronous mutation
  // FIFO: the old store has applied the effect when the call returns, and a
  // journal-backed store, whose reads are asynchronous, returns a promise
  // that the flip of the default (S13) makes the service await.
  clear(request: HistoryClearRequest): void;
  validateAndFix(request: HistoryRepairRequest): HistoryRepair;
  adoptMediaOwner(owner: HistoryMediaOwner): void;
  /**
   * Called before a publication admits anything: captures what
   * {@link compensate} needs to put the previous rows back.
   */
  captureCompensation(
    previous: HistoryMutationSnapshot,
    input: HistoryMutationInput,
    replacements: OpenReplaceTracker,
  ): HistoryCompensationMark;
  /**
   * Undoes the admitted prefix of a failed mutation published after `mark`.
   * `failure` is the error the caller is handling. A store whose queue holds
   * a different failure keeps it and rejects with it, because nobody was told
   * about that one.
   */
  compensate(mark: HistoryCompensationMark, failure: unknown): Promise<void>;
  /** Copies the current rows and their origins into `previous` once they are durable. */
  captureDetached(
    previous: DetachedHistoryJournal,
    signal?: AbortSignal,
    settleTokens?: () => Promise<void>,
  ): Promise<void>;

  dispose(): Promise<void>;
}
