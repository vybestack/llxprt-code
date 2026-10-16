/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createReadStream } from 'node:fs';
import {
  HISTORY_RECORD_TYPES,
  MAX_RECORD_BYTES,
} from '@vybestack/llxprt-code-core';

/**
 * Bounded journal line framing for the scrollback pager. Lines are located
 * by a byte scan; a line is assembled only while it is within
 * MAX_RECORD_BYTES and only when the pager needs its type, so a whole-history
 * record (semantic media purge) or an oversized/hostile line never costs more
 * than the sniffed prefix and one read chunk.
 */

export interface RecordLine {
  readonly kind: 'record';
  readonly offset: number;
  readonly length: number;
  readonly seq: number;
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

/** A line over MAX_RECORD_BYTES: offset and length only, never decoded. */
export interface OversizedLine {
  readonly kind: 'oversized';
  readonly offset: number;
  readonly length: number;
}

/**
 * A history record the pager does not project (density, purge, ...) and so
 * never decodes. Only its type is reported, because any history record that
 * follows an open replace transaction abandons it.
 */
export interface SkippedHistoryLine {
  readonly kind: 'skipped';
  readonly offset: number;
  readonly length: number;
  readonly type: string;
}

export type FramedLine = RecordLine | OversizedLine | SkippedHistoryLine;

export interface FramingMetrics {
  /** Largest byte count assembled for decoding in one line. */
  maxAssembledBytes: number;
  /** Offset just past the last complete line framed, decoded or not. */
  completeThrough: number;
}

export interface FramingSource {
  readonly chunks: AsyncIterable<Buffer | string>;
  /** Journal offset of the first byte this source delivers. */
  readonly startOffset: number;
  /** Exclusive end offset of the complete prefix, or null when unbounded. */
  readonly endExclusive: number | null;
  /** Leading bytes to discard (sources that cannot seek). */
  readonly skipBytes: number;
  readonly signal?: AbortSignal;
}

/** Record types the pager projects; every other type is skipped undecoded. */
const DECODED_TYPES: ReadonlySet<string> = new Set([
  'content',
  'rewind',
  'compressed',
  'replace_begin',
  'replace_commit',
  'replace_abort',
]);
const SNIFF_BYTES = 256;
const ENVELOPE_HEAD =
  /^\uFEFF?\{"v":\d+,"seq":\d+,(?:"ts":"[^"]*",)?"type":"([a-z_]+)"/;
const NEWLINE = 0x0a;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseLine(
  text: string,
  offset: number,
  length: number,
): RecordLine | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return undefined;
  }
  if (
    !isRecord(value) ||
    typeof value.seq !== 'number' ||
    typeof value.type !== 'string' ||
    !isRecord(value.payload)
  )
    return undefined;
  return {
    kind: 'record',
    offset,
    length,
    seq: value.seq,
    type: value.type,
    payload: value.payload,
  };
}

type LineMode = 'collect' | 'skip' | 'oversized';

class LineFramer {
  private parts: Buffer[] = [];
  private assembled = 0;
  private lineBytes = 0;
  private mode: LineMode = 'collect';
  private sniffed = false;
  private skippedType: string | undefined;

  constructor(
    private offset: number,
    private readonly metrics: FramingMetrics,
  ) {}

  /** Adds one newline-bounded segment; returns the finished line, if any. */
  push(segment: Buffer, complete: boolean): FramedLine | undefined {
    this.lineBytes += segment.length;
    if (this.mode === 'collect') this.collect(segment, complete);
    return complete ? this.finish() : undefined;
  }

  private collect(segment: Buffer, complete: boolean): void {
    if (
      !this.sniffed &&
      (complete || this.assembled + segment.length >= SNIFF_BYTES)
    )
      this.sniff(segment);
    if (this.mode !== 'collect') return;
    if (this.assembled + segment.length > MAX_RECORD_BYTES) {
      this.mode = 'oversized';
      this.parts = [];
      this.assembled = 0;
      return;
    }
    this.parts.push(segment);
    this.assembled += segment.length;
    this.metrics.maxAssembledBytes = Math.max(
      this.metrics.maxAssembledBytes,
      this.assembled,
    );
  }

  private sniff(segment: Buffer): void {
    this.sniffed = true;
    const head = Buffer.concat([...this.parts, segment])
      .subarray(0, SNIFF_BYTES)
      .toString('utf8');
    const type = ENVELOPE_HEAD.exec(head)?.[1];
    if (type !== undefined && !DECODED_TYPES.has(type)) {
      this.mode = 'skip';
      this.skippedType = type;
      this.parts = [];
      this.assembled = 0;
    }
  }

  private finish(): FramedLine | undefined {
    const { offset, lineBytes, mode } = this;
    let framed: FramedLine | undefined;
    if (mode === 'oversized')
      framed = { kind: 'oversized', offset, length: lineBytes };
    else if (mode === 'skip') {
      const type = this.skippedType;
      if (type !== undefined && HISTORY_RECORD_TYPES.has(type))
        framed = { kind: 'skipped', offset, length: lineBytes, type };
    } else
      framed = parseLine(
        Buffer.concat(this.parts).toString('utf8'),
        offset,
        lineBytes,
      );
    this.parts = [];
    this.assembled = 0;
    this.offset += lineBytes;
    this.metrics.completeThrough = this.offset;
    this.lineBytes = 0;
    this.mode = 'collect';
    this.sniffed = false;
    this.skippedType = undefined;
    return framed;
  }
}

/**
 * Yields every complete line of the source as a record (decoded), an
 * oversized marker, or nothing (skipped undecoded). A partial last line is
 * dropped.
 */
export async function* frameRecords(
  source: FramingSource,
  metrics: FramingMetrics,
): AsyncIterable<FramedLine> {
  const framer = new LineFramer(source.startOffset, metrics);
  let discard = source.skipBytes;
  let consumed = source.startOffset;
  const limit = source.endExclusive ?? Number.POSITIVE_INFINITY;
  for await (const chunk of source.chunks) {
    source.signal?.throwIfAborted();
    let buffer = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
    if (discard > 0) {
      const dropped = Math.min(discard, buffer.length);
      buffer = buffer.subarray(dropped);
      discard -= dropped;
    }
    if (consumed + buffer.length > limit)
      buffer = buffer.subarray(0, Math.max(0, limit - consumed));
    consumed += buffer.length;
    let position = 0;
    while (position < buffer.length) {
      const newline = buffer.indexOf(NEWLINE, position);
      const end = newline === -1 ? buffer.length : newline + 1;
      const framed = framer.push(
        buffer.subarray(position, end),
        newline !== -1,
      );
      if (framed) yield framed;
      position = end;
    }
  }
  source.signal?.throwIfAborted();
  if (source.endExclusive !== null && consumed !== source.endExclusive)
    throw new Error('Truncated journal while reading complete prefix');
}

export function openFileChunks(
  filePath: string,
  chunkBytes: number,
  start: number,
  endExclusive: number,
  signal: AbortSignal | undefined,
): AsyncIterable<Buffer> {
  return (async function* () {
    if (endExclusive <= start) return;
    const stream = createReadStream(filePath, {
      highWaterMark: chunkBytes,
      start,
      end: endExclusive - 1,
      signal,
    });
    try {
      yield* stream as AsyncIterable<Buffer>;
    } finally {
      stream.destroy();
    }
  })();
}
