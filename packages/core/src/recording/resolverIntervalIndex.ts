/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SurvivorInterval } from './journalResolver.js';

interface IndexedInterval extends SurvivorInterval {
  readonly purge: boolean;
  readonly ordinal: number;
}

const WIDTH = 48;

export class ResolverIntervalIndex {
  private readonly directory: string;
  private readonly fd: number;
  private readonly buffer = Buffer.alloc(WIDTH);
  private closed = false;
  private size = 0;

  constructor(root = os.tmpdir()) {
    this.directory = fs.mkdtempSync(path.join(root, 'llxprt-resolver-'));
    try {
      this.fd = fs.openSync(
        path.join(this.directory, 'intervals'),
        'wx+',
        0o600,
      );
    } catch (error) {
      fs.rmSync(this.directory, { recursive: true, force: true });
      throw error;
    }
  }

  get length(): number {
    return this.size;
  }

  get(index: number): IndexedInterval {
    if (this.closed || index < 0 || index >= this.size)
      throw new RangeError('Invalid interval index read');
    if (fs.readSync(this.fd, this.buffer, 0, WIDTH, index * WIDTH) !== WIDTH)
      throw new Error('Truncated interval index');
    return {
      fromSeq: this.buffer.readDoubleLE(0),
      toSeq: this.buffer.readDoubleLE(8),
      firstOffset: this.buffer.readDoubleLE(16),
      rowCount: this.buffer.readDoubleLE(24),
      purge: this.buffer.readDoubleLE(32) === 1,
      ordinal: this.buffer.readDoubleLE(40),
    };
  }

  set(index: number, interval: IndexedInterval): void {
    if (this.closed || index < 0 || index > this.size)
      throw new RangeError('Invalid interval index write');
    this.buffer.writeDoubleLE(interval.fromSeq, 0);
    this.buffer.writeDoubleLE(interval.toSeq, 8);
    this.buffer.writeDoubleLE(interval.firstOffset, 16);
    this.buffer.writeDoubleLE(interval.rowCount, 24);
    this.buffer.writeDoubleLE(interval.purge ? 1 : 0, 32);
    this.buffer.writeDoubleLE(interval.ordinal, 40);
    if (fs.writeSync(this.fd, this.buffer, 0, WIDTH, index * WIDTH) !== WIDTH)
      throw new Error('Short interval index write');
    if (index === this.size) this.size += 1;
  }

  push(interval: Omit<IndexedInterval, 'ordinal'>): void {
    this.set(this.size, { ...interval, ordinal: this.size });
  }

  sort(): void {
    for (let index = Math.floor(this.size / 2) - 1; index >= 0; index -= 1)
      this.siftDown(index, this.size);
    for (let end = this.size - 1; end > 0; end -= 1) {
      this.swap(0, end);
      this.siftDown(0, end);
    }
  }

  private siftDown(start: number, end: number): void {
    let root = start;
    while (root * 2 + 1 < end) {
      let child = root * 2 + 1;
      if (child + 1 < end && this.compare(child, child + 1) < 0) child += 1;
      if (this.compare(root, child) >= 0) return;
      this.swap(root, child);
      root = child;
    }
  }

  private compare(left: number, right: number): number {
    const a = this.get(left);
    const b = this.get(right);
    return a.fromSeq !== b.fromSeq
      ? a.fromSeq - b.fromSeq
      : a.ordinal - b.ordinal;
  }

  private swap(left: number, right: number): void {
    const a = this.get(left);
    const b = this.get(right);
    this.set(left, b);
    this.set(right, a);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      fs.closeSync(this.fd);
    } finally {
      fs.rmSync(this.directory, { recursive: true, force: true });
    }
  }
}
