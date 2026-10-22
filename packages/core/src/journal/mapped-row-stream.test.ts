/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { retainedAfterSettling } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { mapRowStream } from './mapped-row-stream.js';

function ownedSource(): {
  stream: AsyncGenerator<number>;
  source: WeakRef<object>;
  row: WeakRef<object>;
} {
  const source = {
    row: { bytes: new Uint8Array(4 * 1024 * 1024) },
    done: false,
    [Symbol.iterator]() {
      return this;
    },
    next(): IteratorResult<{ bytes: Uint8Array }> {
      if (this.done) return { done: true, value: undefined };
      this.done = true;
      return { done: false, value: this.row };
    },
  };
  return {
    stream: mapRowStream(source, (row) => row.bytes.length),
    source: new WeakRef(source),
    row: new WeakRef(source.row),
  };
}

describe('mapped journal row streams', () => {
  it('pulls one row at a time and closes the source on an early return', async () => {
    let pulled = 0;
    let closed = false;
    async function* source(): AsyncGenerator<number> {
      try {
        for (let row = 1; row <= 3; row++) {
          pulled++;
          yield row;
        }
      } finally {
        closed = true;
      }
    }
    const stream = mapRowStream(source(), (row) => row * 2);
    expect(pulled).toBe(0);
    expect(await stream.next()).toStrictEqual({ done: false, value: 2 });
    expect(pulled).toBe(1);

    await stream.return(undefined);

    expect(closed).toBe(true);
    expect(pulled).toBe(1);
  });

  it('drops the input iterator and its last row while the finished output is still held', async () => {
    const { stream, source, row } = ownedSource();
    expect(await stream.next()).toStrictEqual({
      done: false,
      value: 4 * 1024 * 1024,
    });
    expect(await stream.next()).toStrictEqual({ done: true, value: undefined });

    expect(await retainedAfterSettling([source, row])).toBe(0);
    expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
  });

  it('propagates a mapper failure and closes the source', async () => {
    const failure = new Error('row conversion failed');
    let closed = false;
    async function* source(): AsyncGenerator<number> {
      try {
        yield 1;
        yield 2;
      } finally {
        closed = true;
      }
    }
    const stream = mapRowStream(source(), () => {
      throw failure;
    });

    await expect(stream.next()).rejects.toBe(failure);
    expect(closed).toBe(true);
  });
});
