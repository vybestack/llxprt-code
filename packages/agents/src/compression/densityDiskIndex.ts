/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  ftruncateSync,
  openSync,
  readSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { createScratchDirSync } from '@vybestack/llxprt-code-core/storage/scratch-root.js';

const recordSchema = z.object({ key: z.string(), value: z.array(z.number()) });
const bucketCount = 4096;

export class DensityDiskIndex {
  private readonly root: string;
  private readonly records: number;
  private readonly buckets: number;
  private offset = 0;
  private reads = 0;
  private writes = 0;

  constructor() {
    this.root = createScratchDirSync('density-decision-index-');
    let records: number | undefined;
    let buckets: number | undefined;
    try {
      records = openSync(join(this.root, 'records'), 'w+');
      buckets = openSync(join(this.root, 'buckets'), 'w+');
      this.buckets = buckets;
      this.records = records;
      ftruncateSync(this.buckets, bucketCount * 8);
    } catch (error) {
      this.closeAllocated(buckets, records);
      throw error;
    }
  }

  private closeAllocated(
    buckets: number | undefined,
    records: number | undefined,
  ): void {
    try {
      if (buckets !== undefined) closeSync(buckets);
    } finally {
      try {
        if (records !== undefined) closeSync(records);
      } finally {
        rmSync(this.root, { recursive: true, force: true });
      }
    }
  }

  private bucket(key: string): number {
    return (
      (createHash('sha256').update(key).digest().readUInt32LE(0) %
        bucketCount) *
      8
    );
  }

  get(key: string): readonly number[] | undefined {
    this.reads++;
    const pointer = Buffer.alloc(8);
    transfer(this.buckets, pointer, this.bucket(key), false);
    let next = pointer.readDoubleLE(0);
    const header = Buffer.alloc(16);
    while (next > 0) {
      transfer(this.records, header, next - 1, false);
      const bytes = Buffer.alloc(header.readDoubleLE(8));
      transfer(this.records, bytes, next - 1 + 16, false);
      const record = recordSchema.parse(JSON.parse(bytes.toString('utf8')));
      if (record.key === key) return record.value;
      next = header.readDoubleLE(0);
    }
    return undefined;
  }

  set(key: string, value: readonly number[]): void {
    const bucket = this.bucket(key);
    const pointer = Buffer.alloc(8);
    transfer(this.buckets, pointer, bucket, false);
    const bytes = Buffer.from(JSON.stringify({ key, value }));
    const header = Buffer.alloc(16);
    header.writeDoubleLE(pointer.readDoubleLE(0), 0);
    header.writeDoubleLE(bytes.length, 8);
    transfer(this.records, header, this.offset, true);
    transfer(this.records, bytes, this.offset + 16, true);
    pointer.writeDoubleLE(this.offset + 1);
    transfer(this.buckets, pointer, bucket, true);
    this.offset += 16 + bytes.length;
    this.writes++;
  }

  metrics(): {
    reads: number;
    writes: number;
    diskBytes: number;
    residentIndexBytes: number;
  } {
    return {
      reads: this.reads,
      writes: this.writes,
      diskBytes: this.offset + bucketCount * 8,
      residentIndexBytes: 24,
    };
  }

  close(): void {
    try {
      closeSync(this.buckets);
    } finally {
      try {
        closeSync(this.records);
      } finally {
        rmSync(this.root, { recursive: true, force: true });
      }
    }
  }
}

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
    if (count === 0) throw new Error('Density index I/O made no progress');
    offset += count;
  }
}
