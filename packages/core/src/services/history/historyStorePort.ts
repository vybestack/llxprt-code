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
import type { ConversationStatistics } from './curationDebugLogger.js';
import type { ContextRange } from './historyEventTypes.js';
import type { ResumeDerivedState } from './historyResumeAdoption.js';
import type { ResumeCursorBoot } from '../../recording/resumeCursorBoot.js';
import type { ResumePoint } from '../../recording/journalResume.js';
import type { HistoryCheckpoint } from './historyCheckpointRows.js';
import type { HistoryDensityRows } from './historyDensityRows.js';
import type { DiskDensityOptimizer } from './historyDiskDensity.js';
import type {
  DetachedHistoryHost,
  DetachedHistoryOptions,
  DetachedHistoryTask,
} from './detachedHistoryMutation.js';
import type {
  HistoryMediaOwner,
  HistoryMutationInput,
} from './historyBatchContracts.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import type { OpenReplaceTracker } from './historyReplaceOps.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { SessionRecordingPort } from '../../recording/recordingPort.js';
import type {
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

/** What a resume boots from: the replayed cursor of the JSONL stack, or the version a journal was opened at. */
export type ResumeBoot = ResumeCursorBoot | ResumePoint;

/**
 * One resume adoption (decision G5): the policy of HistoryService rides in the
 * callbacks, the rows, the swap of the recorder and its rollback are the
 * store's. The store checks that `recording` and `boot` are its own kind.
 */
export interface HistoryResumeRequest {
  readonly recording: SessionRecordingPort;
  readonly boot: ResumeBoot;
  readonly mediaOwner?: HistoryMediaOwner;
  readonly estimate: (contents: readonly IContent[]) => Promise<number>;
  /** Puts the state derived from the resumed rows into the service. */
  readonly publish: (state: ResumeDerivedState) => void;
  /** Takes back what `publish` changed. */
  readonly restore: () => void;
  readonly afterPublication: () => void | Promise<void>;
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
  rollback(): Promise<void>;
  close(): void;
}

/** One tail removal: the policy of HistoryService, the rows and their restore are the store's. */
export interface HistoryRemoveTailRequest {
  /** The media owner whose holdings follow the removal. */
  readonly owner?: HistoryMediaOwner;
  readonly ownership?: RowOwnership;
  /** Removes the tail only when it equals this row by value. */
  readonly match?: IContent;
  /**
   * Runs once the removal is published (the token recount). Throwing a
   * `RemovalObserverFailure` takes the removal back and rejects with its
   * cause; any other error leaves the removal in place and is rethrown.
   */
  readonly recalculate?: () => Promise<void>;
}

/**
 * One merge of another history's rows onto the end of this one. A store that
 * publishes detached groups (the journal store) reads `source` and publishes
 * through `host`; a store that publishes through mutation snapshots (the old
 * store) snapshots `source` itself, which must be a store of its own kind,
 * and hands its candidate to `publish`.
 */
export interface HistoryMergeRequest {
  /** The history whose accepted rows are appended; it is only read. */
  readonly source: Pick<HistoryStorePort, 'streamRows'>;
  readonly ownership?: RowOwnership;
  readonly host: DetachedHistoryHost;
  /**
   * The service's commit of one candidate over the rows it was built from
   * (tokens, spans, chronology, events).
   */
  readonly publish: (
    candidate: HistoryDensityRows,
    previous: HistoryMutationSnapshot,
  ) => Promise<void>;
}

/**
 * One density optimization. The optimizer reads the rows by index and decides
 * which to remove or replace. A store that publishes detached groups (the
 * journal store) copies the rows once for the optimizer and publishes its
 * decisions through `host`; a store that publishes through mutation snapshots
 * (the old store) runs `mutate` over its snapshot.
 */
export interface HistoryDensityRequest {
  readonly optimize: DiskDensityOptimizer;
  readonly ownership?: RowOwnership;
  readonly host: DetachedHistoryHost;
  readonly mutate: (previous: HistoryMutationSnapshot) => Promise<void>;
}

/** The rows a profile replacement takes over; any store can be the candidate. */
export type ProfileCandidateRows = Pick<
  HistoryStorePort,
  'getLength' | 'streamRows'
>;

export interface HistoryProfileReplacementRequest {
  /** Retains the rows in flight while they are written. */
  readonly ownership?: RowOwnership;
  /** Persisted id every adopted row is written under; absent means unowned. */
  readonly origin?: string;
}

/**
 * A candidate staged against the live rows. `commit` is synchronous: it
 * throws, with nothing changed by it, when the live history was written after
 * staging. `rollback` takes the staging back.
 */
export interface StagedProfileAdoption {
  commit(): void;
  rollback(): Promise<void>;
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
  /**
   * True when `clear` finishes after it returns, so the service must keep its
   * mutation queue held until the promise settles. Absent for the old store,
   * which clears inside the synchronous turn that calls it and reports a
   * failure by throwing from that turn (the #2852 never-drop flush depends on
   * it); the field leaves with the old store.
   */
  readonly clearIsAsynchronous?: boolean;

  // Recorder binding, fan-out and late attach.
  onRetired(listener: () => void): () => void;
  isRecorder(recorder: SessionRecordingPort): boolean;
  isAdoptingRecorder(recorder: SessionRecordingPort): boolean;
  primaryOriginId(): string | undefined;
  adoptedOrigin(origin: string | undefined): void;
  journalPath(): string | null;
  attachJournal(
    recorder: SessionRecordingPort,
    replace?: boolean,
    onAttached?: () => void,
    origin?: string,
  ): Promise<void>;
  detachJournal(recorder: SessionRecordingPort): Promise<void>;
  /**
   * Resumes this history onto `recording`. Resolves with the warnings of the
   * cleanup after the swap; a failure rolls everything back and rejects.
   */
  adoptResume(request: HistoryResumeRequest): Promise<string[]>;

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
  /**
   * Resolves once every mutation accepted so far is durable and the storage
   * that only held them in flight is released.
   */
  waitForCommit(): Promise<void>;

  // Reads.
  getLength(): number;
  /** Every row; for tests and tools that need the whole history, which a send never does. */
  materialize(): Promise<IContent[]>;
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
  /** The conversation counters of the rows the store holds; no row is read by the journal store. */
  statistics(): ConversationStatistics;
  /**
   * The chronology boundary of the rows the store holds, joined with the
   * interior spans `accumulated` by the service's mutations.
   */
  contextRange(accumulated: readonly RemovedInteriorSpan[]): ContextRange;
  openDumpSnapshot(): Promise<HistoryDumpSnapshot>;

  // Whole operations. Each one reads the rows it needs itself, so the caller
  // holds no cursor. The journal store reads asynchronously and rejects on
  // failure. The old store (deleted with the flip) applies the effect before
  // it returns and throws instead of rejecting, so HistoryService keeps the
  // synchronous failure of a queued clear that `endCompression()` reports.
  clear(request: HistoryClearRequest): Promise<void>;
  validateAndFix(request: HistoryRepairRequest): Promise<HistoryRepair>;
  adoptMediaOwner(owner: HistoryMediaOwner): Promise<void>;
  /**
   * Removes the newest row (when it equals `request.match`, if given) and
   * returns it; undefined when there is none or it does not match. A failure
   * of the removal, of the media effect or of the observer puts the row back.
   */
  removeTail(request: HistoryRemoveTailRequest): Promise<IContent | undefined>;
  /** Makes what `owner` holds equal to the media the current rows reference. */
  reconcileMedia(owner: HistoryMediaOwner): Promise<void>;
  /**
   * Appends the accepted rows of `request.source` (a known speaker and at
   * least one block), in order, keeping their values and chronology markers.
   * Publishes and announces nothing when no row is accepted.
   */
  mergeFrom(request: HistoryMergeRequest): Promise<void>;
  /**
   * Removes and replaces rows as the optimizer decides, keeping each
   * replaced row's chronology marker. Publishes and announces nothing when
   * the optimizer changes nothing.
   */
  optimizeDensity(request: HistoryDensityRequest): Promise<void>;
  /**
   * Stages `candidate` as the live rows (decision G3). The old store stages
   * invisibly and `commit` flips the rows; a journal group is atomic and
   * visible at its ack, so that store writes the group while staging and its
   * `rollback` puts the previous version back.
   */
  stageProfileReplacement(
    candidate: ProfileCandidateRows,
    request: HistoryProfileReplacementRequest,
  ): Promise<StagedProfileAdoption>;
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
  /**
   * Runs one detached append, replacement or transform end to end: reads the
   * current rows, runs the task's transform to build the candidate, publishes
   * it and compensates when that fails. How the candidate is held and written
   * is the store's business; `host` carries the service-side policy (tokens,
   * spans, chronology, events).
   */
  publishDetached(
    task: DetachedHistoryTask,
    host: DetachedHistoryHost,
    modelName: string | undefined,
    options: DetachedHistoryOptions,
  ): Promise<void>;
  /**
   * Runs `execute` over a checkpoint of the rows durable now. The capture
   * happens inside the service queue (`enqueue`); `execute` runs outside it so
   * it can publish. Tokens still owed are settled through `host`.
   */
  withCheckpoint<T>(
    host: DetachedHistoryHost,
    enqueue: (execute: () => Promise<void>) => Promise<void>,
    execute: (checkpoint: HistoryCheckpoint) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T>;
  /**
   * Runs `execute` with a `restore` that puts the history, its token total,
   * spans and chronology back as they were when the checkpoint was taken.
   */
  withRollbackCheckpoint<T>(
    host: DetachedHistoryHost,
    enqueue: (execute: () => Promise<void>) => Promise<void>,
    execute: (restore: () => Promise<void>) => Promise<T>,
  ): Promise<T>;

  dispose(): Promise<void>;
}
