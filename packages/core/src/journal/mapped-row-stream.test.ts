/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { retainedAfterSettling } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import { mapRowStream } from './mapped-row-stream.js';

async function* closingSource(onClose: () => void): AsyncGenerator<number> {
  try {
    yield 1;
    yield 2;
  } finally {
    onClose();
  }
}

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

  it('releases a mapped row while the output iterator is suspended', async () => {
    const decoded: Array<WeakRef<object>> = [];
    const stream = mapRowStream([1, 2], (value) => {
      const row = { value, bytes: new Uint8Array(4 * 1024 * 1024) };
      decoded.push(new WeakRef(row));
      return row;
    });
    async function consume(): Promise<void> {
      const next = await stream.next();
      expect(next.done).toBe(false);
      expect(next.value?.value).toBe(1);
    }

    await consume();

    expect(await retainedAfterSettling(decoded)).toBe(0);
    expect((await stream.next()).value?.value).toBe(2);
    await stream.return();
  });

  it('serializes concurrent pulls and a return without retaining their results', async () => {
    let closed = false;
    async function* source(): AsyncGenerator<number> {
      try {
        yield 1;
        yield 2;
        yield 3;
      } finally {
        closed = true;
      }
    }
    const stream = mapRowStream(source(), (value) =>
      Promise.resolve(value * 2),
    );
    const first = stream.next();
    const second = stream.next();
    const done = stream.return();
    const after = stream.next();

    expect(await first).toStrictEqual({ done: false, value: 2 });
    expect(await second).toStrictEqual({ done: false, value: 4 });
    expect(await done).toStrictEqual({ done: true, value: undefined });
    expect(await after).toStrictEqual({ done: true, value: undefined });
    expect(closed).toBe(true);
  });

  it('closes the source when a promised return rejects', async () => {
    let closed = false;
    const source = closingSource(() => {
      closed = true;
    });
    const stream = mapRowStream(source, (value) => value * 2);
    expect((await stream.next()).value).toBe(2);
    const failure = new Error('return failed');

    await expect(stream.return(Promise.reject(failure))).rejects.toBe(failure);
    expect(closed).toBe(true);
    expect(await stream.next()).toStrictEqual({ done: true, value: undefined });
  });

  it('propagates a mapper failure and closes the source', async () => {
    const failure = new Error('row conversion failed');
    let closed = false;
    const source = closingSource(() => {
      closed = true;
    });
    const stream = mapRowStream(source, () => {
      throw failure;
    });

    await expect(stream.next()).rejects.toBe(failure);
    expect(closed).toBe(true);
  });
});
