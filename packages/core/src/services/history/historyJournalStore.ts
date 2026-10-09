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

import {
  isRecord,
  fieldOf,
  isSpeakerContent,
  isValidSequence,
  isSpeakerContentArray,
  isDensityReplacementRecord,
} from './historyJournalGuards.js';
import * as fs from 'node:fs';
import {
  openHistoryDumpSnapshot,
  type HistoryDumpSnapshot,
} from './historyDumpSnapshot.js';
import {
  appendHistoryJournal,
  HistoryAttachmentError,
  type AttachmentCommit,
} from './attachHistoryJournal.js';
import type { JournalReadCounters } from '../../recording/journalCounters.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { cloneHistoryJournal, removeTempDir } from './cloneHistoryJournal.js';
import {
  parseChronologyBinding,
  type ChronologyBinding,
} from '../../recording/chronologyBinding.js';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'crypto';
import {
  captureHistoryMutationSnapshot,
  type HistoryMutationSnapshot,
} from './historyMutationSnapshot.js';
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
import type {
  CommitWatermark,
  CompressionDetailPayload,
  DensityMutationPayload,
  SyntheticInsertPayload,
} from '../../recording/types.js';
import { HistoryPendingTickets } from './history-pending-tickets.js';
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
  type HistoryReadCursor,
} from '../../recording/synchronousHistoryCursor.js';

/** Recorder options for the HistoryService constructor. */
export type { HistoryServiceJournalOptions } from './historyBatchContracts.js';

/**
 * One durable history mutation in the P05b1 journal-op vocabulary. This is
 * the unit the overlay folds and the journal records — one op per envelope.
 */
export type HistoryJournalOp =
  | { readonly kind: 'content'; readonly content: IContent }
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

/**
 * Kind-neutral fold event: ops (pending) and parsed journal envelopes
 * (durable) normalize to this shape so a single fold implementation serves
 * both layers.
 */
type FoldEvent =
  | {
      readonly kind: 'chronologyBind';
      readonly binding: ChronologyBinding;
      readonly content?: IContent;
    }
  | { readonly kind: 'content'; readonly content: IContent }
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
  | { readonly kind: 'compressionDetail' }
  | {
      readonly kind: 'syntheticInsert';
      readonly content: IContent;
      readonly chronologySeq: number;
      readonly afterSeq: number;
    }
  | {
      readonly kind: 'density';
      readonly removedSeqs: readonly number[];
      readonly replacements: ReadonlyArray<{
        readonly replacedSeq: number;
        readonly replacement: IContent;
      }>;
    }
  | { readonly kind: 'semanticPurge'; readonly history: readonly IContent[] };

/** Recording versions this store folds, mirroring the resolver. */
const SUPPORTED_RECORDING_VERSIONS = new Set([1, 2]);

function chronSeqOf(content: IContent): number | null {
  const seq = content.metadata?.chronology?.seq;
  return typeof seq === 'number' ? seq : null;
}

// ---------------------------------------------------------------------------
// Mutation planning: the diff from the previous projection to the next one,
// expressed in journal ops. Pure functions — the core stamps chronology and
// derives membership spans before calling these.
// ---------------------------------------------------------------------------

/**
 * Plan a validated density pass as one `density_mutation` op, addressed by
 * chronology marker. Returns null when any affected row is unmarked — the
 * journal cannot address it, so the caller falls back to the wholesale
 * rewrite plan.
 */

// ---------------------------------------------------------------------------
// Op ↔ envelope ↔ fold-event mapping
// ---------------------------------------------------------------------------

function opToEvent(op: HistoryJournalOp): FoldEvent {
  switch (op.kind) {
    case 'content':
      return { kind: 'content', content: op.content };
    case 'rewind':
      return {
        kind: 'rewind',
        itemsRemoved: op.itemsRemoved,
        cutSeq: op.cutSeq,
      };
    case 'compressed':
      return {
        kind: 'compressed',
        summary: op.summary,
        itemsCompressed: op.itemsCompressed,
      };
    case 'compressionDetail':
      return { kind: 'compressionDetail' };
    case 'syntheticInsert':
      return {
        kind: 'syntheticInsert',
        content: op.payload.content,
        chronologySeq: op.payload.chronologySeq,
        afterSeq: op.payload.afterSeq,
      };
    case 'density':
      return {
        kind: 'density',
        removedSeqs: op.payload.removedSeqs,
        replacements: op.payload.replacements,
      };
    default: {
      // Exhaustiveness guard: a new op kind must map onto a fold event.
      const exhaustive: never = op;
      void exhaustive;
      throw new Error('unreachable: unmapped history journal op');
    }
  }
}

/**
 * Map a parsed journal envelope onto a fold event; null for session
 * bookkeeping, metadata events, and any payload that fails its engine-parity
 * validation (those records are skipped, matching the resolver).
 */
function chronologyBindingEvent(payload: unknown): FoldEvent | null {
  const binding = parseChronologyBinding(payload);
  const content = fieldOf(payload, 'content');
  if (binding === null || (content !== undefined && !isSpeakerContent(content)))
    return null;
  return { kind: 'chronologyBind', binding, content };
}

function envelopeToEvent(type: string, payload: unknown): FoldEvent | null {
  switch (type) {
    case 'chronology_bind':
      return chronologyBindingEvent(payload);
    case 'content': {
      const content = fieldOf(payload, 'content');
      return isSpeakerContent(content) ? { kind: 'content', content } : null;
    }
    case 'rewind': {
      const itemsRemoved = fieldOf(payload, 'itemsRemoved');
      if (typeof itemsRemoved !== 'number' || itemsRemoved < 0) return null;
      const cutSeq = fieldOf(payload, 'cutSeq');
      return {
        kind: 'rewind',
        itemsRemoved,
        cutSeq: cutSeq === undefined ? undefined : (cutSeq as number),
      };
    }
    case 'compressed': {
      const summary = fieldOf(payload, 'summary');
      const itemsCompressed = fieldOf(payload, 'itemsCompressed');
      if (!isSpeakerContent(summary) || itemsCompressed === undefined) {
        return null;
      }
      return {
        kind: 'compressed',
        summary,
        itemsCompressed: itemsCompressed as number,
      };
    }
    case 'compression_detail':
      return { kind: 'compressionDetail' };
    case 'synthetic_insert': {
      const content = fieldOf(payload, 'content');
      const chronologySeq = fieldOf(payload, 'chronologySeq');
      const afterSeq = fieldOf(payload, 'afterSeq');
      if (
        !isSpeakerContent(content) ||
        !isValidSequence(chronologySeq) ||
        !isValidSequence(afterSeq)
      ) {
        return null;
      }
      return {
        kind: 'syntheticInsert',
        content,
        chronologySeq,
        afterSeq,
      };
    }
    case 'density_mutation': {
      const removedSeqs = fieldOf(payload, 'removedSeqs');
      const replacements = fieldOf(payload, 'replacements');
      if (
        !Array.isArray(removedSeqs) ||
        !removedSeqs.every(isValidSequence) ||
        !Array.isArray(replacements) ||
        !replacements.every(isDensityReplacementRecord)
      ) {
        return null;
      }
      return {
        kind: 'density',
        removedSeqs,
        replacements,
      };
    }
    case 'semantic_media_purge': {
      const history = fieldOf(payload, 'history');
      if (!isSpeakerContentArray(history)) return null;
      return { kind: 'semanticPurge', history };
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// The fold (mirrors JournalResolver's rules; divergences noted)
// ---------------------------------------------------------------------------

/**
 * Fold events oldest-first into the surviving content rows. Local mutable
 * state only — the result array is the caller's transient materialization.
 */
function foldEvents(
  events: ReadonlyArray<FoldEvent | null>,
  initial: readonly IContent[] = [],
): IContent[] {
  const rows: IContent[] = [...initial];
  for (const event of events) {
    if (event === null) continue;
    applyFoldEvent(rows, event);
  }
  return rows;
}

/** Rewind: cut at the marked seq when resolvable, else drop the tail count. */
function rewindRows(
  rows: IContent[],
  itemsRemoved: number,
  cutSeq?: number,
): void {
  if (cutSeq !== undefined) {
    const cut = rows.findIndex((row) => chronSeqOf(row) === cutSeq);
    if (cut !== -1) {
      rows.length = cut;
      return;
    }
  }
  rows.length = Math.max(0, rows.length - itemsRemoved);
}

/** Insert an unjournalled-mutation entry after its marked anchor row. */
function insertAfterAnchor(
  rows: IContent[],
  content: IContent,
  afterSeq: number,
): void {
  const anchor = rows.findIndex((row) => chronSeqOf(row) === afterSeq);
  if (anchor !== -1) {
    rows.splice(anchor + 1, 0, content);
  }
}

/** Resolve one row against a density pass: replacement, removal, or kept. */
function resolveDensityRow(
  row: IContent,
  removed: ReadonlySet<number>,
  replacementBySeq: ReadonlyMap<number, IContent>,
): IContent | null {
  const chron = chronSeqOf(row);
  if (chron === null) return row;
  const replacement = replacementBySeq.get(chron);
  if (replacement !== undefined) return replacement;
  return removed.has(chron) ? null : row;
}

/**
 * Apply a density event row-wise: replacement wins over removal, matching the
 * live density projection. Divergence from the resolver: a density mutation
 * that touches rows inside a semantic_media_purge survivor is skipped there
 * (coarse purge units) and applied row-wise here, where the purge is already
 * flattened.
 */
function applyDensityEvent(
  rows: IContent[],
  event: Extract<FoldEvent, { readonly kind: 'density' }>,
): void {
  const removed = new Set<number>(event.removedSeqs);
  const replacementBySeq = new Map<number, IContent>();
  for (const entry of event.replacements) {
    replacementBySeq.set(entry.replacedSeq, entry.replacement);
  }
  const surviving: IContent[] = [];
  for (const row of rows) {
    const resolved = resolveDensityRow(row, removed, replacementBySeq);
    if (resolved !== null) surviving.push(resolved);
  }
  rows.length = 0;
  for (const row of surviving) {
    rows.push(row);
  }
}

/** Apply one fold event to the transient rows. */
function applyFoldEvent(rows: IContent[], event: FoldEvent): void {
  if (event.kind === 'chronologyBind') {
    if (event.binding.rowIndex >= rows.length) return;
    const row = event.content ?? rows[event.binding.rowIndex];
    const restored =
      event.binding.invalidateResponses === true
        ? invalidateResponsesStatefulChain([row])[0]
        : row;
    rows[event.binding.rowIndex] = {
      ...restored,
      metadata: { ...restored.metadata, chronology: event.binding.chronology },
    };
    return;
  }

  switch (event.kind) {
    case 'content':
      rows.push(event.content);
      break;
    case 'rewind':
      rewindRows(rows, event.itemsRemoved, event.cutSeq);
      break;
    case 'compressed':
      rows.length = 0;
      rows.push(event.summary);
      break;
    case 'compressionDetail':
      // Membership-pinning record; a no-op for the row fold (parity).
      break;
    case 'syntheticInsert':
      insertAfterAnchor(rows, event.content, event.afterSeq);
      break;
    case 'density':
      applyDensityEvent(rows, event);
      break;
    case 'semanticPurge':
      rows.length = 0;
      rows.push(...event.history);
      break;
    default: {
      // Exhaustiveness guard: a new fold event must state its fold rule.
      const exhaustive: never = event;
      void exhaustive;
      throw new Error('unreachable: unmapped history fold event');
    }
  }
}

/**
 * Parse one decoded journal line into a fold event; null for blank lines,
 * unparseable crash-torn tails, session bookkeeping, and payloads that fail
 * their engine-parity validation (all skipped, matching the resolver).
 */
function parseFoldLine(raw: string, isFirstLine: boolean): FoldEvent | null {
  if (raw.length === 0) return null;
  const body = isFirstLine && raw.startsWith('\uFEFF') ? raw.slice(1) : raw;
  if (body.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Unparseable mid-file line or crash-torn tail: skipped (parity).
    return null;
  }
  if (!isRecord(parsed)) return null;
  const version = parsed['v'];
  if (
    typeof version !== 'number' ||
    !SUPPORTED_RECORDING_VERSIONS.has(version)
  ) {
    throw new Error(
      `Unsupported recording version ${String(version)} in history journal`,
    );
  }
  const type = parsed['type'];
  if (typeof type !== 'string') return null;
  return envelopeToEvent(type, parsed['payload']);
}

/** Split a decoded journal byte range into fold events, one per line. */
function parseFoldEvents(text: string): Array<FoldEvent | null> {
  const lines = text.split('\n');
  const events: Array<FoldEvent | null> = [];
  for (let index = 0; index < lines.length; index += 1) {
    events.push(parseFoldLine(lines[index], index === 0));
  }
  return events;
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

export interface HistoryJournalAdoption {
  useDurableProjection(watermark: CommitWatermark): void;
  prepareCommit(): void;
  commit(): Promise<void>;
  rollback(): void;
}

export class HistoryJournalStore {
  private binding: JournalBinding;
  private adoptionPending = false;
  private attachmentPending = false;
  private disposed = false;
  private readonly publicationOrdinals = new HistoryPublicationOrdinals();

  constructor(
    recording?: SessionRecordingService,
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

  isRecorder(recorder: SessionRecordingService): boolean {
    return this.binding.recorder === recorder;
  }

  isAdoptingRecorder(recorder: SessionRecordingService): boolean {
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
    if (line !== null) {
      if (binding.lastSeq !== null && line.seq > binding.lastSeq + 1)
        binding.externalBoundarySeq ??= line.seq - 1;
      binding.lastSeq = line.seq;
    }
    binding.pending.publish(ordinal);
    // Admission publishes both membership and cardinality synchronously. Acks
    // only move that same membership from pending to durable, never count twice.
    binding.rowCount = nextLength;
    binding.durableTail = current.durableTail;
    this.publicationOrdinals.admitted(
      line?.seq ?? recorder.getLastEnqueuedSequence(),
    );
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
    const durable = this.foldDurable();
    if (this.binding.pending.length === 0) return durable;
    for (let index = 0; index < this.binding.pending.length; index++)
      applyFoldEvent(durable, opToEvent(this.binding.pending.read(index).op));
    return durable;
  }

  /** Internal only. Capture binding, watermark, and pending membership in one turn. */
  capturePendingFold(): PendingFoldSnapshot {
    if (this.disposed) throw new Error('History journal store is disposed');
    return capturePendingFold(this.binding);
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
    recorder: SessionRecordingService,
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
    const prepareCommit = (): void => {
      if (settled) throw new Error('Journal adoption is already settled');
      if (retirementPrepared) return;
      for (const listener of previous.retired) listener();
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
        if (!retirementPrepared)
          for (const listener of previous.retired) listener();
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

  private assertNoAdoption(): void {
    if (this.adoptionPending || this.attachmentPending)
      throw new Error('Journal adoption is pending');
  }

  /**
   * Late attach: copy live rows onto a new recorder when foreground history
   * was built before recording started. Resume must use adoptJournal instead.
   */
  async detachJournal(recorder: SessionRecordingService): Promise<void> {
    if (this.disposed || this.binding.recorder !== recorder) return;
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
    for (const listener of previous.retired) listener();
    if (previous.ownsRecorder) {
      await previous.recorder?.dispose();
      removeTempDir(previous.tempDir);
    }
  }

  attachJournal(
    recorder: SessionRecordingService,
    replace = false,
    onAttached?: () => void,
  ): Promise<void> {
    this.assertNoAdoption();
    if (this.disposed)
      return Promise.reject(new Error('History journal store is disposed'));
    if (recorder === this.binding.recorder) {
      onAttached?.();
      return Promise.resolve();
    }
    return this.transferJournal(recorder, replace, onAttached);
  }

  private async transferJournal(
    recorder: SessionRecordingService,
    replace: boolean,
    onAttached?: () => void,
  ): Promise<void> {
    this.attachmentPending = true;
    let transferred: AttachmentCommit;
    try {
      await this.waitForDurable();
      if (this.binding.pending.length > 0)
        throw new Error('History journal contains uncommitted mutations');
      await this.binding.recorder?.flush();
      const filePath = this.journalPath();
      const fileSize = filePath === null ? 0 : fs.statSync(filePath).size;
      const byteOffset =
        this.binding.seeded || this.binding.durableTail > 0
          ? this.binding.durableTail
          : fileSize;
      transferred = await appendHistoryJournal(
        {
          filePath,
          byteOffset,
          resumeBoundary: this.binding.resumeBoundary,
          projection: this.binding.projection,
        },
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
    await adoption.commit();
  }

  /** Flush and retire the journal; a self-owned temp store is removed. */
  dispose(): void {
    this.assertNoAdoption();
    if (this.disposed) return;
    this.disposed = true;
    removeTempDir(this.binding.projection?.directory ?? null);
    retireHistoryPending(this.binding);
    const recorder = this.binding.recorder;
    const tempDir = this.binding.tempDir;
    if (recorder === undefined || !this.binding.ownsRecorder) {
      removeTempDir(tempDir);
      return;
    }
    void recorder
      .dispose()
      .catch(() => undefined)
      .then(() => {
        if (this.binding.ownsRecorder) removeTempDir(tempDir);
      });
  }

  private ensureRecorder(): SessionRecordingService {
    if (this.binding.recorder === undefined) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-history-'));
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
  private foldDurable(): IContent[] {
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
      return foldEvents(parseFoldEvents(folded.toString('utf8')));
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
    );
  }
}
