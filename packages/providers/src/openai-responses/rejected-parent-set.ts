/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  ftruncateSync,
  openSync,
  readSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { getScratchRoot } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

const HEADER_BYTES = 64;
const SLOT_BYTES = 16;
const WINDOW_BYTES = 4096;
interface Table {
  readonly fd: number;
  readonly path: string;
  readonly capacity: number;
  count: number;
}
interface TableIO {
  read(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): number;
  write(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): number;
}

function keyOf(id: string): Buffer {
  const key = createHash('sha256').update(id).digest().subarray(0, SLOT_BYTES);
  if (key.every((byte) => byte === 0)) key[0] = 1;
  return key;
}

export class RejectedParentSet {
  private table: Table | undefined;
  private readonly window = Buffer.alloc(WINDOW_BYTES);
  private readonly io: TableIO;

  constructor(
    private readonly options: {
      readonly directory?: string;
      readonly io?: TableIO;
    } = {},
  ) {
    this.io = options.io ?? { read: readSync, write: writeSync };
  }

  has(id: string): boolean {
    return this.table !== undefined && this.locate(this.table, keyOf(id)).found;
  }

  async add(id: string): Promise<void> {
    this.table ??= this.create(1024);
    const key = keyOf(id);
    if (this.locate(this.table, key).found) return;
    if ((this.table.count + 1) * 2 > this.table.capacity) this.grow();
    this.insert(this.table, key);
    this.writeHeader(this.table);
  }

  clear(): void {
    const table = this.table;
    if (table === undefined) return;
    this.table = undefined;
    try {
      closeSync(table.fd);
    } finally {
      unlinkSync(table.path);
    }
  }

  dispose(): void {
    this.clear();
  }

  private create(capacity: number): Table {
    const path = join(
      this.options.directory ?? getScratchRoot(),
      `responses-rejections-${randomUUID()}`,
    );
    const table = { fd: openSync(path, 'wx+'), path, capacity, count: 0 };
    try {
      ftruncateSync(table.fd, HEADER_BYTES + capacity * SLOT_BYTES);
      this.writeHeader(table);
      return table;
    } catch (error) {
      try {
        closeSync(table.fd);
      } finally {
        unlinkSync(path);
      }
      throw error;
    }
  }

  private writeHeader(table: Table): void {
    const header = Buffer.alloc(HEADER_BYTES);
    header.write('LLXRJSET');
    header.writeBigUInt64LE(BigInt(table.capacity), 8);
    header.writeBigUInt64LE(BigInt(table.count), 16);
    this.write(table.fd, header, 0);
  }

  private read(
    fd: number,
    buffer: Buffer,
    length: number,
    position: number,
  ): void {
    let offset = 0;
    while (offset < length) {
      const count = this.io.read(
        fd,
        buffer,
        offset,
        length - offset,
        position + offset,
      );
      if (count === 0) throw new Error('Truncated rejected-parent table');
      offset += count;
    }
  }

  private write(fd: number, buffer: Buffer, position: number): void {
    let offset = 0;
    while (offset < buffer.length) {
      const count = this.io.write(
        fd,
        buffer,
        offset,
        buffer.length - offset,
        position + offset,
      );
      if (count === 0)
        throw new Error('Rejected-parent table write made no progress');
      offset += count;
    }
  }

  private locate(
    table: Table,
    key: Buffer,
  ): { readonly slot: number; readonly found: boolean } {
    let slot = Number(key.readBigUInt64LE() % BigInt(table.capacity));
    let windowStart = -1;
    for (let visited = 0; visited < table.capacity; visited++) {
      const start = Math.floor(slot / 256) * 256;
      if (windowStart !== start) {
        this.read(
          table.fd,
          this.window,
          WINDOW_BYTES,
          HEADER_BYTES + start * SLOT_BYTES,
        );
        windowStart = start;
      }
      const candidate = this.window.subarray(
        (slot - start) * SLOT_BYTES,
        (slot - start + 1) * SLOT_BYTES,
      );
      if (candidate.equals(key)) return { slot, found: true };
      if (candidate.every((byte) => byte === 0)) return { slot, found: false };
      slot = (slot + 1) % table.capacity;
    }
    throw new Error('Rejected-parent table has no empty slot');
  }

  private insert(table: Table, key: Buffer): void {
    const location = this.locate(table, key);
    if (location.found) return;
    this.write(table.fd, key, HEADER_BYTES + location.slot * SLOT_BYTES);
    table.count++;
  }

  private copySlots(table: Table, chunk: Buffer, length: number): void {
    for (let at = 0; at < length; at += SLOT_BYTES) {
      const key = chunk.subarray(at, at + SLOT_BYTES);
      if (!key.every((byte) => byte === 0)) this.insert(table, key);
    }
  }

  private grow(): void {
    const previous = this.table;
    if (previous === undefined)
      throw new Error('Missing rejected-parent table');
    const next = this.create(previous.capacity * 2);
    try {
      const chunk = Buffer.alloc(1024 * 1024);
      for (
        let position = 0;
        position < previous.capacity * SLOT_BYTES;
        position += chunk.length
      ) {
        const length = Math.min(
          chunk.length,
          previous.capacity * SLOT_BYTES - position,
        );
        this.read(previous.fd, chunk, length, HEADER_BYTES + position);
        this.copySlots(next, chunk, length);
      }
      this.writeHeader(next);
    } catch (error) {
      try {
        closeSync(next.fd);
      } finally {
        unlinkSync(next.path);
      }
      throw error;
    }
    this.table = next;
    try {
      closeSync(previous.fd);
    } finally {
      unlinkSync(previous.path);
    }
  }
}
