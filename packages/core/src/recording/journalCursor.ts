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
 * @plan PLAN-20260917-ISSUE854.P02
 * @requirement G2
 *
 * JournalCursor: a chunked, offset-addressed, strictly read-only reader over
 * the append-only session journal (`session-*.jsonl`). Behavior spec:
 * issue-854-design.md §2; requirement G2 per implementation-plan.md §10.
 *
 * The cursor holds two byte-offset read heads. `pageBack(n)` consumes lines
 * ending at the backward head (newest first); `pageForward(n)` consumes lines
 * starting at the forward head (oldest first, picking up appends after the
 * cursor was opened). The file is never written, repaired, or locked; a torn
 * tail from a crash mid-append is ignored on every paging call.
 *
 * Memory is bounded by construction: lines are located with raw byte scans
 * that retain nothing, decoded with a streaming StringDecoder only after
 * their length is known to be within MAX_RECORD_BYTES, and released as soon
 * as each page is handed to the caller. Nothing scales with session length.
 */

import * as fs from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import type { IContent } from '../services/history/IContent.js';
import type { SessionEventType, SessionRecordLine } from './types.js';

/** Default read chunk size; overridable per cursor for tests. */
const DEFAULT_CHUNK_BYTES = 64 * 1024;

/**
 * Assembly bound for a single journal line. A line whose assembled byte
 * length (including its terminator) exceeds this cap is skipped with an
 * oversized diagnostic — its offset and length are retained, its content is
 * never decoded, and paging continues.
 */
export const MAX_RECORD_BYTES = 16 * 1024 * 1024;

/**
 * How many extra lines a page may consume past its entry budget to finish an
 * in-flight tool group, keeping group pairs atomic across page boundaries.
 */
const GROUP_RESOLVE_LINE_LIMIT = 128;

const NEWLINE_BYTE = 0x0a;

const SESSION_EVENT_TYPES: ReadonlySet<string> = new Set<SessionEventType>([
  'session_start',
  'content',
  'compressed',
  'rewind',
  'provider_switch',
  'session_event',
  'session_metadata',
  'directories_changed',
  'checkpoint_created',
  'checkpoint_renamed',
  'checkpoint_deleted',
  'session_forked',
  'session_named',
  'semantic_media_purge',
]);

export interface JournalCursorOptions {
  /** Read chunk size in bytes. Defaults to 64 KiB; injectable for tests. */
  readonly chunkBytes?: number;
}

/** One consumed journal line, retained by byte offset regardless of kind. */
export interface JournalEnvelopeRef {
  readonly offset: number;
  /** Byte length including the line terminator. */
  readonly length: number;
  readonly seq: number | null;
  /** Envelope type, or null when the line did not parse as an envelope. */
  readonly type: SessionEventType | null;
}

export type JournalEntry =
  | {
      readonly kind: 'content';
      readonly offset: number;
      readonly length: number;
      readonly seq: number;
      readonly content: IContent;
    }
  | {
      readonly kind: 'group';
      /** Byte offset of the anchor line (the call when present). */
      readonly offset: number;
      /** Byte span from the anchor line start to the last line's end. */
      readonly length: number;
      readonly seqSpan: readonly [number, number];
      readonly call: IContent | null;
      readonly response: IContent | null;
      readonly responseOffset: number | null;
    }
  | {
      readonly kind: 'boundary';
      readonly offset: number;
      readonly length: number;
      readonly seq: number;
      readonly envelope: SessionRecordLine;
    }
  | {
      readonly kind: 'oversized';
      readonly offset: number;
      readonly length: number;
    };

export interface JournalPage {
  /**
   * Rows for the pager. `pageBack` returns them newest first, `pageForward`
   * oldest first. Tool groups are atomic; non-content envelopes are absent.
   */
  readonly entries: readonly JournalEntry[];
  /** Every line consumed by this call, in ascending byte order. */
  readonly envelopes: readonly JournalEnvelopeRef[];
  readonly windowStart: number;
  readonly windowEnd: number;
}

export interface JournalCursorMetrics {
  /** High-water bytes held while assembling a single record. */
  readonly maxAssembledRecordBytes: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSessionRecordLine(value: unknown): value is SessionRecordLine {
  if (!isRecord(value)) return false;
  if (typeof value['v'] !== 'number') return false;
  if (typeof value['seq'] !== 'number') return false;
  if (typeof value['ts'] !== 'string') return false;
  const type = value['type'];
  if (typeof type !== 'string' || !SESSION_EVENT_TYPES.has(type)) return false;
  return 'payload' in value;
}

function isIContent(value: unknown): value is IContent {
  if (!isRecord(value)) return false;
  const speaker = value['speaker'];
  if (speaker !== 'human' && speaker !== 'ai' && speaker !== 'tool') {
    return false;
  }
  return Array.isArray(value['blocks']);
}

function parseEnvelope(json: string): SessionRecordLine | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  return isSessionRecordLine(parsed) ? parsed : null;
}

function extractContent(payload: unknown): IContent | null {
  if (!isRecord(payload)) return null;
  const content = payload['content'];
  return isIContent(content) ? content : null;
}

function stripLineTerminator(text: string): string {
  let out = text;
  if (out.endsWith('\n')) out = out.slice(0, -1);
  if (out.endsWith('\r')) out = out.slice(0, -1);
  return out;
}

function toolCallIdSet(content: IContent): Set<string> {
  const ids = new Set<string>();
  for (const block of content.blocks) {
    if (block.type === 'tool_call') {
      ids.add(block.id);
    } else if (block.type === 'tool_response') {
      ids.add(block.callId);
    }
  }
  return ids;
}

function hasToolCallBlocks(content: IContent): boolean {
  return content.blocks.some((block) => block.type === 'tool_call');
}

function setsIntersect(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): boolean {
  for (const id of a) {
    if (b.has(id)) return true;
  }
  return false;
}

function assertPageCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new RangeError('page count must be a non-negative safe integer');
  }
}

interface JournalSide {
  readonly offset: number;
  readonly lineEnd: number;
  readonly seq: number;
  readonly side: 'call' | 'response';
  readonly content: IContent;
  readonly ids: ReadonlySet<string>;
}

/**
 * Direction-agnostic page state machine: rows accumulate against the entry
 * budget while a one-sided group anchor waits for its companion later in
 * walk order. Matching is by callId set intersection, never by adjacency.
 */
class PageWalk {
  readonly entries: JournalEntry[] = [];
  readonly envelopes: JournalEnvelopeRef[] = [];

  private pending: JournalSide | null = null;
  private resolveLines = 0;

  constructor(private readonly budget: number) {}

  get hasPending(): boolean {
    return this.pending !== null;
  }

  budgetMet(): boolean {
    return this.entries.length >= this.budget;
  }

  canResolveMore(): boolean {
    return this.resolveLines < GROUP_RESOLVE_LINE_LIMIT;
  }

  noteResolutionLine(): void {
    this.resolveLines += 1;
  }

  addEnvelope(ref: JournalEnvelopeRef): void {
    this.envelopes.push(ref);
  }

  addOversized(offset: number, length: number): void {
    this.entries.push({ kind: 'oversized', offset, length });
  }

  addBoundary(
    offset: number,
    length: number,
    envelope: SessionRecordLine,
  ): void {
    this.entries.push({
      kind: 'boundary',
      offset,
      length,
      seq: envelope.seq,
      envelope,
    });
  }

  onContent(
    offset: number,
    lineEnd: number,
    envelope: SessionRecordLine,
    content: IContent | null,
  ): void {
    if (content === null) return;
    const ids = toolCallIdSet(content);
    const side: JournalSide = {
      offset,
      lineEnd,
      seq: envelope.seq,
      side: hasToolCallBlocks(content) ? 'call' : 'response',
      content,
      ids,
    };
    const waiting = this.pending;
    this.pending = null;
    if (waiting !== null) {
      if (setsIntersect(waiting.ids, ids)) {
        this.pushGroup(waiting, side);
        return;
      }
      this.pushGroup(waiting, null);
    }
    if (ids.size === 0) {
      this.entries.push({
        kind: 'content',
        offset,
        length: lineEnd - offset,
        seq: envelope.seq,
        content,
      });
      return;
    }
    this.pending = side;
  }

  flush(): void {
    const waiting = this.pending;
    this.pending = null;
    if (waiting !== null) {
      this.pushGroup(waiting, null);
    }
  }

  private pushGroup(first: JournalSide, second: JournalSide | null): void {
    const sides = second === null ? [first] : [first, second];
    const call = sides.find((side) => side.side === 'call');
    const response = sides.find((side) => side.side === 'response');
    const start = Math.min(...sides.map((side) => side.offset));
    const end = Math.max(...sides.map((side) => side.lineEnd));
    const seqs = sides.map((side) => side.seq);
    this.entries.push({
      kind: 'group',
      offset: start,
      length: end - start,
      seqSpan: [Math.min(...seqs), Math.max(...seqs)],
      call: call === undefined ? null : call.content,
      response: response === undefined ? null : response.content,
      responseOffset: response === undefined ? null : response.offset,
    });
  }
}

export class JournalCursor {
  private handle: fs.FileHandle | null;
  private readonly chunkBytes: number;
  private fileSize = 0;
  private dataStart = 0;
  private bomResolved = false;
  private lineEndLimit = 0;
  private winStart = Number.MAX_SAFE_INTEGER;
  private winEnd = Number.MAX_SAFE_INTEGER;
  private maxAssembledRecordBytes = 0;

  private constructor(fileHandle: fs.FileHandle, chunkBytes: number) {
    this.handle = fileHandle;
    this.chunkBytes = chunkBytes;
  }

  /** Open the journal read-only; the heads start at the file's bottom. */
  static async open(
    filePath: string,
    options: JournalCursorOptions = {},
  ): Promise<JournalCursor> {
    const chunkBytes = options.chunkBytes ?? DEFAULT_CHUNK_BYTES;
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) {
      throw new RangeError('chunkBytes must be a positive safe integer');
    }
    const fileHandle = await fs.open(filePath, 'r');
    const cursor = new JournalCursor(fileHandle, chunkBytes);
    try {
      await cursor.refresh();
    } catch (error: unknown) {
      await cursor.close();
      throw error;
    }
    return cursor;
  }

  /**
   * Consume up to `count` entries ending at the backward head, newest first.
   * The head always stops on a line boundary; a torn tail is never consumed.
   */
  async pageBack(count: number): Promise<JournalPage> {
    this.assertOpen();
    assertPageCount(count);
    await this.refresh();
    if (count === 0) return this.emptyPage();
    const walk = new PageWalk(count);
    let end = this.winStart;
    while (end > this.dataStart) {
      if (walk.budgetMet() && (!walk.hasPending || !walk.canResolveMore())) {
        break;
      }
      const start = await this.findLineStartBefore(end);
      await this.consumeLine(walk, start, end);
      if (walk.budgetMet()) walk.noteResolutionLine();
      end = start;
    }
    walk.flush();
    this.winStart = end;
    return {
      entries: walk.entries,
      envelopes: walk.envelopes.slice().reverse(),
      windowStart: this.winStart,
      windowEnd: this.winEnd,
    };
  }

  /**
   * Consume up to `count` entries starting at the forward head, oldest
   * first. Appends that landed after the cursor was opened become visible
   * here; repeated calls at the end of the file yield empty, stable pages.
   */
  async pageForward(count: number): Promise<JournalPage> {
    this.assertOpen();
    assertPageCount(count);
    await this.refresh();
    if (count === 0) return this.emptyPage();
    const walk = new PageWalk(count);
    let pos = this.winEnd;
    while (pos < this.lineEndLimit) {
      // A null end covers both "no complete line ahead" and "entry budget
      // exhausted" (groups may still resolve past the budget while pending).
      const end =
        walk.budgetMet() && (!walk.hasPending || !walk.canResolveMore())
          ? null
          : await this.findNextLineEnd(pos);
      if (end === null) break;
      await this.consumeLine(walk, pos, end);
      if (walk.budgetMet()) walk.noteResolutionLine();
      pos = end;
    }
    walk.flush();
    this.winEnd = pos;
    return {
      entries: walk.entries,
      envelopes: walk.envelopes,
      windowStart: this.winStart,
      windowEnd: this.winEnd,
    };
  }

  /** Raw byte length of the journal at the last paging call or open. */
  size(): number {
    this.assertOpen();
    return this.fileSize;
  }

  windowStart(): number {
    this.assertOpen();
    return this.winStart;
  }

  windowEnd(): number {
    this.assertOpen();
    return this.winEnd;
  }

  metrics(): JournalCursorMetrics {
    this.assertOpen();
    return { maxAssembledRecordBytes: this.maxAssembledRecordBytes };
  }

  /** Release the file handle; later paging calls fail loudly. */
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

  private assertOpen(): fs.FileHandle {
    const handle = this.handle;
    if (handle === null) {
      throw new Error('JournalCursor is closed');
    }
    return handle;
  }

  private async refresh(): Promise<void> {
    const handle = this.assertOpen();
    const stats = await handle.stat();
    this.fileSize = stats.size;
    if (!this.bomResolved) {
      this.dataStart = await this.detectBomStart();
      this.bomResolved = true;
    }
    this.lineEndLimit = await this.computeLineEndLimit();
    if (this.winStart > this.lineEndLimit) this.winStart = this.lineEndLimit;
    if (this.winEnd > this.lineEndLimit) this.winEnd = this.lineEndLimit;
  }

  private async detectBomStart(): Promise<number> {
    if (this.fileSize < 3) return 0;
    const buf = await this.readChunk(0, 3);
    const isBom =
      buf.length === 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
    return isBom ? 3 : 0;
  }

  /**
   * Byte offset just past the last newline — the boundary no paging call may
   * cross. Bytes beyond it are a crash-torn tail and stay invisible. The scan
   * walks backward one chunk at a time because a torn tail can exceed one
   * chunk (a crash mid-append of a large record) while the last complete
   * line's terminator sits just before it.
   */
  private async computeLineEndLimit(): Promise<number> {
    let chunkEnd = this.fileSize;
    while (chunkEnd > this.dataStart) {
      const length = Math.min(this.chunkBytes, chunkEnd - this.dataStart);
      const start = chunkEnd - length;
      const buf = await this.readChunk(start, length);
      for (let i = buf.length - 1; i >= 0; i -= 1) {
        if (buf[i] === NEWLINE_BYTE) return start + i + 1;
      }
      chunkEnd = start;
    }
    return this.dataStart;
  }

  /**
   * Start offset of the line ending at `end`. Raw byte walk that retains
   * nothing: the first chunk skips the line's own terminator, and a hit in
   * any later chunk means the line begins exactly at that chunk boundary.
   */
  private async findLineStartBefore(end: number): Promise<number> {
    let chunkEnd = end;
    let skipOwnTerminator = true;
    while (chunkEnd > this.dataStart) {
      const length = Math.min(this.chunkBytes, chunkEnd - this.dataStart);
      const start = chunkEnd - length;
      const buf = await this.readChunk(start, length);
      const last = skipOwnTerminator ? buf.length - 2 : buf.length - 1;
      for (let i = last; i >= 0; i -= 1) {
        if (buf[i] === NEWLINE_BYTE) return start + i + 1;
      }
      skipOwnTerminator = false;
      chunkEnd = start;
    }
    return this.dataStart;
  }

  /** End offset (past the newline) of the line starting at `pos`. */
  private async findNextLineEnd(pos: number): Promise<number | null> {
    let start = pos;
    while (start < this.lineEndLimit) {
      const length = Math.min(this.chunkBytes, this.lineEndLimit - start);
      const buf = await this.readChunk(start, length);
      const idx = buf.indexOf(NEWLINE_BYTE);
      if (idx !== -1) return start + idx + 1;
      start += buf.length;
    }
    return null;
  }

  private async readChunk(start: number, length: number): Promise<Buffer> {
    const handle = this.assertOpen();
    const buf = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buf, 0, length, start);
    return buf.subarray(0, bytesRead);
  }

  /** Decode [start, end) forward so multi-byte UTF-8 splits survive. */
  private async decodeRange(start: number, end: number): Promise<string> {
    const decoder = new StringDecoder('utf-8');
    let text = '';
    let pos = start;
    while (pos < end) {
      const length = Math.min(this.chunkBytes, end - pos);
      const buf = await this.readChunk(pos, length);
      if (buf.length === 0) break;
      text += decoder.write(buf);
      pos += buf.length;
    }
    text += decoder.end();
    return text;
  }

  /**
   * Consume one line into the page: oversized lines are diagnosed without
   * decoding, non-content envelopes are recorded by offset only, content
   * feeds the group state machine, and compressed/rewind events surface as
   * boundary rows.
   */
  private async consumeLine(
    walk: PageWalk,
    start: number,
    end: number,
  ): Promise<void> {
    const length = end - start;
    if (length > MAX_RECORD_BYTES) {
      walk.addEnvelope({ offset: start, length, seq: null, type: null });
      walk.addOversized(start, length);
      return;
    }
    if (length > this.maxAssembledRecordBytes) {
      this.maxAssembledRecordBytes = length;
    }
    const text = await this.decodeRange(start, end);
    const envelope = parseEnvelope(stripLineTerminator(text));
    if (envelope === null) {
      walk.addEnvelope({ offset: start, length, seq: null, type: null });
      return;
    }
    walk.addEnvelope({
      offset: start,
      length,
      seq: envelope.seq,
      type: envelope.type,
    });
    if (envelope.type === 'content') {
      walk.onContent(start, end, envelope, extractContent(envelope.payload));
      return;
    }
    if (envelope.type === 'compressed' || envelope.type === 'rewind') {
      walk.addBoundary(start, length, envelope);
    }
  }

  private emptyPage(): JournalPage {
    return {
      entries: [],
      envelopes: [],
      windowStart: this.winStart,
      windowEnd: this.winEnd,
    };
  }
}
