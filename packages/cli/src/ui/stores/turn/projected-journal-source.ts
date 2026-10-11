/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open, type FileHandle } from 'node:fs/promises';
import {
  frameRecords,
  openFileChunks,
  type FramingMetrics,
  type FramingSource,
  type RecordLine,
} from './projected-journal-records.js';
import type { JournalReadCounters } from '@vybestack/llxprt-code-core';

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

export async function completePrefix(
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
export function framingSource(
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

/**
 * Decoded records of the journal byte range [from, end), in order. Used to
 * re-read one group; never more than the range.
 */
export async function* readRecordRange(
  filePath: string,
  options: ProjectedJournalOptions,
  from: number,
  end: number,
): AsyncIterable<RecordLine> {
  const metrics: FramingMetrics = {
    maxAssembledBytes: 0,
    completeThrough: from,
  };
  const framed = frameRecords(
    framingSource(filePath, options, from, end),
    metrics,
  );
  for await (const line of framed) {
    if (line.offset >= end) return;
    if (line.kind === 'record') yield line;
  }
}
