/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

export class DumpScratch<T> {
  private readonly root: string;
  private readonly data: number;
  private readonly index: number;

  constructor() {
    this.root = createScratchDirSync('llxprt-dump-scratch-');
    let data: number | undefined;
    try {
      data = fs.openSync(path.join(this.root, 'data'), 'wx+', 0o600);
      this.index = fs.openSync(path.join(this.root, 'index'), 'wx+', 0o600);
      this.data = data;
    } catch (error) {
      try {
        if (data !== undefined) fs.closeSync(data);
      } finally {
        fs.rmSync(this.root, { recursive: true, force: true });
      }
      throw error;
    }
  }
  private readonly slot = Buffer.alloc(16);
  private bytes = 0;
  private count = 0;
  private closed = false;

  get length(): number {
    return this.count;
  }

  append(value: T): number {
    const id = this.count;
    this.replace(id, value);
    this.count++;
    return id;
  }

  replace(id: number, value: T): void {
    if (this.closed) throw new Error('Dump scratch is closed');
    const encoded = Buffer.from(JSON.stringify(value), 'utf8');
    this.writeAll(this.data, encoded, this.bytes);
    this.slot.writeDoubleLE(this.bytes, 0);
    this.slot.writeDoubleLE(encoded.length, 8);
    this.writeAll(this.index, this.slot, id * 16);
    this.bytes += encoded.length;
  }

  read(id: number): T {
    if (this.closed || id < 0 || id >= this.count)
      throw new RangeError('Invalid dump scratch row');
    if (fs.readSync(this.index, this.slot, 0, 16, id * 16) !== 16)
      throw new Error('Truncated dump scratch index');
    const offset = this.slot.readDoubleLE(0);
    const encoded = Buffer.alloc(this.slot.readDoubleLE(8));
    let read = 0;
    while (read < encoded.length) {
      const size = fs.readSync(
        this.data,
        encoded,
        read,
        encoded.length - read,
        offset + read,
      );
      if (size === 0) throw new Error('Truncated dump scratch data');
      read += size;
    }
    return JSON.parse(encoded.toString('utf8'));
  }

  private writeAll(fd: number, buffer: Buffer, position: number): void {
    let written = 0;
    while (written < buffer.length) {
      const size = fs.writeSync(
        fd,
        buffer,
        written,
        buffer.length - written,
        position + written,
      );
      if (size === 0) throw new Error('Dump scratch write made no progress');
      written += size;
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      fs.closeSync(this.data);
    } finally {
      try {
        fs.closeSync(this.index);
      } finally {
        fs.rmSync(this.root, { recursive: true, force: true });
      }
    }
  }
}
