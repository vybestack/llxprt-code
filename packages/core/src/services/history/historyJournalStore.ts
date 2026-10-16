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

/**
 * @plan PLAN-20260917-ISSUE854.P05b3
 * @requirement G6, G2
 *
 * HistoryJournalStore: the journal-backed store behind the HistoryService
 * facade (issue-854-design.md §5c). The session journal is the system of
 * record; there is no retained content array anywhere in this module.
 *
 * Writes map every history mutation onto the durable journal ops of the
 * P05b1 vocabulary (`content`, `rewind`, `compressed`, `compression_detail`,
 * `synthetic_insert`, `density_mutation`) and append them through the
 * established writer class, `SessionRecordingService` — no second file
 * format exists. An injected recorder is used as-is; a bare store lazily
 * constructs its own recorder over a per-instance temp directory under
 * `os.tmpdir()`, and `attachJournal` transfers the live rows to the attached
 * recorder (late attach: the foreground CLI builds history before recording).
 *
 * Reads materialize transiently, per call: the durable prefix of the journal
 * (bytes [0, durableTail), where durableTail is the commit watermark's byte
 * offset from the P05b2 awaitable commit protocol) is folded synchronously,
 * and the not-yet-acked operations are folded on top as a pending overlay.
 * The watermark offset is what makes the two-layer fold exact: a record only
 * leaves the overlay once its bytes are provably on disk, so no interleaving
 * of an async drain with a synchronous read can double-apply or drop a row.
 * Nothing decoded outlives a materialize() call, and there is no cache.
 *
 * The synchronous fold mirrors the rules of the async JournalResolver
 * (recording/journalResolver.ts) for the kinds this store writes, so the
 * resolver fold of the store's file always equals the live projection at any
 * settle point. Divergences are documented at the mirror sites below.
 */

import * as fs from 'node:fs';
import {
  openHistoryDumpSnapshot,
  type HistoryDumpSnapshot,
} from './historyDumpSnapshot.js';
import {
  appendHistoryJournal,
  HistoryAttachmentError,
  type AttachmentCommit,
  type AttachmentSource,
} from './attachHistoryJournal.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { cloneHistoryJournal, removeTempDir } from './cloneHistoryJournal.js';
import { randomUUID } from 'crypto';
import {
  captureHistoryMutationSnapshot,
  type HistoryMutationSnapshot,
} from './historyMutationSnapshot.js';
import { DisposalSteps } from './historyJournalDisposal.js';
import { createScratchDirSync } from '../../storage/scratch-root.js';
export {
  planHistoryMutation,
  planDensityMutation,
} from './planHistoryMutation.js';
import { invalidateResponsesStatefulChain, type IContent } from './IContent.js';
import { recordPublicationOwners } from './historyPublicationOwners.js';
import {
  admitHistoryPending,
  absorbHistoryPending,
  retireHistoryPending,
} from './historyPendingAdmission.js';
import {
  journalBinding,
  type JournalBinding,
} from './historyJournalBinding.js';
import {
  HistoryPublicationOrdinals,
  readHistoryLength,
} from './historyScalarLength.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type { RecordingPort } from '../../recording/recordingPort.js';
import type {
  HistoryClearRequest,
  HistoryCompensationMark,
  HistoryJournalAdoption,
  HistoryJournalOp,
  HistoryMutationMark,
  HistoryPublicationScope,
  HistoryRepair,
  HistoryRepairRequest,
  HistoryStorePort,
} from './historyStorePort.js';
import { clearHistoryRows } from './historyClearRows.js';
import { repairHistoryRows } from './historyValidationRepair.js';
import { captureDetachedHistory } from './detachedHistoryCapture.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import type {
  HistoryMediaOwner,
  HistoryMutationInput,
} from './historyBatchContracts.js';
import type { OpenReplaceTracker } from './historyReplaceOps.js';
import {
  compensateMutation,
  SnapshotCompensationMark,
} from './planHistoryMutation.js';
import type {
  CommitWatermark,
  SessionRecordLine,
} from '../../recording/types.js';
import {
  arrayRowStore,
  ReplaceTransactionFold,
} from '../../recording/replaceTransaction.js';
import {
  applyFoldEvent,
  foldEvents,
  opToEvent,
  parseFoldEvents,
} from './historyJournalFold.js';
import { DurableFoldCheckpoint } from '../../recording/durableFoldCheckpoint.js';
import {
  HistorySummaryTracker,
  type HistoryRowSummary,
} from './historySummaryTracker.js';
import { HistoryPendingTickets } from './history-pending-tickets.js';
import { HistoryFanoutFeed } from './historyFanoutFeed.js';
import { HistoryRecorderFanout } from './historyRecorderFanout.js';
import { acceptsHistoryOrigin } from './historyOriginId.js';
import type { ResumeProjection } from './historyResumeProjection.js';
import {
  capturePendingFold,
  type PendingFoldSnapshot,
} from '../../recording/pendingFoldSnapshot.js';
import {
  streamHistoryJournalRows as streamRows,
  type HistorySuffixQuery,
} from './historyJournalRows.js';
import {
  withSynchronousHistoryCursor,
  executePinnedCursor,
  executePinnedCursorAsync,
  type HistoryReadCursor,
} from '../../recording/synchronousHistoryCursor.js';
import { rowViewOfCursor, type HistoryRowView } from './historyRowView.js';

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** Publications up to this many rows reach the mirrors directly, not through the pump. */
const DIRECT_DELIVERY_LINE_LIMIT = 4;

export class HistoryJournalStore implements HistoryStorePort {
  private binding: JournalBinding;
  private readonly fanout = new HistoryRecorderFanout();
  private readonly fanoutFeed = new HistoryFanoutFeed(this.fanout);
  /**
   * Rows admitted by the open publication, kept only while the publication is
   * small enough to hand to the mirrors directly. Larger publications are
   * re-read from the hidden primary by the pump, so nothing context-sized is
   * retained.
   */
  private scopeLines: SessionRecordLine[] = [];
  private scopeOverflow = false;
  private primaryOrigin: string | undefined;
  private publicationDepth = 0;
  private adoptionPending = false;
  private attachmentPending = false;
  private disposed = false;
  private disposal: Promise<void> | undefined;
  private readonly publicationOrdinals = new HistoryPublicationOrdinals();
  private readonly foldCheckpoint = new DurableFoldCheckpoint();
  private readonly summaryTracker = new HistorySummaryTracker();

  constructor(
    recording?: RecordingPort,
    private readonly attachmentCounters?: JournalReadCounters,
    private readonly mutationOwnership?: RowOwnership,
  ) {
    this.binding = journalBinding(recording);
  }

  /** The file backing the store, or null before the first durable record. */
  onRetired(listener: () => void): () => void {
    const binding = this.binding;
    binding.retired.add(listener);
    return () => binding.retired.delete(listener);
  }

  isRecorder(recorder: RecordingPort): boolean {
    return this.binding.recorder === recorder;
  }

  /**
   * Identifies the journal state after the latest admitted record. Any later
   * record, or a swap of the primary binding, makes the mark stale.
   */
  mutationMark(): HistoryMutationMark {
    return { binding: this.binding, lastSeq: this.binding.lastSeq };
  }

  isCurrentMutationMark(mark: HistoryMutationMark): boolean {
    return (
      mark.binding === this.binding && mark.lastSeq === this.binding.lastSeq
    );
  }

  /** The origin id recorded on the primary journal's rows, if any. */
  primaryOriginId(): string | undefined {
    return this.primaryOrigin;
  }

  /** A resumed recorder was adopted on behalf of this origin. */
  adoptedOrigin(origin: string | undefined): void {
    if (this.fanout.active && origin === undefined)
      throw new Error(
        'A resumed recorder in a fan-out history must name its origin',
      );
    this.primaryOrigin = origin;
  }

  isAdoptingRecorder(recorder: RecordingPort): boolean {
    return this.adoptionPending && this.isRecorder(recorder);
  }

  journalPath(): string | null {
    return this.binding.recorder?.getFilePath() ?? null;
  }

  /**
   * Append one durable mutation op to the journal and the pending overlay.
   * Synchronous: durability is awaited through {@link waitForDurable} via the
   * P05b2 watermark acks.
   */
  apply(op: HistoryJournalOp): void {
    this.assertNoAdoption();
    if (this.disposed) return;
    const current = this.readLength();
    const nextLength = this.publicationOrdinals.project(
      op,
      current.length,
      this.binding.recorder?.getLastEnqueuedSequence() ?? 0,
      () => this.capturePendingFold(),
      (execute) => this.withReadRows(execute),
    );
    const recorder = this.ensureRecorder();
    const binding = this.binding;
    binding.unsubscribeWatermark ??= recorder.onCommitWatermark((watermark) =>
      absorbHistoryPending(binding, watermark.seq, watermark),
    );
    const ordinal = binding.pending.prepare(
      op,
      recorder.isActive() ? recorder.getLastEnqueuedSequence() + 1 : null,
    );
    let line: ReturnType<typeof admitHistoryPending>['line'];
    try {
      ({ line } = admitHistoryPending(
        recorder,
        op,
        this.attachmentCounters?.ownership,
      ));
    } catch (error) {
      binding.pending.cancel(ordinal);
      throw error;
    }
    if (binding.lastSeq !== null && line.seq > binding.lastSeq + 1)
      binding.externalBoundarySeq ??= line.seq - 1;
    binding.lastSeq = line.seq;
    binding.pending.publish(ordinal);
    // Admission publishes both membership and cardinality synchronously. Acks
    // only move that same membership from pending to durable, never count twice.
    binding.rowCount = nextLength;
    binding.durableTail = current.durableTail;
    this.publicationOrdinals.admitted(line.seq);
    if (!this.fanout.active) return;
    if (this.publicationDepth === 0) {
      this.publishToMirrors(recorder, [line], line.seq);
    } else if (this.scopeLines.length < DIRECT_DELIVERY_LINE_LIMIT) {
      this.scopeLines.push(line);
    } else {
      this.scopeOverflow = true;
    }
  }

  /** Small appended rows go straight to the mirrors; anything else through the pump. */
  private publishToMirrors(
    recorder: RecordingPort,
    lines: readonly SessionRecordLine[],
    seq: number,
  ): void {
    if (!this.fanoutFeed.deliverNow(recorder, lines))
      this.fanoutFeed.schedule(recorder, seq, 'deliver');
  }

  /**
   * Hold back fan-out until the caller knows whether its publication
   * survived: `close(true)` delivers the ops it admitted to the mirrors,
   * `close(false)` drops them together with their compensation.
   */
  openPublication(): HistoryPublicationScope {
    this.publicationDepth++;
    let closed = false;
    return {
      close: (published) => {
        if (closed) return;
        closed = true;
        this.publicationDepth--;
        if (this.publicationDepth > 0) return;
        const lines = this.scopeLines;
        const overflow = this.scopeOverflow;
        this.scopeLines = [];
        this.scopeOverflow = false;
        const recorder = this.binding.recorder;
        const seq = this.binding.lastSeq;
        if (!this.fanout.active || recorder === undefined || seq === null)
          return;
        if (!published) this.fanoutFeed.schedule(recorder, seq, 'drop');
        else if (overflow) this.fanoutFeed.schedule(recorder, seq, 'deliver');
        else this.publishToMirrors(recorder, lines, seq);
      },
    };
  }

  withPublicationOrdinals(action: () => Promise<void>): Promise<void> {
    return this.publicationOrdinals.run(
      this.binding.recorder?.getLastEnqueuedSequence() ?? 0,
      action,
    );
  }

  capturePublicationOwners(): Iterable<IContent> {
    return recordPublicationOwners(this.binding.lastLine);
  }

  adoptMutationBoundary(durableTail: number): void {
    if (!this.binding.seeded && this.binding.durableTail === 0) {
      this.binding.durableTail = durableTail;
    }
  }

  /**
   * Resolve once every mutation enqueued so far has a durable commit ack.
   * The final absorb runs synchronously on return, so a materialize()
   * observed after this resolves folds exactly the journal bytes.
   */
  async waitForDurable(): Promise<void> {
    await this.waitForPrimaryDurable();
    await this.settleFanout();
  }

  /**
   * Resolve once everything delivered to the mirrors so far is on disk. A
   * publication scope hands its ops to the mirrors only when it closes, which
   * is after the mutation awaited {@link waitForDurable}, so a mutation that
   * promises durability calls this once its scope has closed.
   */
  settleFanout(): Promise<void> {
    return this.fanoutFeed.settle();
  }

  private async waitForPrimaryDurable(): Promise<void> {
    const binding = this.binding;
    const seq = binding.lastSeq;
    if (seq === null) return;
    const recorder = binding.recorder;
    if (recorder === undefined) return;
    const watermark = await recorder.waitForCommitSequence(seq);
    if (this.disposed || this.binding !== binding) return;
    absorbHistoryPending(binding, seq, watermark);
  }

  retireIdleTicketStorage(): void {
    this.binding.pending.retireIdleStorage();
    this.binding.recorder?.retireIdleTicketStorage();
  }

  /**
   * Transient materialization: fold the durable journal prefix, then the
   * pending overlay. Fresh array every call; nothing is retained.
   */
  materialize(): IContent[] {
    const tx = new ReplaceTransactionFold();
    const durable = this.foldDurable(tx);
    for (let index = 0; index < this.binding.pending.length; index++)
      applyFoldEvent(
        durable,
        opToEvent(this.binding.pending.read(index).op),
        tx,
      );
    tx.abandon(arrayRowStore(durable));
    return durable;
  }

  clear(request: HistoryClearRequest): void {
    clearHistoryRows({ journal: this, ...request });
  }

  validateAndFix(request: HistoryRepairRequest): HistoryRepair {
    return repairHistoryRows(this, request);
  }

  adoptMediaOwner(owner: HistoryMediaOwner): void {
    this.withReadRows((cursor) => owner.adopt(cursor.rows()));
  }

  /** Reads the origin of every row of `previous` now, before the mutation admits anything. */
  captureCompensation(
    previous: HistoryMutationSnapshot,
  ): HistoryCompensationMark {
    this.withReadRows((cursor) => previous.captureOrigins(cursor));
    return new SnapshotCompensationMark(this, previous);
  }

  compensate(
    mark: HistoryCompensationMark,
    input: HistoryMutationInput,
    replacements: OpenReplaceTracker,
  ): Promise<void> {
    if (!(mark instanceof SnapshotCompensationMark) || mark.store !== this)
      throw new Error('The compensation mark was not captured by this store');
    return compensateMutation(this, mark.previous, input, replacements);
  }

  captureDetached(
    previous: DetachedHistoryJournal,
    signal?: AbortSignal,
    settleTokens?: () => Promise<void>,
  ): Promise<void> {
    return captureDetachedHistory(this, previous, signal, settleTokens);
  }

  /** Internal only. Capture binding, watermark, and pending membership in one turn. */
  capturePendingFold(): PendingFoldSnapshot {
    if (this.disposed) throw new Error('History journal store is disposed');
    return capturePendingFold(this.binding, this.foldCheckpoint);
  }

  withReadRows<T>(
    execute: (cursor: HistoryReadCursor) => T,
    signal?: AbortSignal,
  ): T {
    return withSynchronousHistoryCursor(
      this.capturePendingFold(),
      execute,
      this.attachmentCounters,
      signal,
    );
  }

  /**
   * Read rows through a cursor on a snapshot the caller already holds, so one
   * capture can serve both this read and the fold that follows it. The caller
   * keeps ownership of `snapshot` and must release it.
   */
  withReadRowsOf<T>(
    snapshot: PendingFoldSnapshot,
    execute: (cursor: HistoryReadCursor) => T,
  ): T {
    return executePinnedCursor(snapshot, execute, this.attachmentCounters);
  }

  /**
   * Scalar queries (statistics, context boundary, newest row) over a pinned
   * snapshot. Appended rows are folded into a saved state; see
   * {@link HistorySummaryTracker}. The summary is valid only inside `read`.
   */
  withRowSummary<T>(read: (summary: HistoryRowSummary) => T): T {
    const snapshot = this.capturePendingFold();
    try {
      return read(
        this.summaryTracker.summarize(snapshot, this.attachmentCounters),
      );
    } finally {
      snapshot.release();
    }
  }

  /** The newest row, optionally of one speaker, read from a pinned fold. */
  async lastContent(
    speaker?: IContent['speaker'],
  ): Promise<IContent | undefined> {
    return this.withRowSummary((summary) => summary.lastContent(speaker));
  }

  async readRows<T>(
    execute: (view: HistoryRowView) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const snapshot = this.capturePendingFold();
    try {
      return await executePinnedCursorAsync(
        snapshot,
        (cursor) => execute(rowViewOfCursor(cursor)),
        this.attachmentCounters,
        signal,
      );
    } finally {
      snapshot.release();
    }
  }

  getLength(): number {
    return this.readLength().length;
  }

  private readLength(): ReturnType<typeof readHistoryLength> {
    if (this.disposed) throw new Error('History journal store is disposed');
    return readHistoryLength(
      this.binding,
      () => this.capturePendingFold(),
      this.attachmentCounters,
    );
  }

  /** Stream one captured row at a time without eager history materialization. */
  streamRows(
    query?: HistorySuffixQuery,
    signal?: AbortSignal,
  ): AsyncIterable<IContent> {
    return streamRows(
      () => this.capturePendingFold(),
      this.attachmentCounters,
      query,
      signal,
    );
  }

  openDumpSnapshot(): Promise<HistoryDumpSnapshot> {
    return openHistoryDumpSnapshot(
      this.capturePendingFold(),
      this.attachmentCounters,
    );
  }

  async withMutationSnapshot<T>(
    execute: (snapshot: HistoryMutationSnapshot) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const snapshot = await captureHistoryMutationSnapshot(
      this.capturePendingFold(),
      this.attachmentCounters,
      this.mutationOwnership,
      signal,
    );
    try {
      return await execute(snapshot);
    } finally {
      await snapshot.close();
    }
  }

  /**
   * Switch to a validated durable range without reading or copying content.
   * The caller retains ownership of the adopted recorder. Rollback restores
   * the old binding, including acknowledgements received during the switch;
   * commit retires only a self-owned temporary journal. Neither operation
   * changes media ownership or HistoryService's derived state.
   */
  adoptJournal(
    recorder: RecordingPort,
    watermark: CommitWatermark,
    stripResumeMarkers = false,
    projection?: ResumeProjection,
  ): HistoryJournalAdoption {
    this.assertNoAdoption();
    if (this.disposed) throw new Error('History journal store is disposed');
    if (recorder === this.binding.recorder) {
      throw new Error('Journal adoption requires a different recorder');
    }
    const previous = this.binding;
    this.binding = {
      ...journalBinding(recorder),
      projection,
      durableTail: watermark.byteOffset,
      resumeBoundary: stripResumeMarkers ? watermark.byteOffset : 0,
      seeded: true,
    };
    this.adoptionPending = true;
    let settled = false;
    let retirementPrepared = false;
    const mirrored = this.fanout.active;
    // Mirrors outlive a replaced primary, so their retirement listeners move
    // to the adopted binding instead of firing.
    if (mirrored)
      for (const listener of previous.retired)
        this.binding.retired.add(listener);
    const retire = (): void => {
      if (!mirrored) for (const listener of previous.retired) listener();
    };
    const prepareCommit = (): void => {
      if (settled) throw new Error('Journal adoption is already settled');
      if (retirementPrepared) return;
      retire();
      retirementPrepared = true;
    };
    const settle = (): void => {
      if (settled) throw new Error('Journal adoption is already settled');
      settled = true;
      this.adoptionPending = false;
    };
    return {
      useDurableProjection: (watermark) => {
        if (settled) throw new Error('Journal adoption is already settled');
        this.binding = {
          ...this.binding,
          durableTail: watermark.byteOffset,
          rowCount: null,
          resumeBoundary: 0,
          projection: undefined,
        };
      },
      prepareCommit,
      commit: async () => {
        settle();
        if (!retirementPrepared) retire();
        if (mirrored) await this.mirrorResumedRecorder(recorder);
        retireHistoryPending(previous);
        removeTempDir(previous.projection?.directory ?? null);
        if (previous.ownsRecorder) {
          await previous.recorder?.dispose();
          removeTempDir(previous.tempDir);
        }
      },
      rollback: () => {
        settle();
        this.binding = previous;
      },
    };
  }

  /**
   * A resumed history replaces the shared rows with rows the resuming origin
   * owns. Its recorder takes over that origin's mirror, so it keeps the
   * origin filter instead of becoming the unfiltered primary; the hidden
   * primary is rebuilt from it, and every other mirror loses the rows it held.
   */
  private async mirrorResumedRecorder(recorder: RecordingPort): Promise<void> {
    const owner = this.primaryOrigin;
    if (owner === undefined)
      throw new Error(
        'A resumed recorder in a fan-out history must name its origin',
      );
    await this.fanoutFeed.settle();
    await this.fanoutFeed.retireSharedRows(owner);
    this.fanout.bind(owner, recorder);
    const copy = await cloneHistoryJournal(recorder, () => this.disposed);
    this.binding = {
      ...this.binding,
      recorder: copy.recorder,
      ownsRecorder: true,
      tempDir: copy.directory,
      pending: new HistoryPendingTickets(),
      unsubscribeWatermark: undefined,
      durableTail: copy.byteOffset,
      resumeBoundary: 0,
      projection: undefined,
      seeded: true,
      lastLine: null,
      lastSeq: null,
    };
    this.fanoutFeed.reset(copy.recorder, copy.byteOffset, {
      origin: owner,
      end: copy.byteOffset,
    });
  }

  private assertNoAdoption(): void {
    if (this.adoptionPending || this.attachmentPending)
      throw new Error('Journal adoption is pending');
  }

  /**
   * Late attach: copy live rows onto a new recorder when foreground history
   * was built before recording started. Resume must use adoptJournal instead.
   */
  async detachJournal(recorder: RecordingPort): Promise<void> {
    if (this.disposed) return;
    if (this.fanout.has(recorder)) {
      this.assertNoAdoption();
      await this.waitForDurable();
      this.fanout.unbind(recorder);
      return;
    }
    if (this.binding.recorder !== recorder) return;
    this.assertNoAdoption();
    await this.waitForDurable();
    if (this.binding.pending.length > 0)
      throw new Error('History journal contains uncommitted mutations');
    const previous = this.binding;
    const copy = await cloneHistoryJournal(recorder, () => this.disposed);
    this.binding = {
      ...previous,
      retired: new Set(),
      recorder: copy.recorder,
      ownsRecorder: true,
      tempDir: copy.directory,
      pending: new HistoryPendingTickets(),
      unsubscribeWatermark: undefined,
      durableTail: copy.byteOffset,
      seeded: true,
      lastLine: null,
      lastSeq: null,
    };
    this.primaryOrigin = undefined;
    for (const listener of previous.retired) listener();
    if (previous.ownsRecorder) {
      await previous.recorder?.dispose();
      removeTempDir(previous.tempDir);
    }
  }

  attachJournal(
    recorder: RecordingPort,
    replace = false,
    onAttached?: () => void,
    origin?: string,
  ): Promise<void> {
    this.assertNoAdoption();
    if (this.disposed)
      return Promise.reject(new Error('History journal store is disposed'));
    if (this.fanout.has(recorder)) {
      onAttached?.();
      return Promise.resolve();
    }
    if (recorder === this.binding.recorder) {
      this.primaryOrigin ??= origin;
      onAttached?.();
      return Promise.resolve();
    }
    if (
      origin !== undefined &&
      (this.fanout.active ||
        (this.primaryOrigin !== undefined && this.primaryOrigin !== origin))
    )
      return this.attachMirror(recorder, replace, origin, onAttached);
    return this.transferJournal(recorder, replace, onAttached, origin);
  }

  /** The primary journal's committed rows, as an attachment source. */
  private attachmentSource(): AttachmentSource {
    const filePath = this.journalPath();
    const fileSize = filePath === null ? 0 : fs.statSync(filePath).size;
    return {
      filePath,
      byteOffset:
        this.binding.seeded || this.binding.durableTail > 0
          ? this.binding.durableTail
          : fileSize,
      resumeBoundary: this.binding.resumeBoundary,
      projection: this.binding.projection,
    };
  }

  private async settleForAttachment(): Promise<void> {
    await this.waitForDurable();
    if (this.binding.pending.length > 0)
      throw new Error('History journal contains uncommitted mutations');
    await this.binding.recorder?.flush();
  }

  private async transferJournal(
    recorder: RecordingPort,
    replace: boolean,
    onAttached?: () => void,
    origin?: string,
  ): Promise<void> {
    this.attachmentPending = true;
    let transferred: AttachmentCommit;
    try {
      await this.settleForAttachment();
      transferred = await appendHistoryJournal(
        this.attachmentSource(),
        recorder,
        replace,
        () => this.disposed,
        this.attachmentCounters,
      );
    } finally {
      this.attachmentPending = false;
    }
    const adoption = this.adoptJournal(recorder, transferred.watermark);
    try {
      onAttached?.();
      adoption.prepareCommit();
    } catch (error) {
      adoption.rollback();
      throw new HistoryAttachmentError(
        error,
        transferred.committedRows,
        transferred.destinationRewound,
      );
    }
    this.primaryOrigin = origin;
    await adoption.commit();
  }

  /**
   * A second origin attached to a history whose primary recorder belongs to
   * another origin. The first such attach hides the primary (a clone of the
   * first origin's file) and turns both recorders into filtered mirrors, so
   * neither retires the other. The new mirror is seeded with own and unowned
   * rows only, streamed through the filter.
   */
  private async attachMirror(
    recorder: RecordingPort,
    replace: boolean,
    origin: string,
    onAttached?: () => void,
  ): Promise<void> {
    this.attachmentPending = true;
    let transferred: AttachmentCommit;
    try {
      await this.settleForAttachment();
      if (!this.fanout.active) await this.hidePrimary();
      transferred = await appendHistoryJournal(
        this.attachmentSource(),
        recorder,
        replace,
        () => this.disposed,
        this.attachmentCounters,
        (rowOrigin) => acceptsHistoryOrigin(origin, rowOrigin),
      );
    } finally {
      this.attachmentPending = false;
    }
    this.fanout.bind(origin, recorder);
    try {
      onAttached?.();
    } catch (error) {
      this.fanout.unbind(recorder);
      throw new HistoryAttachmentError(
        error,
        transferred.committedRows,
        transferred.destinationRewound,
      );
    }
  }

  private async hidePrimary(): Promise<void> {
    const previous = this.binding;
    const visible = previous.recorder;
    const owner = this.primaryOrigin;
    if (visible === undefined || owner === undefined)
      throw new Error('History primary journal has no owner to mirror');
    const copy = await cloneHistoryJournal(visible, () => this.disposed);
    previous.unsubscribeWatermark?.();
    // The visible recorder keeps recording as a mirror, so its listeners stay.
    this.binding = {
      ...previous,
      recorder: copy.recorder,
      ownsRecorder: true,
      tempDir: copy.directory,
      pending: new HistoryPendingTickets(),
      unsubscribeWatermark: undefined,
      durableTail: copy.byteOffset,
      seeded: true,
      lastLine: null,
      lastSeq: null,
    };
    this.fanout.bind(owner, visible);
    this.fanout.active = true;
    this.fanoutFeed.reset(copy.recorder, copy.byteOffset);
  }

  /**
   * Flush and retire the journal; a self-owned temp store is removed. Resolves
   * once the recorder is disposed and the scratch directories are gone, and
   * rejects with whatever failed (an AggregateError when several steps did).
   */
  async dispose(): Promise<void> {
    this.assertNoAdoption();
    this.disposal ??= this.release();
    return this.disposal;
  }

  private async release(): Promise<void> {
    this.disposed = true;
    this.foldCheckpoint.dispose();
    this.summaryTracker.dispose();
    const binding = this.binding;
    retireHistoryPending(binding);
    const steps = new DisposalSteps();
    const recorder = binding.recorder;
    if (recorder !== undefined && binding.ownsRecorder) {
      // Mirrors may still be reading the hidden primary's committed range.
      await steps.run(() => this.fanoutFeed.settle());
      await steps.run(() => this.fanoutFeed.dispose());
      await steps.run(() => recorder.dispose());
    }
    await steps.removeDirectory(binding.projection?.directory ?? null);
    await steps.removeDirectory(binding.tempDir);
    steps.throwIfFailed('History journal store disposal failed');
  }

  private ensureRecorder(): RecordingPort {
    if (this.binding.recorder === undefined) {
      const dir = createScratchDirSync('llxprt-history-');
      this.binding.tempDir = dir;
      this.binding.recorder = new SessionRecordingService({
        sessionId: `history-${randomUUID()}`,
        projectHash: 'llxprt-history-service',
        chatsDir: dir,
        workspaceDirs: [dir],
        provider: 'history-service',
        model: 'local',
      });
    }
    return this.binding.recorder;
  }

  /**
   * Synchronously fold the journal bytes below the durable tail. Reads only
   * watermarked bytes, so a concurrent drain — however far it has gotten —
   * can never leak a not-yet-acked record into the fold (the pending overlay
   * owns those until their ack fires).
   *
   * The watermark protocol bounds only bytes this store wrote itself. A
   * store that has never applied an op (no acks, empty pending overlay)
   * sits over a wholly-external journal — e.g. a recorder seeded before the
   * facade was constructed — and folds the entire durable file, matching
   * the JournalResolver fold of the same path (#854).
   */
  private foldDurable(tx: ReplaceTransactionFold): IContent[] {
    const filePath = this.binding.recorder?.getFilePath();
    if (filePath === null || filePath === undefined) return [];
    const externallySeeded =
      !this.binding.seeded &&
      this.binding.durableTail === 0 &&
      this.binding.pending.length === 0;
    if (!externallySeeded && this.binding.durableTail <= 0) return [];
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const limit = externallySeeded
      ? buffer.length
      : Math.min(buffer.length, this.binding.durableTail);
    if (limit <= 0) return [];
    const folded = limit < buffer.length ? buffer.subarray(0, limit) : buffer;
    const boundary = this.binding.resumeBoundary ?? 0;
    if (boundary === 0)
      return foldEvents(
        parseFoldEvents(folded.toString('utf8')),
        [],
        tx,
        false,
      );
    const restored = invalidateResponsesStatefulChain(
      foldEvents(
        parseFoldEvents(
          this.binding.projection === undefined
            ? folded.subarray(0, boundary).toString('utf8')
            : fs.readFileSync(this.binding.projection.filePath, 'utf8'),
        ),
      ),
    );
    return foldEvents(
      parseFoldEvents(folded.subarray(boundary).toString('utf8')),
      [...restored],
      tx,
      false,
    );
  }
}
