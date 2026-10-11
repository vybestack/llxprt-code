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
  endExclusive: number,
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
      await cursor.rebuild();
      cursor.start = cursor.pages.length;
      cursor.end = cursor.pages.length;
      return cursor;
    } catch (error) {
      await cursor.close();
      throw error;
    }
  }

  private append(items: Iterable<HistoryItem>, end: number): void {
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
        item,
      });
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
      if (content.speaker !== 'tool') this.seq = record.seq;
    } else if (record.type === 'rewind' || record.type === 'compressed') {
      this.append(projection.flush(), previousEnd);
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

  /** Oversized lines are diagnosed by offset and length and never displayed. */
  private noteOversized(_line: OversizedLine): void {
    this.oversizedRecords += 1;
  }

  metrics(): { maxAssembledRecordBytes: number; oversizedRecords: number } {
    return {
      maxAssembledRecordBytes: this.framing.maxAssembledBytes,
      oversizedRecords: this.oversizedRecords,
    };
  }

  private rebuild(): Promise<void> {
    const read = this.buildPages();
    this.readSettled = read.then(
      () => undefined,
      () => undefined,
    );
    return read;
  }

  private async buildPages(): Promise<void> {
    this.options.signal?.throwIfAborted();
    this.pages.clear();
    this.framing.completeThrough = 0;
    const snapshot = this.options.read
      ? { fileBytes: (await stat(this.filePath)).size, endExclusive: 0 }
      : await completePrefix(this.filePath, this.options.signal);
    this.fileBytes = snapshot.fileBytes;
    const projection = new HistoryProjection(
      undefined,
      this.options.counters?.ownership,
      this.options.temporaryRoot,
      this.options.signal,
    );
    let previousEnd = 0;
    try {
      const framed = frameRecords(
        framingSource(this.filePath, this.options, 0, snapshot.endExclusive),
        this.framing,
      );
      for await (const record of framed) {
        if (record.kind === 'record')
          this.acceptRecord(projection, record, previousEnd);
        else this.noteOversized(record);
        previousEnd = record.offset + record.length;
      }
      this.options.signal?.throwIfAborted();
      this.append(projection.flush(), previousEnd);
      this.completeBytes = this.framing.completeThrough;
      this.observedCompleteBytes = this.framing.completeThrough;
    } finally {
      projection.close();
    }
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
    if ((await stat(this.filePath)).size !== this.fileBytes) {
      let refresh = this.pages.length;
      const tail = refresh > 0 ? this.pages.get(refresh - 1) : undefined;
      if (tail?.kind === 'projected' && tail.item.type === 'tool_group') {
        while (
          refresh > 0 &&
          this.pages.get(refresh - 1).offset === tail.offset
        )
          refresh -= 1;
      }
      await this.rebuild();
      this.end = Math.min(this.end, Math.max(this.start, refresh));
    }
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
      return;
    }
    for (let index = 0; index < this.pages.length; index += 1) {
      const entry = this.pages.get(index);
      const identity =
        entry.kind === 'projected'
          ? entry.item.rowIdentity
          : rowIdentity(
              { kind: 'journal', offset: entry.offset },
              'summaryRow',
            );
      if (!identity) continue;
      const key = rowIdentityKey(identity);
      if (key === first) this.start = index;
      if (key === last) {
        this.end = index + 1;
        return;
      }
    }
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
