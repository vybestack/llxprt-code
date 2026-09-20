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
 * @plan PLAN-20260917-ISSUE854.P05a
 * @requirement G2, G4
 *
 * JournalResolver: an interval-list fold over the session journal. A first,
 * events-only pass walks the file chunked and folds every history mutation
 * (`rewind`, `compressed`, `semantic_media_purge`) into an ordered list of
 * surviving rows, retaining only numbers — envelope seq, byte offset and
 * length, chronology marker — never decoded content. The second pass re-reads
 * only the survivor regions, decoding rows oldest first.
 *
 * The fold is engine-parity: the eager ReplayEngine (`replaySession`) applies
 * the same mutations into the same survivor sequence, and its per-event rules
 * (speaker guard, version gate, malformed counters, torn-tail discard) are
 * mirrored here so both views of one journal agree.
 *
 * Memory shape: the prepass retains O(survivors) numeric rows and nothing
 * else. A `semantic_media_purge` payload is not parsed during the prepass at
 * all; its row count and per-row markers are filled in lazily — either when a
 * later rewind must fold across it, or during the second pass, which decodes
 * the purge record streaming row by row and lets the parsed history array
 * drop out of scope once its rows have been yielded (the array is pinned only
 * for the duration of yielding that one record; the WeakRef contract only
 * requires no retention after iteration). Decoded `IContent` objects are
 * never retained by the resolver after iteration releases them.
 */

import * as fs from 'node:fs/promises';
import type { IContent } from '../services/history/IContent.js';
import {
  isRecordWithNonNegativeIntegerPair,
  isSemanticMediaPurgeFrontierWithinHistory,
} from './semanticMediaPurgeReplayValidation.js';

/** Default read chunk size; overridable per resolver for tests. */
const DEFAULT_CHUNK_BYTES = 64 * 1024;

const NEWLINE_BYTE = 0x0a;

/** Recording versions this resolver folds, mirroring the replay engine. */
const SUPPORTED_RECORDING_VERSIONS = new Set([1, 2]);

// ---------------------------------------------------------------------------
// Injectable I/O surface
// ---------------------------------------------------------------------------

/** Minimal async file handle the resolver reads through. */
export interface ResolverFileHandle {
  stat(): Promise<{ readonly size: number }>;
  read(
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): Promise<{ readonly bytesRead: number; readonly buffer: Buffer }>;
  close(): Promise<void>;
}

/** Open factory for the resolver's file access; injectable for tests. */
export interface ResolverIo {
  open(path: string, flags: string): Promise<ResolverFileHandle>;
}

export interface JournalResolverOptions {
  /** Read chunk size in bytes. Defaults to 64 KiB; injectable for tests. */
  readonly chunkBytes?: number;
  /** File access surface. Defaults to fs/promises handles. */
  readonly io?: ResolverIo;
}

const defaultResolverIo: ResolverIo = {
  async open(path, flags) {
    const handle = await fs.open(path, flags);
    return {
      stat: async () => ({ size: (await handle.stat()).size }),
      read: (buffer, offset, length, position) =>
        handle.read(buffer, offset, length, position),
      close: () => handle.close(),
    };
  },
};

// ---------------------------------------------------------------------------
// Public result shapes
// ---------------------------------------------------------------------------

/** One decoded survivor row, oldest first across the whole iteration. */
export interface ResolvedEntry {
  /** Envelope seq the row is attributed to (dense for content rows). */
  readonly seq: number;
  /** Byte offset of the record backing the row. */
  readonly offset: number;
  /** Byte length of that record including its terminator. */
  readonly length: number;
  /** Position inside the record; purge records expand to 0..N-1. */
  readonly rowIndex: number;
  readonly content: IContent;
}

/** A maximal run of surviving rows over the envelope seq space. */
export interface SurvivorInterval {
  readonly fromSeq: number;
  readonly toSeq: number;
  /** Byte offset of the record backing the `fromSeq` row. */
  readonly firstOffset: number;
  /**
   * Rows in the interval. Equals the seq span except for purge intervals,
   * which collapse N expanded rows into a single-envelope interval.
   */
  readonly rowCount: number;
}

export interface JournalResolverStats {
  /** Survivor intervals, sorted, disjoint, firstOffsets increasing. */
  readonly intervals: readonly SurvivorInterval[];
  /** Total surviving rows, including purge-expanded rows. */
  readonly resolvedRowCount: number;
  /**
   * Records skipped during the prepass: unparseable mid-file lines plus
   * malformed history-mutating events. A parse failure on the final line is
   * a crash-torn tail and is not counted (engine parity).
   */
  readonly skippedRecordCount: number;
}

/** Test/consumer-facing alias for the stats shape. */
export type ResolverStats = JournalResolverStats;

// ---------------------------------------------------------------------------
// Small guards and probes (engine-parity, no decoded retention)
// ---------------------------------------------------------------------------

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
function chronologySeqOf(content: unknown): number | null {
  const seq = fieldOf(
    fieldOf(fieldOf(content, 'metadata'), 'chronology'),
    'seq',
  );
  return typeof seq === 'number' ? seq : null;
}

function isValidSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Strip the UTF-8 BOM the engine also strips from line 1. */
function envelopeBody(text: string, lineNumber: number): string {
  return lineNumber === 1 && text.startsWith('\uFEFF') ? text.slice(1) : text;
}

// ---------------------------------------------------------------------------
// Chunked line scanning (JournalCursor reading idioms)
// ---------------------------------------------------------------------------

interface ScannedLine {
  readonly offset: number;
  readonly length: number;
  readonly text: string;
}

/**
 * Chunked forward line scanner over a byte range of an open handle. Lines are
 * located with raw byte scans that retain nothing beyond the pending tail and
 * decoded only once complete, so multi-byte UTF-8 splits across chunks
 * survive. A trailing span without a terminator (a crash-torn tail) is never
 * returned. `end` bounds pass-two spans exactly, so a bounded span never pays
 * an extra end-of-file read.
 */
class ChunkedLineScanner {
  private pending: Buffer = Buffer.alloc(0);
  private pendingStart: number;
  private eof = false;

  constructor(
    private readonly handle: ResolverFileHandle,
    private readonly chunkBytes: number,
    start: number,
    private readonly end: number,
  ) {
    this.pendingStart = start;
  }

  async nextLine(): Promise<ScannedLine | null> {
    for (;;) {
      const terminator = this.pending.indexOf(NEWLINE_BYTE);
      if (terminator !== -1) {
        const length = terminator + 1;
        const text = this.pending.subarray(0, length).toString('utf8');
        const offset = this.pendingStart;
        this.pending = this.pending.subarray(length);
        this.pendingStart += length;
        return { offset, length, text };
      }
      if (this.eof || this.pendingStart + this.pending.length >= this.end) {
        return null;
      }
      await this.pump();
    }
  }

  private async pump(): Promise<void> {
    const position = this.pendingStart + this.pending.length;
    const wanted = Math.min(this.chunkBytes, this.end - position);
    const buffer = Buffer.alloc(wanted);
    const { bytesRead } = await this.handle.read(buffer, 0, wanted, position);
    if (bytesRead === 0) {
      this.eof = true;
      return;
    }
    const chunk = bytesRead === wanted ? buffer : buffer.subarray(0, bytesRead);
    this.pending =
      this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
  }
}

// ---------------------------------------------------------------------------
// Survivor bookkeeping
// ---------------------------------------------------------------------------

/** One surviving content or compressed-summary row. */
interface ContentUnit {
  readonly kind: 'content' | 'summary';
  readonly seq: number;
  readonly offset: number;
  readonly length: number;
  readonly lineNumber: number;
  readonly chronSeq: number | null;
}

/**
 * A `semantic_media_purge` survivor. Its rows live inside the record payload
 * and are expanded lazily: `rowCount` is 0 and `chronSeqs` null until the
 * record is decoded (second pass) or a later rewind must fold across it.
 */
interface PurgeUnit {
  readonly kind: 'purge';
  readonly seq: number;
  readonly offset: number;
  readonly length: number;
  readonly lineNumber: number;
  rowCount: number;
  chronSeqs: Array<number | null> | null;
}

type SurvivorUnit = ContentUnit | PurgeUnit;

interface IntervalDraft {
  fromSeq: number;
  toSeq: number;
  firstOffset: number;
  rowCount: number;
}

interface CutPosition {
  readonly unitIndex: number;
  /** Rows the purge unit keeps, or null when the cut unit drops entirely. */
  readonly keepRows: number | null;
}

function parseSurvivorEnvelope(
  text: string,
  lineNumber: number,
): Record<string, unknown> {
  const parsed: unknown = JSON.parse(envelopeBody(text, lineNumber));
  if (!isRecord(parsed)) {
    throw new Error(
      `survivor envelope at line ${lineNumber} no longer parses as a record`,
    );
  }
  return parsed;
}

/** Decode a survivor content/summary row. Prepass validated these bytes. */
function survivorContent(
  parsed: Record<string, unknown>,
  kind: 'content' | 'summary',
): IContent {
  const content = fieldOf(
    fieldOf(parsed, 'payload'),
    kind === 'summary' ? 'summary' : 'content',
  );
  if (!isSpeakerContent(content)) {
    throw new Error(
      `${kind} record no longer matches its prepass validation (file mutated?)`,
    );
  }
  return content;
}

/** Decode a survivor purge record's replacement rows. */
function survivorPurgeRows(
  parsed: Record<string, unknown>,
  offset: number,
): readonly IContent[] {
  const history: unknown = fieldOf(fieldOf(parsed, 'payload'), 'history');
  if (!Array.isArray(history) || !history.every(isSpeakerContent)) {
    throw new Error(
      `purge record at offset ${offset} no longer matches its prepass validation (file mutated?)`,
    );
  }
  return history;
}

/**
 * Batch the byte-contiguous survivor run starting at `startIndex` into one
 * span so each file region is read at most twice overall (events-only
 * prepass + the decode pass).
 */
function nextSpanUnits(
  units: readonly SurvivorUnit[],
  startIndex: number,
): { readonly units: SurvivorUnit[]; readonly endOffset: number } {
  const spanUnits: SurvivorUnit[] = [];
  let spanEnd = units[startIndex].offset;
  let index = startIndex;
  while (index < units.length && units[index].offset === spanEnd) {
    const unit = units[index];
    spanUnits.push(unit);
    spanEnd = unit.offset + unit.length;
    index += 1;
  }
  return { units: spanUnits, endOffset: spanEnd };
}

// ---------------------------------------------------------------------------
// JournalResolver
// ---------------------------------------------------------------------------

export class JournalResolver {
  private readonly units: SurvivorUnit[] = [];
  private skippedRecordCount = 0;
  private handle: ResolverFileHandle | null;
  private prepassDone = false;

  private constructor(
    handle: ResolverFileHandle,
    private readonly chunkBytes: number,
  ) {
    this.handle = handle;
  }

  /** Open the journal read-only; the handle serves both passes. */
  static async open(
    filePath: string,
    options: JournalResolverOptions = {},
  ): Promise<JournalResolver> {
    const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
      throw new RangeError('chunkBytes must be a positive safe integer');
    }
    const io = options.io ?? defaultResolverIo;
    const handle = await io.open(filePath, 'r');
    return new JournalResolver(handle, chunkBytes);
  }

  /**
   * Yield the surviving rows oldest first. The prepass runs lazily on the
   * first pull; each survivor region is then re-read chunked, seeking from
   * interval to interval and skipping removed byte spans entirely.
   */
  async *resolve(): AsyncIterable<ResolvedEntry> {
    if (!this.prepassDone) {
      await this.runPrepass();
    }
    const handle = this.assertOpen();
    let index = 0;
    while (index < this.units.length) {
      const span = nextSpanUnits(this.units, index);
      index += span.units.length;
      yield* this.decodeSpan(handle, span.units, span.endOffset);
    }
  }

  /**
   * Decode one batched byte span of survivor records into rows. Decoded-record
   * references live in function-scope slots and are reset as soon as their
   * rows have been handed off: a suspension (or completion, or consumer
   * abort) of this generator must leave no envelope or row array reachable,
   * only the single yielded content object the consumer already holds.
   * Without the resets, a retained frame slot keeps the whole parsed record
   * alive for as long as the consumer keeps the resolver around.
   */
  private async *decodeSpan(
    handle: ResolverFileHandle,
    spanUnits: readonly SurvivorUnit[],
    spanEnd: number,
  ): AsyncIterable<ResolvedEntry> {
    let scanner: ChunkedLineScanner | null = new ChunkedLineScanner(
      handle,
      this.chunkBytes,
      spanUnits[0].offset,
      spanEnd,
    );
    let line: ScannedLine | null = null;
    let parsed: Record<string, unknown> | null = null;
    let rows: readonly IContent[] | null = null;
    try {
      for (const unit of spanUnits) {
        line = await scanner.nextLine();
        if (line === null) {
          throw new Error(`survivor record missing at offset ${unit.offset}`);
        }
        if (unit.kind !== 'purge') {
          parsed = parseSurvivorEnvelope(line.text, unit.lineNumber);
          const content = survivorContent(parsed, unit.kind);
          const offset = line.offset;
          const length = line.length;
          parsed = null;
          line = null;
          yield { seq: unit.seq, offset, length, rowIndex: 0, content };
          continue;
        }
        parsed = parseSurvivorEnvelope(line.text, unit.lineNumber);
        rows = survivorPurgeRows(parsed, unit.offset);
        parsed = null;
        if (unit.chronSeqs === null) {
          unit.rowCount = rows.length;
          unit.chronSeqs = rows.map(chronologySeqOf);
        }
        const rowCount = unit.rowCount;
        const offset = line.offset;
        const length = line.length;
        line = null;
        // Yield row by row; the decoded array is released once this
        // record's rows have been yielded, so only the numbers above
        // outlive iteration.
        for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
          yield {
            seq: unit.seq,
            offset,
            length,
            rowIndex,
            content: rows[rowIndex],
          };
        }
        rows = null;
      }
    } finally {
      scanner = null;
      line = null;
      parsed = null;
      rows = null;
    }
  }

  /** Folded survivor bookkeeping; exact once iteration has completed. */
  stats(): JournalResolverStats {
    return {
      intervals: this.deriveIntervals(),
      resolvedRowCount: this.units.reduce(
        (total, unit) => total + (unit.kind === 'purge' ? unit.rowCount : 1),
        0,
      ),
      skippedRecordCount: this.skippedRecordCount,
    };
  }

  /** Release the file handle; later reads fail loudly. Idempotent. */
  async close(): Promise<void> {
    const handle = this.handle;
    this.handle = null;
    if (handle === null) return;
    try {
      await handle.close();
    } catch {
      // Closing an already-closed fd must not mask the caller's outcome.
    }
  }

  private assertOpen(): ResolverFileHandle {
    const handle = this.handle;
    if (handle === null) {
      throw new Error('JournalResolver is closed');
    }
    return handle;
  }

  // -------------------------------------------------------------------------
  // Pass one: events-only prepass
  // -------------------------------------------------------------------------

  private async runPrepass(): Promise<void> {
    const handle = this.assertOpen();
    const scanner = new ChunkedLineScanner(
      handle,
      this.chunkBytes,
      0,
      Number.POSITIVE_INFINITY,
    );
    let lineNumber = 0;
    let lastLineUnparseable = false;
    for (;;) {
      const line = await scanner.nextLine();
      if (line === null) break;
      lineNumber += 1;
      lastLineUnparseable = await this.absorbLine(line, lineNumber);
    }
    if (lastLineUnparseable) {
      // Engine parity: a complete final line that fails to parse is a
      // crash-torn tail — silently discarded, not counted.
      this.skippedRecordCount -= 1;
    }
    this.prepassDone = true;
  }

  /**
   * Fold one prepass line into the survivor list. Returns true when the line
   * was complete but unparseable — the engine-parity final-line discard needs
   * to know whether the last line failed to parse.
   */
  private async absorbLine(
    line: ScannedLine,
    lineNumber: number,
  ): Promise<boolean> {
    if (line.text.trim() === '') return false;
    let parsed: unknown;
    try {
      parsed = JSON.parse(envelopeBody(line.text, lineNumber));
    } catch {
      this.skippedRecordCount += 1;
      return true;
    }
    // The engine's parseLine maps a literal `null` line onto the same null it
    // uses for parse failures and skips it without counting.
    if (parsed === null) return false;
    if (!isRecord(parsed)) {
      // The engine reads `.v` off whatever JSON.parse returned, so a scalar
      // or array envelope fails the version gate as `undefined`.
      throw new Error(
        `Unsupported recording version undefined at line ${lineNumber}`,
      );
    }
    const version: unknown = parsed['v'];
    if (
      typeof version !== 'number' ||
      !SUPPORTED_RECORDING_VERSIONS.has(version)
    ) {
      throw new Error(
        `Unsupported recording version ${String(version)} at line ${lineNumber}`,
      );
    }
    const seq: unknown = parsed['seq'];
    if (!isValidSequence(seq)) {
      this.skippedRecordCount += 1;
      return false;
    }
    const payload: unknown = parsed['payload'];
    if (payload === null || typeof payload !== 'object') {
      this.skippedRecordCount += 1;
      return false;
    }
    switch (parsed['type']) {
      case 'content':
        this.foldContent(seq, payload, line, lineNumber);
        break;
      case 'compressed':
        this.foldCompressed(seq, payload, line, lineNumber);
        break;
      case 'rewind':
        await this.foldRewind(payload);
        break;
      case 'semantic_media_purge':
        this.foldSemanticMediaPurge(seq, payload, line, lineNumber);
        break;
      default:
        // Session bookkeeping, metadata events, and unknown types never
        // touch history.
        break;
    }
    return false;
  }

  private foldContent(
    seq: number,
    payload: object,
    line: ScannedLine,
    lineNumber: number,
  ): void {
    const content = fieldOf(payload, 'content');
    if (!isSpeakerContent(content)) {
      this.skippedRecordCount += 1;
      return;
    }
    this.units.push({
      kind: 'content',
      seq,
      offset: line.offset,
      length: line.length,
      lineNumber,
      chronSeq: chronologySeqOf(content),
    });
  }

  private foldCompressed(
    seq: number,
    payload: object,
    line: ScannedLine,
    lineNumber: number,
  ): void {
    const summary = fieldOf(payload, 'summary');
    if (
      !isSpeakerContent(summary) ||
      fieldOf(payload, 'itemsCompressed') === undefined
    ) {
      this.skippedRecordCount += 1;
      return;
    }
    // Whole-history replacement: the summary becomes the sole survivor,
    // attributed to the compressed envelope's own seq.
    this.units.length = 0;
    this.units.push({
      kind: 'summary',
      seq,
      offset: line.offset,
      length: line.length,
      lineNumber,
      chronSeq: chronologySeqOf(summary),
    });
  }

  private foldSemanticMediaPurge(
    seq: number,
    payload: object,
    line: ScannedLine,
    lineNumber: number,
  ): void {
    const history: unknown = fieldOf(payload, 'history');
    const frontier: unknown = fieldOf(payload, 'frontier');
    if (!Array.isArray(history) || !history.every(isSpeakerContent)) {
      this.skippedRecordCount += 1;
      return;
    }
    if (
      !isRecordWithNonNegativeIntegerPair(frontier) ||
      !isSemanticMediaPurgeFrontierWithinHistory(history, frontier)
    ) {
      this.skippedRecordCount += 1;
      return;
    }
    // The replacement rows live inside the payload and are NOT parsed here:
    // the fold records where they start and expands them lazily so prepass
    // memory never scales with the payload's content bytes.
    this.units.length = 0;
    this.units.push({
      kind: 'purge',
      seq,
      offset: line.offset,
      length: line.length,
      lineNumber,
      rowCount: 0,
      chronSeqs: null,
    });
  }

  private async foldRewind(payload: object): Promise<void> {
    const itemsRemoved: unknown = fieldOf(payload, 'itemsRemoved');
    if (typeof itemsRemoved !== 'number' || itemsRemoved < 0) {
      this.skippedRecordCount += 1;
      return;
    }
    const cutSeq: unknown = fieldOf(payload, 'cutSeq');
    if (cutSeq !== undefined && !isValidSequence(cutSeq)) {
      // An unreadable cut marker still rewinds — by count (engine parity).
      this.skippedRecordCount += 1;
      await this.applyCountRewind(itemsRemoved);
      return;
    }
    if (cutSeq !== undefined) {
      const cut = await this.findChronologyCut(cutSeq);
      if (cut !== null) {
        this.truncateAtCut(cut);
        return;
      }
    }
    await this.applyCountRewind(itemsRemoved);
  }

  // -------------------------------------------------------------------------
  // Rewind folding
  // -------------------------------------------------------------------------

  /**
   * Oldest-first scan for the survivor row whose chronology marker equals
   * `cutSeq` — the engine's findChronologyCutIndex over the folded survivor
   * list. First match wins; the cut row itself and every later row are
   * removed. An unexpanded purge survivor is expanded on demand because its
   * rows might carry the marker.
   */
  private async findChronologyCut(cutSeq: number): Promise<CutPosition | null> {
    for (let index = 0; index < this.units.length; index += 1) {
      const unit = this.units[index];
      if (unit.kind !== 'purge') {
        if (unit.chronSeq === cutSeq) {
          return { unitIndex: index, keepRows: null };
        }
        continue;
      }
      await this.expandPurge(unit);
      const markers = unit.chronSeqs ?? [];
      for (let row = 0; row < unit.rowCount; row += 1) {
        if (markers[row] === cutSeq) {
          return { unitIndex: index, keepRows: row };
        }
      }
    }
    return null;
  }

  private truncateAtCut(cut: CutPosition): void {
    if (cut.keepRows === null) {
      this.units.length = cut.unitIndex;
      return;
    }
    const unit = this.units[cut.unitIndex];
    if (unit.kind === 'purge') {
      unit.rowCount = cut.keepRows;
      unit.chronSeqs = (unit.chronSeqs ?? []).slice(0, cut.keepRows);
    }
    this.units.length = cut.unitIndex + 1;
  }

  /**
   * Drop the last `itemsToRemove` survivor rows, splitting a purge survivor
   * at its tail when the count lands inside it (engine applyCountRewind
   * parity, measured over expanded rows rather than raw units).
   */
  private async applyCountRewind(itemsToRemove: number): Promise<void> {
    let remaining = itemsToRemove;
    let keep = this.units.length;
    let splitApplied = false;
    while (remaining > 0 && keep > 0 && !splitApplied) {
      const unit = this.units[keep - 1];
      if (unit.kind !== 'purge') {
        keep -= 1;
        remaining -= 1;
        continue;
      }
      await this.expandPurge(unit);
      if (remaining < unit.rowCount) {
        unit.rowCount -= remaining;
        unit.chronSeqs = (unit.chronSeqs ?? []).slice(0, unit.rowCount);
        splitApplied = true;
      } else {
        remaining -= unit.rowCount;
        keep -= 1;
      }
    }
    this.units.length = keep;
  }

  /**
   * Fill in a purge survivor's row count and per-row chronology markers by
   * reading and parsing its record once. The parsed history array is dropped
   * on return — only the numbers survive. This is the only path that parses
   * a purge payload outside the second pass, and it runs solely when a later
   * rewind must fold across purge rows.
   */
  private async expandPurge(unit: PurgeUnit): Promise<void> {
    if (unit.chronSeqs !== null) return;
    const rows = await this.decodePurgeUnit(unit);
    unit.rowCount = rows.length;
    unit.chronSeqs = rows.map(chronologySeqOf);
  }

  /** Read one purge record's bytes and decode its replacement rows. */
  private async decodePurgeUnit(unit: PurgeUnit): Promise<readonly IContent[]> {
    const handle = this.assertOpen();
    const scanner = new ChunkedLineScanner(
      handle,
      this.chunkBytes,
      unit.offset,
      unit.offset + unit.length,
    );
    const line = await scanner.nextLine();
    if (line === null) {
      throw new Error(`purge record missing at offset ${unit.offset}`);
    }
    return survivorPurgeRows(
      parseSurvivorEnvelope(line.text, unit.lineNumber),
      unit.offset,
    );
  }

  // -------------------------------------------------------------------------
  // Stats derivation
  // -------------------------------------------------------------------------

  /**
   * Survivor intervals: plain rows merge while their envelope seqs are
   * contiguous; a purge survivor always forms its own single-envelope
   * interval carrying its expanded row count.
   */
  private deriveIntervals(): SurvivorInterval[] {
    const intervals: SurvivorInterval[] = [];
    let current: IntervalDraft | null = null;
    for (const unit of this.units) {
      if (unit.kind === 'purge') {
        current = null;
        intervals.push({
          fromSeq: unit.seq,
          toSeq: unit.seq,
          firstOffset: unit.offset,
          rowCount: unit.rowCount,
        });
        continue;
      }
      if (current !== null && unit.seq === current.toSeq + 1) {
        current.toSeq = unit.seq;
        current.rowCount += 1;
      } else {
        current = {
          fromSeq: unit.seq,
          toSeq: unit.seq,
          firstOffset: unit.offset,
          rowCount: 1,
        };
        intervals.push(current);
      }
    }
    return intervals;
  }
}
