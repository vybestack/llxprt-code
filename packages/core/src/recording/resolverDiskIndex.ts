/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getScratchRoot } from '../storage/scratch-root.js';

export interface IndexedRow {
  readonly seq: number;
  readonly offset: number;
  readonly length: number;
  readonly rowIndex: number;
  readonly start: number;
  readonly bytes: number;
  readonly chron: number;
  readonly purge: number;
  readonly userTurn?: number;
  readonly step?: number;
  readonly recordedAt?: number;
  readonly invalidateResponses?: boolean;
}
const WIDTH = 96;

export class ResolverDiskIndex {
  private readonly directory: string;
  private readonly fd: number;
  private size = 0;
  private closed = false;
  private readonly buffer = Buffer.alloc(WIDTH);

  constructor(root = getScratchRoot()) {
    this.directory = fs.mkdtempSync(path.join(root, 'llxprt-resolver-'));
    try {
      this.fd = fs.openSync(path.join(this.directory, 'rows'), 'wx+', 0o600);
    } catch (error) {
      fs.rmSync(this.directory, { recursive: true, force: true });
      throw error;
    }
  }

  get length(): number {
    return this.size;
  }

  truncate(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.size)
      throw new RangeError('Invalid index truncation');
    if (length === this.size && !this.closed) return;
    fs.ftruncateSync(this.fd, length * WIDTH);
    this.size = length;
  }

  get(index: number): IndexedRow {
    if (this.closed || index < 0 || index >= this.size)
      throw new RangeError('Invalid index read');
    if (fs.readSync(this.fd, this.buffer, 0, WIDTH, index * WIDTH) !== WIDTH)
      throw new Error('Truncated resolver index');
    return {
      seq: this.buffer.readDoubleLE(0),
      offset: this.buffer.readDoubleLE(8),
      length: this.buffer.readDoubleLE(16),
      rowIndex: this.buffer.readDoubleLE(24),
      start: this.buffer.readDoubleLE(32),
      bytes: this.buffer.readDoubleLE(40),
      chron: this.buffer.readDoubleLE(48),
      purge: this.buffer.readDoubleLE(56),
      userTurn: this.buffer.readDoubleLE(64),
      step: this.buffer.readDoubleLE(72),
      recordedAt: this.buffer.readDoubleLE(80),
      invalidateResponses: this.buffer.readDoubleLE(88) === 1,
    };
  }

  set(index: number, row: IndexedRow): void {
    if (this.closed || index < 0 || index > this.size)
      throw new RangeError('Invalid index write');
    this.buffer.writeDoubleLE(row.seq, 0);
    this.buffer.writeDoubleLE(row.offset, 8);
    this.buffer.writeDoubleLE(row.length, 16);
    this.buffer.writeDoubleLE(row.rowIndex, 24);
    this.buffer.writeDoubleLE(row.start, 32);
    this.buffer.writeDoubleLE(row.bytes, 40);
    this.buffer.writeDoubleLE(row.chron, 48);
    this.buffer.writeDoubleLE(row.purge, 56);
    this.buffer.writeDoubleLE(row.userTurn ?? NaN, 64);
    this.buffer.writeDoubleLE(row.step ?? NaN, 72);
    this.buffer.writeDoubleLE(row.recordedAt ?? NaN, 80);
    this.buffer.writeDoubleLE(row.invalidateResponses === true ? 1 : 0, 88);
    if (fs.writeSync(this.fd, this.buffer, 0, WIDTH, index * WIDTH) !== WIDTH)
      throw new Error('Short resolver index write');
    if (index === this.size) this.size += 1;
  }

  push(row: IndexedRow): void {
    this.set(this.size, row);
  }

  insert(index: number, row: IndexedRow): void {
    for (let next = this.size; next > index; next -= 1)
      this.set(next, this.get(next - 1));
    this.set(index, row);
  }

  metrics(): {
    readonly residentIndexBufferBytes: number;
    readonly indexFileBytes: number;
  } {
    return {
      residentIndexBufferBytes: this.buffer.byteLength,
      indexFileBytes: fs.fstatSync(this.fd).size,
    };
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
