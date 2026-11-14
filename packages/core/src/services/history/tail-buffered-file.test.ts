/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TailBufferedFile } from './tailBufferedFile.js';

function sequence(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

describe('TailBufferedFile', () => {
  let root: string;
  let fd: number;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'tail-buffered-'));
    fd = openSync(join(root, 'file'), 'w+');
  });
  afterEach(() => {
    closeSync(fd);
    rmSync(root, { recursive: true, force: true });
  });

  it('matches an in-memory model across random appends, rewrites and reads', () => {
    const file = new TailBufferedFile(fd, 64, 'test I/O made no progress');
    const model = Buffer.alloc(4096);
    let end = 0;
    const reads: Buffer[] = [];
    const expected: Buffer[] = [];
    const next = sequence(7);
    for (let step = 0; step < 3000; step++) {
      const choice = next() % 10;
      const size = 1 + (next() % 100);
      if (choice < 6) {
        const bytes = Buffer.alloc(size, next() & 0xff);
        file.write(bytes, end);
        bytes.copy(model, end);
        end += size;
      } else if (choice < 8 && end > 0) {
        const at = next() % end;
        const bytes = Buffer.alloc(Math.min(size, end - at), next() & 0xff);
        file.write(bytes, at);
        bytes.copy(model, at);
      } else if (end > 0) {
        const at = next() % end;
        const bytes = Buffer.alloc(Math.min(size, end - at));
        file.read(bytes, at);
        reads.push(bytes);
        expected.push(Buffer.from(model.subarray(at, at + bytes.length)));
      }
      if (end > 3800) break;
    }
    expect(reads.length).toBeGreaterThan(10);
    expect(reads).toStrictEqual(expected);
    file.release();
    expect(
      readFileSync(join(root, 'file')).equals(model.subarray(0, end)),
    ).toBe(true);
  });

  it('holds back small appends until flushed and passes large writes through', () => {
    const file = new TailBufferedFile(fd, 64, 'test I/O made no progress');
    file.write(Buffer.from('abc'), 0);
    expect(readFileSync(join(root, 'file')).length).toBe(0);
    file.flush();
    expect(readFileSync(join(root, 'file')).toString()).toBe('abc');
    file.write(Buffer.alloc(200, 0x78), 3);
    expect(readFileSync(join(root, 'file')).length).toBe(203);
  });
});
