/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open, type FileHandle } from 'node:fs/promises';
import { readMetadataJsonLines } from './metadataJsonLines.js';
import { field } from './resolverProjection.js';
import type { JournalReadCounters } from './journalCounters.js';

const HISTORY_EVENTS = new Set([
  'content',
  'compressed',
  'rewind',
  'semantic_media_purge',
  'density_mutation',
  'synthetic_insert',
  'compression_detail',
  'chronology_bind',
]);

async function copyBytes(
  source: FileHandle,
  child: FileHandle,
  buffer: Buffer,
  start: number,
  end: number,
): Promise<void> {
  let position = start;
  while (position < end) {
    const { bytesRead } = await source.read(
      buffer,
      0,
      Math.min(buffer.length, end - position),
      position,
    );
    if (bytesRead === 0) throw new Error('Checkpoint source was truncated');
    let written = 0;
    while (written < bytesRead) {
      const result = await child.write(buffer, written, bytesRead - written);
      if (result.bytesWritten === 0) throw new Error('Checkpoint copy stalled');
      written += result.bytesWritten;
    }
    position += bytesRead;
  }
}

async function* historyRanges(
  sourcePath: string,
  maxBytes: number,
  sequence: number,
  counters?: JournalReadCounters,
): AsyncIterable<{ start: number; end: number; complete: boolean }> {
  let start = 0;
  for await (const line of readMetadataJsonLines(sourcePath, maxBytes)) {
    const offset = start;
    start = line.byteEnd;
    if (line.parsed !== null && !line.blank) {
      counters?.recordDecoded();
      const seq = field(line.parsed, 'seq');
      if (typeof seq === 'number' && seq > sequence) break;
      const type = field(line.parsed, 'type');
      if (
        typeof seq === 'number' &&
        typeof type === 'string' &&
        HISTORY_EVENTS.has(type)
      ) {
        yield { start: offset, end: line.byteEnd, complete: line.complete };
      }
    }
  }
}

async function copyRanges(
  source: FileHandle,
  childPath: string,
  ranges: AsyncIterable<{ start: number; end: number; complete: boolean }>,
): Promise<void> {
  const child = await open(childPath, 'a');
  try {
    const buffer = Buffer.alloc(64 * 1024);
    for await (const range of ranges) {
      await copyBytes(source, child, buffer, range.start, range.end);
      if (!range.complete) await child.write('\n');
    }
  } finally {
    await child.close();
  }
}

export async function copyCheckpointRange(
  sourcePath: string,
  childPath: string,
  maxBytes: number,
  sequence: number,
  counters?: JournalReadCounters,
): Promise<void> {
  const source = await open(sourcePath, 'r');
  try {
    await copyRanges(
      source,
      childPath,
      historyRanges(sourcePath, maxBytes, sequence, counters),
    );
  } finally {
    await source.close();
  }
}
