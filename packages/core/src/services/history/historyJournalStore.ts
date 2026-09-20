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
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'crypto';
import { isDeepStrictEqual } from 'node:util';
import { type IContent } from './IContent.js';
import { sanitizeProviderHistoryForSerialization } from './historyCloneUtils.js';
import { SessionRecordingService } from '../../recording/SessionRecordingService.js';
import type {
  CommitWatermark,
  CompressionDetailPayload,
  DensityMutationPayload,
  SessionEventType,
  SessionRecordLine,
  SyntheticInsertPayload,
} from '../../recording/types.js';
import type { DensityResult } from '../../core/compression/types.js';
import { debugLogger } from '../../utils/debugLogger.js';

/** Recorder options for the HistoryService constructor. */
export interface HistoryServiceJournalOptions {
  /** Injected journal store; omitted, the service creates its own temp-file store. */
  readonly recording?: SessionRecordingService;
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function fieldOf(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

/** Engine-parity speaker guard: human/ai/tool speaker with a blocks array. */
function isSpeakerContent(value: unknown): value is IContent {
  const speaker = fieldOf(value, 'speaker');
  if (speaker !== 'human' && speaker !== 'ai' && speaker !== 'tool') {
    return false;
  }
  return Array.isArray(fieldOf(value, 'blocks'));
}

/** Chronology marker seq of a content row, or null when unmarked. */
function chronSeqOf(content: IContent): number | null {
  const seq = content.metadata?.chronology?.seq;
  return typeof seq === 'number' ? seq : null;
}

function isValidSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isSpeakerContentArray(value: unknown): value is readonly IContent[] {
  return Array.isArray(value) && value.every(isSpeakerContent);
}

interface DensityReplacementRecordShape {
  readonly replacedSeq: number;
  readonly replacement: IContent;
}

function isDensityReplacementRecord(
  value: unknown,
): value is DensityReplacementRecordShape {
  if (!isRecord(value)) return false;
  if (!isValidSequence(value['replacedSeq'])) return false;
  return isSpeakerContent(value['replacement']);
}

// ---------------------------------------------------------------------------
// Mutation planning: the diff from the previous projection to the next one,
// expressed in journal ops. Pure functions — the core stamps chronology and
// derives membership spans before calling these.
// ---------------------------------------------------------------------------

/** True when `next` extends or truncates `previous` at the same marked positions. */
function isMarkedPrefix(
  previous: readonly IContent[],
  next: readonly IContent[],
): boolean {
  if (next.length > previous.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    const previousSeq = chronSeqOf(previous[index]);
    if (previousSeq === null || previousSeq !== chronSeqOf(next[index])) {
      return false;
    }
  }
  return true;
}

function contentOps(contents: readonly IContent[]): HistoryJournalOp[] {
  return contents.map((content) => ({ kind: 'content', content }));
}

function rewindAllOp(rows: readonly IContent[]): HistoryJournalOp {
  const firstSeq =
    rows.length > 0 ? (chronSeqOf(rows[0]) ?? undefined) : undefined;
  return { kind: 'rewind', itemsRemoved: rows.length, cutSeq: firstSeq };
}

/**
 * Plan the journal ops that turn `previous` into `next`:
 *
 *  - strict marked prefix, shorter → one `rewind` (count + cut seq);
 *  - strict marked prefix, longer → `content` rows for the appended tail;
 *  - single-item whole replacement over a marked history →
 *    `compression_detail` + `compressed` (the compression shape);
 *  - anything else → rewind everything, then re-record `next` in full.
 */
export function planHistoryMutation(
  previous: readonly IContent[],
  next: readonly IContent[],
): HistoryJournalOp[] {
  if (next.length === previous.length && isMarkedPrefix(previous, next)) {
    // Membership is unchanged; durable ops are needed only for rows whose
    // VALUE changed in place (block rewrites such as provider-file bindings
    // or tool-response edits). Each changed row lands as its own addressed
    // replacement keyed by the row's chronology marker (#854).
    const ops: HistoryJournalOp[] = [];
    for (let index = 0; index < next.length; index += 1) {
      if (
        next[index] === previous[index] ||
        isDeepStrictEqual(next[index], previous[index])
      ) {
        continue;
      }
      ops.push({
        kind: 'density',
        payload: {
          removedSeqs: [],
          replacements: [
            {
              replacedSeq: chronSeqOf(previous[index]) ?? 0,
              replacement: next[index],
            },
          ],
        },
      });
    }
    return ops;
  }
  if (
    next.length > previous.length &&
    isMarkedPrefix(previous, next.slice(0, previous.length))
  ) {
    return contentOps(next.slice(previous.length));
  }
  if (next.length < previous.length && isMarkedPrefix(previous, next)) {
    const firstRemoved = previous[next.length];
    return [
      {
        kind: 'rewind',
        itemsRemoved: previous.length - next.length,
        cutSeq: chronSeqOf(firstRemoved) ?? undefined,
      },
    ];
  }
  if (
    next.length === 1 &&
    previous.length > 0 &&
    previous.every((row) => chronSeqOf(row) !== null)
  ) {
    return [
      {
        kind: 'compressionDetail',
        payload: {
          fromSeq: chronSeqOf(previous[0]) ?? 0,
          toSeq: chronSeqOf(previous[previous.length - 1]) ?? 0,
          itemsCompressed: previous.length,
        },
      },
      {
        kind: 'compressed',
        summary: next[0],
        itemsCompressed: previous.length,
      },
    ];
  }
  return [
    ...(previous.length > 0 ? [rewindAllOp(previous)] : []),
    ...contentOps(next),
  ];
}

/**
 * Plan a validated density pass as one `density_mutation` op, addressed by
 * chronology marker. Returns null when any affected row is unmarked — the
 * journal cannot address it, so the caller falls back to the wholesale
 * rewrite plan.
 */
export function planDensityMutation(
  current: readonly IContent[],
  result: DensityResult,
): HistoryJournalOp[] | null {
  const removedSeqs: number[] = [];
  for (const index of result.removals) {
    const seq = chronSeqOf(current[index]);
    if (seq === null) return null;
    removedSeqs.push(seq);
  }
  const replacements: DensityReplacementRecordShape[] = [];
  for (const [index, replacement] of result.replacements) {
    const seq = chronSeqOf(current[index]);
    if (seq === null) return null;
    replacements.push({ replacedSeq: seq, replacement });
  }
  return [{ kind: 'density', payload: { removedSeqs, replacements } }];
}

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
function envelopeToEvent(type: string, payload: unknown): FoldEvent | null {
  switch (type) {
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

interface PendingEntry {
  readonly op: HistoryJournalOp;
  /** Envelope seq once enqueued; null when the recorder could not accept it. */
  readonly seq: number | null;
}

/**
 * Journal-backed store behind the HistoryService facade. See the module
 * header for the architecture contract.
 */
export class HistoryJournalStore {
  private recorder: SessionRecordingService | undefined;
  private ownsRecorder: boolean;
  private tempDir: string | null = null;
  private pending: PendingEntry[] = [];
  private durableTail = 0;
  private lastLine: SessionRecordLine | null = null;
  private disposed = false;

  constructor(recording?: SessionRecordingService) {
    if (recording !== undefined) {
      this.recorder = recording;
      this.ownsRecorder = false;
      return;
    }
    // The bare store's recorder is created lazily on the first mutation so
    // read-only services never touch the filesystem.
    this.ownsRecorder = true;
  }

  /** The file backing the store, or null before the first durable record. */
  journalPath(): string | null {
    return this.recorder?.getFilePath() ?? null;
  }

  /**
   * Append one durable mutation op to the journal and the pending overlay.
   * Synchronous: durability is awaited through {@link waitForDurable} via the
   * P05b2 watermark acks.
   */
  apply(op: HistoryJournalOp): void {
    if (this.disposed) return;
    const recorder = this.ensureRecorder();
    const { type, payload } = opToEnvelope(op);
    const line = recorder.enqueue(type, payload);
    if (line !== null) {
      this.lastLine = line;
      // Track the ack in the background so the overlay shrinks as records
      // become durable; a failure surfaces to waitForDurable() callers.
      void recorder.waitForCommit(line).then(
        (watermark) => this.absorb(line.seq, watermark),
        (error: unknown) => {
          debugLogger.debug(
            'History journal commit failed; durability error is reported through waitForCommit()',
            error,
          );
        },
      );
    }
    this.pending.push({ op, seq: line === null ? null : line.seq });
  }

  /**
   * Resolve once every mutation enqueued so far has a durable commit ack.
   * The final absorb runs synchronously on return, so a materialize()
   * observed after this resolves folds exactly the journal bytes.
   */
  async waitForDurable(): Promise<void> {
    const line = this.lastLine;
    if (line === null) return;
    const recorder = this.recorder;
    if (recorder === undefined) return;
    const watermark = await recorder.waitForCommit(line);
    this.absorb(line.seq, watermark);
  }

  /**
   * Transient materialization: fold the durable journal prefix, then the
   * pending overlay. Fresh array every call; nothing is retained.
   */
  materialize(): IContent[] {
    const durable = this.foldDurable();
    if (this.pending.length === 0) return durable;
    return foldEvents(
      this.pending.map((entry) => opToEvent(entry.op)),
      durable,
    );
  }

  /**
   * Late attach: transfer the live rows to `recorder` and use it from here
   * on. Used by the foreground wiring order where history is built before
   * recording starts. Content that reached the (temp) journal pre-attach is
   * re-recorded onto the attached journal so its fold carries the full
   * conversation; the retired self-owned store is disposed.
   */
  attachJournal(recorder: SessionRecordingService): void {
    if (this.disposed || recorder === this.recorder) return;
    const rows = this.materialize();
    const retired = this.ownsRecorder ? this.recorder : undefined;
    const retiredTempDir = this.ownsRecorder ? this.tempDir : null;
    this.recorder = recorder;
    this.ownsRecorder = false;
    this.tempDir = null;
    this.pending = [];
    this.durableTail = 0;
    this.lastLine = null;
    for (const row of rows) {
      this.apply({ kind: 'content', content: row });
    }
    if (retired !== undefined) {
      void retired
        .dispose()
        .catch(() => undefined)
        .then(() => {
          removeTempDir(retiredTempDir);
        });
    }
  }

  /** Flush and retire the journal; a self-owned temp store is removed. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = [];
    const recorder = this.recorder;
    const tempDir = this.tempDir;
    if (recorder === undefined) {
      removeTempDir(tempDir);
      return;
    }
    void recorder
      .dispose()
      .catch(() => undefined)
      .then(() => {
        if (this.ownsRecorder) removeTempDir(tempDir);
      });
  }

  private ensureRecorder(): SessionRecordingService {
    if (this.recorder === undefined) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'llxprt-history-'));
      this.tempDir = dir;
      this.recorder = new SessionRecordingService({
        sessionId: `history-${randomUUID()}`,
        projectHash: 'llxprt-history-service',
        chatsDir: dir,
        workspaceDirs: [dir],
        provider: 'history-service',
        model: 'local',
      });
    }
    return this.recorder;
  }

  /**
   * Record durability of `seq`: advance the foldable tail to the watermark's
   * exclusive end offset and drop the now-durable overlay entries. A seq that
   * was never enqueued (null) never leaves the overlay.
   */
  private absorb(seq: number, watermark: CommitWatermark): void {
    if (watermark.byteOffset > this.durableTail) {
      this.durableTail = watermark.byteOffset;
    }
    this.pending = this.pending.filter(
      (entry) => entry.seq === null || entry.seq > seq,
    );
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
    const filePath = this.recorder?.getFilePath();
    if (filePath === null || filePath === undefined) return [];
    const externallySeeded =
      this.durableTail === 0 && this.pending.length === 0;
    if (!externallySeeded && this.durableTail <= 0) return [];
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const limit = externallySeeded
      ? buffer.length
      : Math.min(buffer.length, this.durableTail);
    if (limit <= 0) return [];
    const folded = limit < buffer.length ? buffer.subarray(0, limit) : buffer;
    return foldEvents(parseFoldEvents(folded.toString('utf8')));
  }
}

/**
 * The durability boundary requires JSON-safe payloads: the journal is a
 * JSON-lines file, so content that reaches an envelope passes through the
 * same cyclic-structure sanitizer the provider path uses. The pending
 * overlay keeps the caller's original object untouched — pre-commit reads
 * behave exactly as before; only the durable copy is normalized (#854).
 */
function durableContent(content: IContent): IContent {
  return sanitizeProviderHistoryForSerialization([content])[0];
}

/** Map an op onto its journal envelope; one op, one record. */
function opToEnvelope(op: HistoryJournalOp): {
  readonly type: SessionEventType;
  readonly payload: unknown;
} {
  switch (op.kind) {
    case 'content':
      return {
        type: 'content',
        payload: { content: durableContent(op.content) },
      };
    case 'rewind':
      return op.cutSeq === undefined
        ? { type: 'rewind', payload: { itemsRemoved: op.itemsRemoved } }
        : {
            type: 'rewind',
            payload: { itemsRemoved: op.itemsRemoved, cutSeq: op.cutSeq },
          };
    case 'compressed':
      return {
        type: 'compressed',
        payload: {
          summary: durableContent(op.summary),
          itemsCompressed: op.itemsCompressed,
        },
      };
    case 'compressionDetail':
      return { type: 'compression_detail', payload: op.payload };
    case 'syntheticInsert':
      return {
        type: 'synthetic_insert',
        payload: { ...op.payload, content: durableContent(op.payload.content) },
      };
    case 'density':
      return {
        type: 'density_mutation',
        payload: {
          ...op.payload,
          replacements: op.payload.replacements.map((entry) => ({
            replacedSeq: entry.replacedSeq,
            replacement: durableContent(entry.replacement),
          })),
        },
      };
    default: {
      // Exhaustiveness guard: a new op kind must state its envelope shape.
      const exhaustive: never = op;
      void exhaustive;
      throw new Error('unreachable: unmapped history journal op');
    }
  }
}

function removeTempDir(dir: string | null): void {
  if (dir === null) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Temp litter is harmless; never mask a dispose outcome with cleanup.
  }
}
