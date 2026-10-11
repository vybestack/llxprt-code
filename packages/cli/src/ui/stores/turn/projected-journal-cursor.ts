/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open, stat, type FileHandle } from 'node:fs/promises';
import type {
  IContent,
  JournalReadCounters,
} from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../types.js';
import { rowIdentity, rowIdentityKey } from '../../utils/rowIdentity.js';
import { HistoryProjection } from '../../utils/historyProjection.js';
import {
  frameRecords,
  openFileChunks,
  type FramingMetrics,
  type FramingSource,
  type OversizedLine,
  type RecordLine,
} from './projected-journal-records.js';
import {
  JournalPageFile,
  type DisplayJournalEntry,
} from './journal-page-file.js';

export interface ProjectedJournalOptions {
  readonly chunkBytes?: number;
  readonly counters?: JournalReadCounters;
  readonly signal?: AbortSignal;
  readonly temporaryRoot?: string;
  readonly read?: (path: string, signal: AbortSignal) => AsyncIterable<string>;
  readonly readBounded?: (
    path: string,
    signal: AbortSignal,
    endExclusive: number,
  ) => AsyncIterable<string>;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
function isContent(value: unknown): value is IContent {
  return (
    isRecord(value) &&
    ['human', 'ai', 'tool'].includes(String(value.speaker)) &&
    Array.isArray(value.blocks)
  );
}
async function readBlock(
  file: FileHandle,
  buffer: Buffer,
  start: number,
  length: number,
): Promise<void> {
  let filled = 0;
  while (filled < length) {
    const { bytesRead } = await file.read(
      buffer,
      filled,
      length - filled,
      start + filled,
    );
    if (bytesRead === 0)
      throw new Error('Truncated journal while locating complete prefix');
    filled += bytesRead;
  }
}

async function completePrefix(
  filePath: string,
  signal: AbortSignal | undefined,
): Promise<{ fileBytes: number; endExclusive: number }> {
  const file = await open(filePath, 'r');
  try {
    const fileBytes = (await file.stat()).size;
    const buffer = Buffer.alloc(65_536);
    let end = fileBytes;
    while (end > 0) {
      signal?.throwIfAborted();
      const start = Math.max(0, end - buffer.length);
      const length = end - start;
      await readBlock(file, buffer, start, length);
      const newline = buffer.lastIndexOf(10, length - 1);
      if (newline !== -1)
        return { fileBytes, endExclusive: start + newline + 1 };
      end = start;
    }
    return { fileBytes, endExclusive: 0 };
  } finally {
    await file.close();
  }
}
function framingSource(
  filePath: string,
  options: ProjectedJournalOptions,
  from: number,
  endExclusive: number | null,
): FramingSource {
  const signal = options.signal ?? new AbortController().signal;
  if (options.read)
    return {
      chunks: options.read(filePath, signal),
      startOffset: from,
      endExclusive: null,
      skipBytes: from,
      signal,
    };
  if (endExclusive === null)
    throw new Error('A bounded journal read needs a complete-prefix end');
  if (options.readBounded)
    return {
      chunks:
        endExclusive === 0
          ? emptyChunks()
          : options.readBounded(filePath, signal, endExclusive),
      startOffset: from,
      endExclusive,
      skipBytes: from,
      signal,
    };
  return {
    chunks: openFileChunks(
      filePath,
      options.chunkBytes ?? 65536,
      from,
      endExclusive,
      signal,
    ),
    startOffset: from,
    endExclusive,
    skipBytes: 0,
    signal,
  };
}
async function* emptyChunks(): AsyncIterable<string> {
  // An empty complete prefix has nothing to read.
}

function entryKey(entry: DisplayJournalEntry): string | undefined {
  const identity =
    entry.kind === 'projected'
      ? entry.item.rowIdentity
      : rowIdentity({ kind: 'journal', offset: entry.offset }, 'summaryRow');
  return identity ? rowIdentityKey(identity) : undefined;
}

export class ProjectedJournalCursor {
  private readonly pages: JournalPageFile;
  private readonly controller = new AbortController();
  private start = 0;
  private end = 0;
  private fileBytes = 0;
  private completeBytes = 0;
  private observedCompleteBytes = 0;
  private seq = 0;
  private retainedPage: HistoryItem[] = [];
  private readSettled: Promise<void> = Promise.resolve();
  private readonly framing: FramingMetrics = {
    maxAssembledBytes: 0,
    completeThrough: 0,
  };
  private oversizedRecords = 0;
  private oversizedThrough = 0;
  /** Journal rows accepted into the group that is still open. */
  private groupRows = 0;
  private clearOffset: number | null = null;
  /** Byte offset of the newest record that opened a not-yet-closed group. */
  private groupOffset: number | null = null;
  /**
   * The projected final group, re-read from its opener on the next extension
   * because later appends can add responses to it. Bounded by one group.
   */
  private tailGroup: { offset: number; pageStart: number } | null = null;
  /** Lowest page index invalidated by the current extension. */
  private lowWater = 0;
  /** Resident page ordinals by row key; bounded by the window. */
  private readonly ordinals = new Map<string, number>();
  private readonly options: ProjectedJournalOptions;

  private constructor(
    private readonly filePath: string,
    options: ProjectedJournalOptions,
  ) {
    this.options = {
      ...options,
      signal: options.signal
        ? AbortSignal.any([options.signal, this.controller.signal])
        : this.controller.signal,
    };
    this.pages = new JournalPageFile(options.temporaryRoot);
  }

  static async open(
    filePath: string,
    options: ProjectedJournalOptions = {},
  ): Promise<ProjectedJournalCursor> {
    const cursor = new ProjectedJournalCursor(filePath, options);
    try {
      await cursor.extend();
      cursor.start = cursor.pages.length;
      cursor.end = cursor.pages.length;
      return cursor;
    } catch (error) {
      await cursor.close();
      throw error;
    }
  }

  private append(items: Iterable<HistoryItem>, end: number): void {
    let rows = this.groupRows;
    for (const item of items) {
      this.options.signal?.throwIfAborted();
      const identity = item.rowIdentity;
      if (identity?.kind !== 'journal')
        throw new Error('Missing journal projection provenance');
      const seq =
        item.type === 'tool_group' ? item.seqSpan?.[1] : item.chronologySeq;
      this.pages.push({
        kind: 'projected',
        offset: identity.offset,
        length: end - identity.offset,
        seq: seq ?? this.seq,
        rows,
        item,
      });
      rows = 0;
    }
  }

  private acceptRecord(
    projection: HistoryProjection,
    record: RecordLine,
    previousEnd: number,
  ): void {
    this.options.counters?.recordDecoded();
    const content = record.payload.content;
    if (record.type === 'content' && isContent(content)) {
      this.options.counters?.rowDecoded();
      try {
        this.append(
          projection.accept(content, {
            kind: 'journal',
            offset: record.offset,
          }),
          previousEnd,
        );
      } finally {
        this.options.counters?.rowReleased();
      }
      this.groupRows = content.speaker === 'tool' ? this.groupRows + 1 : 1;
      if (content.speaker !== 'tool') {
        this.groupOffset = record.offset;
        this.seq = record.seq;
      }
    } else if (record.type === 'rewind') {
      this.closeGroup(projection, previousEnd);
      this.applyRewind(record);
    } else if (record.type === 'compressed') {
      this.closeGroup(projection, previousEnd);
      this.pages.push({
        kind: 'boundary',
        offset: record.offset,
        length: record.length,
        seq: record.seq,
        envelope: {
          v: 1,
          seq: record.seq,
          ts: '',
          type: record.type,
          payload: record.payload,
        },
      });
    }
  }

  private closeGroup(projection: HistoryProjection, end: number): void {
    this.append(projection.flush(), end);
    this.groupRows = 0;
    this.groupOffset = null;
  }

  /**
   * Applies a rewind's membership to the projected transcript: pages for the
   * removed suffix are dropped, the surviving prefix stays pageable. A cut
   * that leaves nothing is a full clear and is remembered as the floor.
   */
  private applyRewind(record: RecordLine): void {
    const cut = this.rewindCut(record.payload);
    this.pages.truncate(cut);
    this.lowWater = Math.min(this.lowWater, cut);
    if (cut === 0) this.clearOffset = record.offset;
  }

  /**
   * First page index the rewind removes. cutSeq names the first removed
   * chronology marker; without a usable one the count of removed journal rows
   * decides, as in replay. A rewind with no readable count cannot be
   * placed and is treated as a full clear.
   */
  private rewindCut(payload: Record<string, unknown>): number {
    const count = payload.itemsRemoved;
    if (typeof count !== 'number' || !(count >= 0)) return 0;
    const cutSeq = payload.cutSeq;
    if (Number.isSafeInteger(cutSeq) && (cutSeq as number) >= 0) {
      const cut = this.firstPageFromSeq(cutSeq as number);
      if (cut < this.pages.length) return cut;
    }
    return this.firstPageByCount(Math.ceil(count));
  }

  private firstPageFromSeq(cutSeq: number): number {
    let index = this.pages.length;
    while (index > 0 && !this.survivesCut(this.pages.get(index - 1), cutSeq))
      index -= 1;
    return index;
  }

  /** Compression summaries and rows before the cut marker stay. */
  private survivesCut(entry: DisplayJournalEntry, cutSeq: number): boolean {
    return (
      entry.kind === 'boundary' || (entry.seq !== null && entry.seq < cutSeq)
    );
  }

  private firstPageByCount(count: number): number {
    let index = this.pages.length;
    let remaining = count;
    while (index > 0 && remaining > 0) {
      const entry = this.pages.get(index - 1);
      if (entry.kind === 'boundary') break;
      remaining -= entry.rows;
      index -= 1;
    }
    return index;
  }

  /** Start of the newest full clear, or null when none cut the whole transcript. */
  clearBoundaryOffset(): number | null {
    return this.clearOffset;
  }

  /** Offset of the oldest surviving display row, or null when none survive. */
  firstDisplayOffset(): number | null {
    return this.pages.length === 0 ? null : this.pages.get(0).offset;
  }

  /** Oversized lines are diagnosed by offset and length and never displayed. */
  private noteOversized(line: OversizedLine, from: number): void {
    if (line.offset >= from && line.offset >= this.oversizedThrough) {
      this.oversizedRecords += 1;
      this.oversizedThrough = line.offset + line.length;
    }
  }

  metrics(): {
    maxAssembledRecordBytes: number;
    oversizedRecords: number;
    pageReads: number;
    pageWrites: number;
  } {
    const { reads, writes } = this.pages.stats();
    return {
      maxAssembledRecordBytes: this.framing.maxAssembledBytes,
      oversizedRecords: this.oversizedRecords,
      pageReads: reads,
      pageWrites: writes,
    };
  }

  private extend(): Promise<void> {
    const run = this.extendPages();
    this.readSettled = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Extends the projection from the pinned complete-tail offset: only bytes
   * appended since the last extension are read, plus the final group, which
   * is re-projected from its opener because responses may have joined it.
   */
  private async extendPages(): Promise<void> {
    this.options.signal?.throwIfAborted();
    const snapshot: { fileBytes: number; endExclusive: number | null } = this
      .options.read
      ? { fileBytes: (await stat(this.filePath)).size, endExclusive: null }
      : await completePrefix(this.filePath, this.options.signal);
    this.fileBytes = snapshot.fileBytes;
    if (snapshot.endExclusive === this.completeBytes) {
      this.observedCompleteBytes = this.completeBytes;
      return;
    }
    this.lowWater = this.pages.length;
    try {
      await this.projectFrom(this.resumePoint(), snapshot.endExclusive);
    } catch (error) {
      this.discardProjection();
      throw error;
    }
    this.start = Math.min(this.start, this.pages.length);
    this.end = Math.min(this.end, Math.max(this.start, this.lowWater));
  }

  private tailPage(): DisplayJournalEntry {
    return this.pages.get(this.pages.length - 1);
  }

  private resumePoint(): number {
    const group = this.tailGroup;
    this.tailGroup = null;
    if (!group) return this.completeBytes;
    // Only a tool group can grow when the file does; any other re-projected
    // tail row is identical to the one already served and must not be
    // handed out again.
    const tail = this.pages.length > group.pageStart ? this.tailPage() : null;
    const grows = tail?.kind === 'projected' && tail.item.type === 'tool_group';
    const served = this.pages.length;
    this.pages.truncate(group.pageStart);
    this.lowWater = grows ? group.pageStart : served;
    return group.offset;
  }

  private async projectFrom(
    from: number,
    endExclusive: number | null,
  ): Promise<void> {
    this.framing.completeThrough = from;
    this.groupOffset = null;
    this.groupRows = 0;
    const projection = new HistoryProjection(
      undefined,
      this.options.counters?.ownership,
      this.options.temporaryRoot,
      this.options.signal,
    );
    let previousEnd = from;
    try {
      const framed = frameRecords(
        framingSource(this.filePath, this.options, from, endExclusive),
        this.framing,
      );
      for await (const record of framed) {
        if (record.kind === 'record')
          this.acceptRecord(projection, record, previousEnd);
        else this.noteOversized(record, from);
        previousEnd = record.offset + record.length;
      }
      this.options.signal?.throwIfAborted();
      const pageStart = this.pages.length;
      this.append(projection.flush(), previousEnd);
      this.tailGroup = this.openGroup(pageStart);
      this.completeBytes = this.framing.completeThrough;
      this.observedCompleteBytes = this.completeBytes;
    } finally {
      projection.close();
    }
  }

  private openGroup(
    pageStart: number,
  ): { offset: number; pageStart: number } | null {
    const offset = this.groupOffset;
    return offset === null ? null : { offset, pageStart };
  }

  /** A failed extension leaves no half-applied state: the next one rebuilds. */
  private discardProjection(): void {
    this.pages.clear();
    this.ordinals.clear();
    this.tailGroup = null;
    this.clearOffset = null;
    this.completeBytes = 0;
    this.observedCompleteBytes = 0;
    this.start = 0;
    this.end = 0;
  }

  async refreshFileEnd(): Promise<void> {
    this.options.signal?.throwIfAborted();
    if ((await stat(this.filePath)).size !== this.fileBytes) {
      const { endExclusive } = await completePrefix(
        this.filePath,
        this.options.signal,
      );
      this.observedCompleteBytes = endExclusive;
    }
  }

  private releasePage(): void {
    for (const item of this.retainedPage)
      this.options.counters?.ownership?.release(item);
    this.retainedPage = [];
  }

  private readPageEntry(index: number): DisplayJournalEntry {
    const entry = this.pages.get(index);
    const key = entryKey(entry);
    if (key !== undefined) this.ordinals.set(key, index);
    if (entry.kind === 'projected') {
      this.options.counters?.ownership?.retain(entry.item);
      this.retainedPage.push(entry.item);
    }
    return entry;
  }

  async pageBack(count: number): Promise<{ entries: DisplayJournalEntry[] }> {
    this.releasePage();
    this.options.signal?.throwIfAborted();
    return this.readPage(count, true);
  }

  async pageForward(
    count: number,
  ): Promise<{ entries: DisplayJournalEntry[] }> {
    this.releasePage();
    this.options.signal?.throwIfAborted();
    if ((await stat(this.filePath)).size !== this.fileBytes)
      await this.extend();
    return this.readPage(count, false);
  }

  private readPage(
    count: number,
    reverse: boolean,
  ): { entries: DisplayJournalEntry[] } {
    const entries: DisplayJournalEntry[] = [];
    let position = reverse ? this.start : this.end;
    try {
      while (
        entries.length < count &&
        (reverse ? position > 0 : position < this.pages.length)
      ) {
        entries.push(this.readPageEntry(reverse ? position - 1 : position));
        position += reverse ? -1 : 1;
      }
    } catch (error) {
      this.releasePage();
      throw error;
    }
    if (reverse) this.start = position;
    else this.end = position;
    return { entries };
  }

  retainWindow(
    first: string | undefined,
    last: string | undefined,
    direction: 'older' | 'newer',
  ): void {
    if (first === undefined || last === undefined) {
      if (direction === 'older') this.start = this.end;
      else this.end = this.start;
      this.pruneOrdinals();
      return;
    }
    const firstOrdinal = this.ordinals.get(first);
    const lastOrdinal = this.ordinals.get(last);
    if (firstOrdinal !== undefined) this.start = firstOrdinal;
    if (lastOrdinal !== undefined) this.end = lastOrdinal + 1;
    this.pruneOrdinals();
  }

  private pruneOrdinals(): void {
    for (const [key, ordinal] of this.ordinals)
      if (ordinal < this.start || ordinal >= this.end)
        this.ordinals.delete(key);
  }

  atStart(): boolean {
    return this.start === 0;
  }
  atFirstPageAtOffset(offset: number): boolean {
    return (
      this.start < this.pages.length &&
      this.pages.get(this.start).offset === offset &&
      (this.start === 0 || this.pages.get(this.start - 1).offset < offset)
    );
  }
  size(): number {
    return this.observedCompleteBytes;
  }
  windowStart(): number {
    if (this.start === 0) return 0;
    return this.start === this.pages.length
      ? this.completeBytes
      : this.pages.get(this.start).offset;
  }
  windowEnd(): number {
    return this.end === this.pages.length
      ? this.completeBytes
      : this.pages.get(this.end).offset;
  }

  async close(): Promise<void> {
    this.controller.abort();
    await this.readSettled;
    this.releasePage();
    this.pages.close();
  }
}
