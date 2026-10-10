/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { getScratchRoot } from '../storage/scratch-root.js';

export type RowSource = 'durable' | 'projection' | 'pending';

export interface NumericRow {
  readonly source: RowSource;
  readonly offset: number;
  readonly bytes: number;
  readonly chronologySeq: number | null;
  readonly pendingSlot: number;
  readonly invalidateResponses: boolean;
  readonly chronologyOverlay?: boolean;
  readonly chronologyUserTurn?: number;
  readonly chronologyStep?: number;
  readonly chronologyRecordedAt?: number;
}

const WIDTH = 64;
const COPY_ROWS = 1024;
const SOURCES: readonly RowSource[] = ['durable', 'projection', 'pending'];

function validInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function validChronologyOverlay(row: NumericRow): boolean {
  if (row.chronologyOverlay !== true) return true;
  if (row.chronologySeq === null) return false;
  if (
    row.chronologyUserTurn === undefined ||
    !validInteger(row.chronologyUserTurn)
  )
    return false;
  if (row.chronologyStep === undefined || !validInteger(row.chronologyStep))
    return false;
  if (
    row.chronologyRecordedAt === undefined ||
    !validInteger(row.chronologyRecordedAt)
  )
    return false;
  return true;
}

function encodedNumber(value: number | null | undefined): number {
  if (value === null || value === undefined) return NaN;
  return value;
}

function encode(row: NumericRow, buffer: Buffer): void {
  const source = SOURCES.indexOf(row.source);
  if (source === -1 || !validInteger(row.offset) || !validInteger(row.bytes))
    throw new RangeError('Invalid numeric row');
  if (row.chronologySeq !== null && !validInteger(row.chronologySeq))
    throw new RangeError('Invalid numeric row');
  if (!Number.isSafeInteger(row.pendingSlot))
    throw new RangeError('Invalid numeric row');
  if (source === 2 && row.pendingSlot < 0)
    throw new RangeError('Invalid numeric row');
  if (source !== 2 && row.pendingSlot !== -1)
    throw new RangeError('Invalid numeric row');
  if (
    typeof row.invalidateResponses !== 'boolean' ||
    !validChronologyOverlay(row)
  )
    throw new RangeError('Invalid numeric row');
  buffer.fill(0);
  buffer.writeUInt8(source, 0);
  buffer.writeUInt8(Number(row.invalidateResponses), 1);
  buffer.writeUInt8(Number(row.chronologyOverlay === true), 2);
  buffer.writeDoubleLE(row.pendingSlot, 8);
  buffer.writeDoubleLE(row.offset, 16);
  buffer.writeDoubleLE(row.bytes, 24);
  buffer.writeDoubleLE(encodedNumber(row.chronologySeq), 32);
  buffer.writeDoubleLE(encodedNumber(row.chronologyUserTurn), 40);
  buffer.writeDoubleLE(encodedNumber(row.chronologyStep), 48);
  buffer.writeDoubleLE(encodedNumber(row.chronologyRecordedAt), 56);
}

function decode(buffer: Buffer): NumericRow {
  const sourceCode = buffer.readUInt8(0);
  if (sourceCode >= SOURCES.length)
    throw new Error('Corrupt numeric row source');
  const source = SOURCES[sourceCode];
  const chronology = buffer.readDoubleLE(32);
  const chronologyOverlay = buffer.readUInt8(2) === 1;
  return {
    source,
    invalidateResponses: buffer.readUInt8(1) === 1,
    pendingSlot: buffer.readDoubleLE(8),
    offset: buffer.readDoubleLE(16),
    bytes: buffer.readDoubleLE(24),
    chronologySeq: Number.isNaN(chronology) ? null : chronology,
    ...(chronologyOverlay
      ? {
          chronologyOverlay: true,
          chronologyUserTurn: buffer.readDoubleLE(40),
          chronologyStep: buffer.readDoubleLE(48),
          chronologyRecordedAt: buffer.readDoubleLE(56),
        }
      : {}),
  };
}

/** Private scratch index: only one fixed-size record is ever resident during mutations. */
export class MutableRowDirectory {
  private readonly directory: string;
  private readonly file: string;
  private fd: number;
  private readonly buffer = Buffer.alloc(WIDTH);
  private size = 0;
  private closed = false;

  constructor(root = getScratchRoot(), prefix = 'llxprt-row-directory-') {
    this.directory = fs.mkdtempSync(path.join(root, prefix));
    this.file = path.join(this.directory, 'rows');
    try {
      this.fd = fs.openSync(this.file, 'wx+', 0o600);
    } catch (error) {
      fs.rmSync(this.directory, { recursive: true, force: true });
      throw error;
    }
  }

  get length(): number {
    this.assertOpen();
    return this.size;
  }

  rowAt(index: number): NumericRow {
    this.checkPosition(index, false);
    if (fs.readSync(this.fd, this.buffer, 0, WIDTH, index * WIDTH) !== WIDTH)
      throw new Error('Truncated numeric row directory');
    return decode(this.buffer);
  }

  firstChronology(seq: number): number {
    this.assertOpen();
    if (!validInteger(seq)) throw new RangeError('Invalid chronology sequence');
    for (let index = 0; index < this.size; index += 1)
      if (this.rowAt(index).chronologySeq === seq) return index;
    return -1;
  }

  append(row: NumericRow): void {
    this.assertOpen();
    encode(row, this.buffer);
    try {
      this.write(this.fd, this.size);
    } catch (error) {
      fs.ftruncateSync(this.fd, this.size * WIDTH);
      throw error;
    }
    this.size += 1;
  }

  replace(index: number, row: NumericRow): void {
    this.checkPosition(index, false);
    encode(row, this.buffer);
    const previous = this.rowAt(index);
    encode(row, this.buffer);
    try {
      this.write(this.fd, index);
    } catch (error) {
      try {
        encode(previous, this.buffer);
        this.write(this.fd, index);
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          'Numeric row replacement and rollback failed',
        );
      }
      throw error;
    }
  }

  truncate(length: number): void {
    this.assertOpen();
    if (!validInteger(length) || length > this.size)
      throw new RangeError('Invalid numeric row truncation');
    fs.ftruncateSync(this.fd, length * WIDTH);
    this.size = length;
  }

  insert(index: number, row: NumericRow): void {
    this.checkPosition(index, true);
    encode(row, this.buffer);
    this.stage((target) => {
      for (let cursor = 0; cursor < this.size; cursor += 1) {
        if (cursor === index) {
          encode(row, this.buffer);
          this.write(target, cursor);
        }
        this.rowAt(cursor);
        this.write(target, cursor < index ? cursor : cursor + 1);
      }
      if (index === this.size) {
        encode(row, this.buffer);
        this.write(target, index);
      }
      return this.size + 1;
    });
  }

  compact(keep: (row: NumericRow, index: number) => boolean): number {
    this.assertOpen();
    this.stage((target) => {
      let next = 0;
      for (let index = 0; index < this.size; index += 1) {
        const entry = this.rowAt(index);
        if (keep(entry, index)) this.write(target, next++);
      }
      return next;
    });
    return this.size;
  }

  transform(
    resolve: (row: NumericRow, index: number) => NumericRow | null,
  ): number {
    this.assertOpen();
    this.stage((target) => {
      let next = 0;
      for (let index = 0; index < this.size; index += 1) {
        const resolved = resolve(this.rowAt(index), index);
        if (resolved === null) continue;
        encode(resolved, this.buffer);
        this.write(target, next++);
      }
      return next;
    });
    return this.size;
  }

  /** Independent copy of the current rows, copied in bounded chunks. */
  clone(root?: string, prefix?: string): MutableRowDirectory {
    this.assertOpen();
    const copy = new MutableRowDirectory(root, prefix);
    try {
      const chunk = Buffer.alloc(COPY_ROWS * WIDTH);
      for (let row = 0; row < this.size; row += COPY_ROWS) {
        const bytes = Math.min(COPY_ROWS, this.size - row) * WIDTH;
        if (fs.readSync(this.fd, chunk, 0, bytes, row * WIDTH) !== bytes)
          throw new Error('Truncated numeric row directory');
        if (fs.writeSync(copy.fd, chunk, 0, bytes, row * WIDTH) !== bytes)
          throw new Error('Short numeric row write');
      }
      copy.size = this.size;
      return copy;
    } catch (error) {
      copy.close();
      throw error;
    }
  }

  metrics(): {
    readonly residentBufferBytes: number;
    readonly fileBytes: number;
  } {
    this.assertOpen();
    return {
      residentBufferBytes: this.buffer.byteLength,
      fileBytes: fs.fstatSync(this.fd).size,
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

  private stage(build: (fd: number) => number): void {
    const staging = path.join(this.directory, 'stage');
    const target = fs.openSync(staging, 'wx+', 0o600);
    try {
      const next = build(target);
      fs.renameSync(staging, this.file);
      const previous = this.fd;
      this.fd = target;
      this.size = next;
      fs.closeSync(previous);
    } catch (error) {
      if (this.fd !== target) fs.closeSync(target);
      throw error;
    } finally {
      fs.rmSync(staging, { force: true });
    }
  }

  private write(fd: number, index: number): void {
    this.writeBuffer(fd, this.buffer, index);
  }

  private writeBuffer(fd: number, buffer: Buffer, index: number): void {
    if (fs.writeSync(fd, buffer, 0, WIDTH, index * WIDTH) !== WIDTH)
      throw new Error('Short numeric row write');
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Numeric row directory is closed');
  }

  private checkPosition(index: number, end: boolean): void {
    this.assertOpen();
    if (!validInteger(index) || index >= this.size + (end ? 1 : 0))
      throw new RangeError('Invalid numeric row position');
  }
}

export async function withMutableRowDirectory<T>(
  root: string,
  action: (directory: MutableRowDirectory) => Promise<T> | T,
): Promise<T> {
  const directory = new MutableRowDirectory(root);
  try {
    return await action(directory);
  } finally {
    directory.close();
  }
}
