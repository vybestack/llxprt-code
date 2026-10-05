/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  ftruncateSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { isRecord } from './historyJournalGuards.js';

const WIDTH = 48;

function transfer(
  fd: number,
  bytes: Buffer,
  position: number,
  write: boolean,
): void {
  let offset = 0;
  while (offset < bytes.length) {
    const count = write
      ? writeSync(fd, bytes, offset, bytes.length - offset, position + offset)
      : readSync(fd, bytes, offset, bytes.length - offset, position + offset);
    if (count === 0)
      throw new Error('Provider normalization storage made no I/O progress');
    offset += count;
  }
}

/** Keys and values live on disk. Rehashing holds one fixed-width address at a time. */
export class ProviderNormalizationStorage {
  private index: number;
  private readonly values: number;
  private capacity = 256;
  private count = 0;
  private end = 0;
  private closed = false;

  constructor(private readonly directory: string) {
    this.index = openSync(join(directory, 'index'), 'wx+', 0o600);
    try {
      ftruncateSync(this.index, this.capacity * WIDTH);
      this.values = openSync(join(directory, 'values'), 'wx+', 0o600);
    } catch (error) {
      closeSync(this.index);
      throw error;
    }
  }

  private check(): void {
    if (this.closed)
      throw new Error('Provider normalization storage is closed');
    // Unix FDs survive unlink; missing scratch must fail reads as well as writes.
    statSync(this.directory);
  }

  private entry(index: number, fd = this.index): Buffer {
    const address = Buffer.alloc(WIDTH);
    transfer(fd, address, index * WIDTH, false);
    return address;
  }

  private value(address: Buffer): { key: string; value: unknown } {
    const bytes = Buffer.alloc(address.readDoubleLE(40));
    transfer(this.values, bytes, address.readDoubleLE(32) - 1, false);
    const record: unknown = JSON.parse(bytes.toString('utf8'));
    if (!isRecord(record) || typeof record.key !== 'string')
      throw new Error('Invalid provider normalization storage value');
    return { key: record.key, value: record.value };
  }

  private locate(key: string, hash: Buffer): { slot: number; address: Buffer } {
    let slot = hash.readUInt32LE(0) % this.capacity;
    for (let scanned = 0; scanned < this.capacity; scanned++) {
      const address = this.entry(slot);
      if (
        address.readDoubleLE(32) === 0 ||
        (address.subarray(0, 32).equals(hash) &&
          this.value(address).key === key)
      )
        return { slot, address };
      slot = (slot + 1) % this.capacity;
    }
    throw new Error('Provider normalization index is full');
  }

  get(key: string): unknown {
    this.check();
    const hash = createHash('sha256').update(key).digest();
    const { address } = this.locate(key, hash);
    return address.readDoubleLE(32) === 0
      ? undefined
      : this.value(address).value;
  }

  set(key: string, value: unknown): void {
    this.check();
    if (this.count * 2 >= this.capacity) this.grow();
    const hash = createHash('sha256').update(key).digest();
    const { slot, address } = this.locate(key, hash);
    const inserted = address.readDoubleLE(32) === 0;
    const bytes = Buffer.from(JSON.stringify({ key, value }));
    transfer(this.values, bytes, this.end, true);
    hash.copy(address, 0);
    address.writeDoubleLE(this.end + 1, 32);
    address.writeDoubleLE(bytes.length, 40);
    transfer(this.index, address, slot * WIDTH, true);
    this.end += bytes.length;
    if (inserted) this.count++;
  }

  private grow(): void {
    const capacity = this.capacity * 2;
    const nextPath = join(this.directory, 'index-next');
    const next = openSync(nextPath, 'w+', 0o600);
    try {
      ftruncateSync(next, capacity * WIDTH);
      for (let index = 0; index < this.capacity; index++) {
        const address = this.entry(index);
        if (address.readDoubleLE(32) === 0) continue;
        let slot = address.readUInt32LE(0) % capacity;
        while (this.entry(slot, next).readDoubleLE(32) !== 0)
          slot = (slot + 1) % capacity;
        transfer(next, address, slot * WIDTH, true);
      }
      renameSync(nextPath, join(this.directory, 'index'));
    } catch (error) {
      closeSync(next);
      throw error;
    }
    closeSync(this.index);
    this.index = next;
    this.capacity = capacity;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      closeSync(this.index);
    } finally {
      closeSync(this.values);
    }
  }
}
