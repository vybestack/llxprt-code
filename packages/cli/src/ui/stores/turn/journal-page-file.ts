/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  closeSync,
  ftruncateSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { getScratchRoot, type JournalEntry } from '@vybestack/llxprt-code-core';
import type { HistoryItem } from '../../types.js';

export type DisplayJournalEntry =
  | Extract<JournalEntry, { kind: 'boundary' }>
  | {
      readonly kind: 'projected';
      readonly offset: number;
      readonly length: number;
      readonly seq: number | null;
      readonly item: HistoryItem;
    };

const storedEntry = z.custom<DisplayJournalEntry>((value: unknown) => {
  if (typeof value !== 'object' || value === null || !('kind' in value))
    return false;
  return value.kind === 'projected' || value.kind === 'boundary';
});
const WIDTH = 16;

export class JournalPageFile {
  private readonly directory: string;
  private readonly data: number;
  private readonly offsets: number;
  private bytes = 0;
  private count = 0;
  private closed = false;
  private entryReads = 0;
  private entryWrites = 0;
  private readonly buffer = Buffer.alloc(WIDTH);

  constructor(temporaryRoot = getScratchRoot()) {
    this.directory = mkdtempSync(join(temporaryRoot, 'llxprt-display-pages-'));
    this.data = openSync(join(this.directory, 'data'), 'wx+', 0o600);
    try {
      this.offsets = openSync(join(this.directory, 'offsets'), 'wx+', 0o600);
    } catch (error) {
      closeSync(this.data);
      rmSync(this.directory, { recursive: true, force: true });
      throw error;
    }
  }

  get length(): number {
    return this.count;
  }

  push(entry: DisplayJournalEntry): void {
    const text = Buffer.from(JSON.stringify(entry));
    this.buffer.writeDoubleLE(this.bytes, 0);
    this.buffer.writeDoubleLE(text.length, 8);
    if (
      writeSync(this.data, text, 0, text.length, this.bytes) !== text.length ||
      writeSync(this.offsets, this.buffer, 0, WIDTH, this.count * WIDTH) !==
        WIDTH
    )
      throw new Error('Short journal page index write');
    this.bytes += text.length;
    this.count += 1;
    this.entryWrites += 1;
  }

  /** Entry reads/writes since open; lets callers prove their work bounds. */
  stats(): { reads: number; writes: number } {
    return { reads: this.entryReads, writes: this.entryWrites };
  }

  /** Drops every entry at index `count` and above. */
  truncate(count: number): void {
    if (this.closed || count < 0) throw new RangeError('Invalid truncation');
    if (count >= this.count) return;
    if (readSync(this.offsets, this.buffer, 0, WIDTH, count * WIDTH) !== WIDTH)
      throw new Error('Truncated journal page index');
    const bytes = this.buffer.readDoubleLE(0);
    ftruncateSync(this.data, bytes);
    ftruncateSync(this.offsets, count * WIDTH);
    this.bytes = bytes;
    this.count = count;
  }

  get(index: number): DisplayJournalEntry {
    if (this.closed || index < 0 || index >= this.count)
      throw new RangeError('Invalid journal page index');
    if (readSync(this.offsets, this.buffer, 0, WIDTH, index * WIDTH) !== WIDTH)
      throw new Error('Truncated journal page index');
    const bytes = Buffer.alloc(this.buffer.readDoubleLE(8));
    if (
      readSync(
        this.data,
        bytes,
        0,
        bytes.length,
        this.buffer.readDoubleLE(0),
      ) !== bytes.length
    )
      throw new Error('Truncated journal page');
    this.entryReads += 1;
    return storedEntry.parse(JSON.parse(bytes.toString('utf8')));
  }

  clear(): void {
    ftruncateSync(this.data, 0);
    ftruncateSync(this.offsets, 0);
    this.bytes = 0;
    this.count = 0;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      closeSync(this.data);
    } finally {
      try {
        closeSync(this.offsets);
      } finally {
        rmSync(this.directory, { recursive: true, force: true });
      }
    }
  }
}
