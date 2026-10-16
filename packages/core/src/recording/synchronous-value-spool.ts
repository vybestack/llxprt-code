/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  closeSync,
  ftruncateSync,
  openSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { createScratchDirSync } from '../storage/scratch-root.js';

export interface ValueTicketReader<T> {
  readonly length: number;
  read(index: number): T;
  close(): void;
}

export class SynchronousValueSpool<T> {
  private storage: { root: string; values: number; index: number } | undefined;
  private count = 0;
  private offset = 0;
  private leases = 1;
  private retired = false;

  constructor(private readonly decode: (value: unknown) => T) {}

  get length(): number {
    return this.count;
  }

  append(value: T): number {
    if (this.retired) throw new Error('Value spool is retired');
    const storage = this.ensureStorage();
    const bytes = Buffer.from(JSON.stringify(value), 'utf8');
    const address = Buffer.alloc(16);
    address.writeDoubleLE(this.offset, 0);
    address.writeDoubleLE(bytes.length, 8);
    transfer(storage.values, bytes, this.offset, true);
    transfer(storage.index, address, this.count * 16, true);
    this.offset += bytes.length;
    return this.count++;
  }

  truncate(length: number): void {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.count)
      throw new Error('Value spool truncation boundary is invalid');
    this.count = length;
  }

  read(index: number): T {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.count)
      throw new Error('Value ticket ordinal is invalid');
    const storage = this.storage;
    if (storage === undefined) throw new Error('Value spool storage is closed');
    const address = Buffer.alloc(16);
    transfer(storage.index, address, index * 16, false);
    const bytes = Buffer.alloc(address.readDoubleLE(8));
    transfer(storage.values, bytes, address.readDoubleLE(0), false);
    const parsed: unknown = JSON.parse(bytes.toString('utf8'));
    return this.decode(parsed);
  }

  pin(start = 0, end = this.count): ValueTicketReader<T> {
    if (this.retired) throw new Error('Value spool is retired');
    if (start < 0 || end < start || end > this.count)
      throw new Error('Value spool boundary is invalid');
    this.leases++;
    const lease: { source: SynchronousValueSpool<T> | undefined } = {
      source: this,
    };
    return {
      length: end - start,
      read(index): T {
        if (lease.source === undefined)
          throw new Error('Value ticket reader is closed');
        if (index < 0 || index >= end - start)
          throw new Error('Value ticket reader ordinal is invalid');
        return lease.source.read(start + index);
      },
      close(): void {
        const previous = lease.source;
        lease.source = undefined;
        previous?.release();
      },
    };
  }

  reset(): SynchronousValueSpool<T> {
    if (this.retired) throw new Error('Value spool is retired');
    if (this.leases > 1) {
      this.close();
      return new SynchronousValueSpool(this.decode);
    }
    if (this.storage !== undefined) {
      ftruncateSync(this.storage.values, 0);
      ftruncateSync(this.storage.index, 0);
    }
    this.count = 0;
    this.offset = 0;
    return this;
  }

  close(): void {
    if (this.retired) return;
    this.retired = true;
    this.release();
  }

  private release(): void {
    if (--this.leases !== 0) return;
    const storage = this.storage;
    this.storage = undefined;
    if (storage === undefined) return;
    try {
      closeSync(storage.index);
    } finally {
      try {
        closeSync(storage.values);
      } finally {
        rmSync(storage.root, { recursive: true, force: true });
      }
    }
  }

  private ensureStorage(): NonNullable<SynchronousValueSpool<T>['storage']> {
    if (this.storage !== undefined) return this.storage;
    const root = createScratchDirSync('history-value-ticket-');
    let values: number | undefined;
    try {
      values = openSync(join(root, 'values'), 'w+');
      const index = openSync(join(root, 'index'), 'w+');
      this.storage = { root, values, index };
      return this.storage;
    } catch (error) {
      try {
        if (values !== undefined) closeSync(values);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
      throw error;
    }
  }
}

function transfer(
  fd: number,
  bytes: Buffer,
  offset: number,
  write: boolean,
): void {
  let done = 0;
  while (done < bytes.length) {
    const count = write
      ? writeSync(fd, bytes, done, bytes.length - done, offset + done)
      : readSync(fd, bytes, done, bytes.length - done, offset + done);
    if (count === 0) throw new Error('Value spool I/O made no progress');
    done += count;
  }
}
