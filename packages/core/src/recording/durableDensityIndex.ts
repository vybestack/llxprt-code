/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getScratchRoot } from '../storage/scratch-root.js';

const BUCKETS = 4096;
const WIDTH = 40;
const BUCKET_BYTES = BUCKETS * 8;
type Kind = 'removed' | 'replacement';

export interface DensityEntry {
  readonly seq: number;
  readonly start: number;
  readonly bytes: number;
  readonly chron: number;
}

/** Fixed resident storage with disk hash chains. Newest replacement wins. */
export class DurableDensityIndex {
  private readonly directory: string;
  private readonly records: number;
  private readonly buckets: Record<Kind, number>;
  private readonly recordBuffer = Buffer.alloc(WIDTH);
  private readonly bucketBuffer = Buffer.alloc(8);
  private count = 0;
  private currentEntries = 0;
  private peakEntries = 0;
  private peakDiskBytes = 0;
  private closed = false;

  constructor(root = getScratchRoot()) {
    this.directory = fs.mkdtempSync(path.join(root, 'llxprt-density-index-'));
    const opened: number[] = [];
    try {
      const records = fs.openSync(
        path.join(this.directory, 'entries'),
        'wx+',
        0o600,
      );
      opened.push(records);
      const removed = fs.openSync(
        path.join(this.directory, 'removed'),
        'wx+',
        0o600,
      );
      opened.push(removed);
      const replacement = fs.openSync(
        path.join(this.directory, 'replacement'),
        'wx+',
        0o600,
      );
      opened.push(replacement);
      this.records = records;
      this.buckets = { removed, replacement };
      this.clear('removed');
      this.clear('replacement');
    } catch (error) {
      for (const fd of opened) fs.closeSync(fd);
      fs.rmSync(this.directory, { recursive: true, force: true });
      throw error;
    }
  }

  reset(): void {
    if (this.count === 0 && !this.closed) return;
    this.count = 0;
    this.currentEntries = 0;
    fs.ftruncateSync(this.records, 0);
    this.clear('removed');
    this.clear('replacement');
  }

  clear(kind: Kind): void {
    const fd = this.buckets[kind];
    fs.ftruncateSync(fd, 0);
    fs.ftruncateSync(fd, BUCKET_BYTES);
  }

  add(kind: Kind, entry: DensityEntry): void {
    const fd = this.buckets[kind];
    const bucketOffset = (entry.seq % BUCKETS) * 8;
    if (fs.readSync(fd, this.bucketBuffer, 0, 8, bucketOffset) !== 8)
      throw new Error('Truncated density hash bucket');
    const next = this.bucketBuffer.readDoubleLE(0);
    this.recordBuffer.writeDoubleLE(entry.seq, 0);
    this.recordBuffer.writeDoubleLE(entry.start, 8);
    this.recordBuffer.writeDoubleLE(entry.bytes, 16);
    this.recordBuffer.writeDoubleLE(entry.chron, 24);
    this.recordBuffer.writeDoubleLE(next, 32);
    if (
      fs.writeSync(
        this.records,
        this.recordBuffer,
        0,
        WIDTH,
        this.count * WIDTH,
      ) !== WIDTH
    )
      throw new Error('Short density entry write');
    this.bucketBuffer.writeDoubleLE(this.count + 1, 0);
    if (fs.writeSync(fd, this.bucketBuffer, 0, 8, bucketOffset) !== 8)
      throw new Error('Short density bucket write');
    this.count += 1;
    this.currentEntries += 1;
    this.peakEntries = Math.max(this.peakEntries, this.currentEntries);
    this.peakDiskBytes = Math.max(this.peakDiskBytes, this.diskBytes());
  }

  find(kind: Kind, seq: number): DensityEntry | null {
    const fd = this.buckets[kind];
    if (fs.readSync(fd, this.bucketBuffer, 0, 8, (seq % BUCKETS) * 8) !== 8)
      throw new Error('Truncated density hash bucket');
    let next = this.bucketBuffer.readDoubleLE(0);
    while (next !== 0) {
      if (
        fs.readSync(
          this.records,
          this.recordBuffer,
          0,
          WIDTH,
          (next - 1) * WIDTH,
        ) !== WIDTH
      )
        throw new Error('Truncated density entry');
      if (this.recordBuffer.readDoubleLE(0) === seq)
        return {
          seq,
          start: this.recordBuffer.readDoubleLE(8),
          bytes: this.recordBuffer.readDoubleLE(16),
          chron: this.recordBuffer.readDoubleLE(24),
        };
      next = this.recordBuffer.readDoubleLE(32);
    }
    return null;
  }

  metrics(): {
    readonly residentBufferBytes: number;
    readonly peakDiskBytes: number;
    readonly peakEntries: number;
  } {
    return {
      residentBufferBytes:
        this.recordBuffer.byteLength + this.bucketBuffer.byteLength,
      peakDiskBytes: this.peakDiskBytes,
      peakEntries: this.peakEntries,
    };
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      fs.closeSync(this.records);
      fs.closeSync(this.buckets.removed);
      fs.closeSync(this.buckets.replacement);
    } finally {
      fs.rmSync(this.directory, { recursive: true, force: true });
    }
  }

  private diskBytes(): number {
    return fs.fstatSync(this.records).size + 2 * BUCKET_BYTES;
  }
}
