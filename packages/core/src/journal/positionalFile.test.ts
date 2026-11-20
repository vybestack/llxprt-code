/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  MAX_BUFFERS_PER_WRITEV,
  writeBuffersAt,
  type VectoredWriteTarget,
} from './positionalFile.js';

interface Call {
  readonly position: number;
  readonly lengths: readonly number[];
}

/** An in-memory file whose writev takes at most `limit` bytes per call. */
function fakeTarget(limit = Number.MAX_SAFE_INTEGER) {
  const calls: Call[] = [];
  const file = new Uint8Array(4096);
  const target: VectoredWriteTarget = {
    writev: (buffers, position) => {
      calls.push({ position, lengths: buffers.map((buffer) => buffer.length) });
      let at = position;
      let taken = 0;
      for (const buffer of buffers) {
        const take = Math.min(buffer.length, limit - taken);
        file.set(buffer.subarray(0, take), at);
        at += take;
        taken += take;
        if (take < buffer.length) break;
      }
      return Promise.resolve({ bytesWritten: taken });
    },
  };
  return { target, calls, file };
}

const bytes = (...values: number[]) => new Uint8Array(values);

describe('writeBuffersAt', () => {
  it('writes every buffer at the position with one call', async () => {
    const { target, calls, file } = fakeTarget();

    await writeBuffersAt(target, [bytes(1, 2), bytes(3), bytes(4, 5, 6)], 10);

    expect(calls).toStrictEqual([{ position: 10, lengths: [2, 1, 3] }]);
    expect(file.subarray(10, 16)).toStrictEqual(bytes(1, 2, 3, 4, 5, 6));
  });

  it('continues after a short write, mid-buffer, at the right position', async () => {
    const { target, calls, file } = fakeTarget(4);

    await writeBuffersAt(target, [bytes(1, 2, 3), bytes(4, 5, 6), bytes(7)], 0);

    expect(file.subarray(0, 7)).toStrictEqual(bytes(1, 2, 3, 4, 5, 6, 7));
    expect(calls[0]).toStrictEqual({ position: 0, lengths: [3, 3, 1] });
    expect(calls[1]).toStrictEqual({ position: 4, lengths: [2, 1] });
  });

  it('splits a list longer than the vector limit across calls', async () => {
    const { target, calls, file } = fakeTarget();
    const buffers = Array.from(
      { length: MAX_BUFFERS_PER_WRITEV * 2 + 3 },
      (_, i) => bytes((i % 250) + 1),
    );

    await writeBuffersAt(target, buffers, 0);

    expect(calls.map((call) => call.lengths.length)).toStrictEqual([
      MAX_BUFFERS_PER_WRITEV,
      MAX_BUFFERS_PER_WRITEV,
      3,
    ]);
    expect(file.subarray(0, buffers.length)).toStrictEqual(
      Uint8Array.from(buffers.map((buffer) => buffer[0])),
    );
  });

  it('writes nothing for no buffers', async () => {
    const { target, calls } = fakeTarget();

    await writeBuffersAt(target, [], 0);

    expect(calls).toStrictEqual([]);
  });

  it('throws when a call makes no progress', async () => {
    const target: VectoredWriteTarget = {
      writev: () => Promise.resolve({ bytesWritten: 0 }),
    };

    await expect(writeBuffersAt(target, [bytes(1)], 0)).rejects.toThrow(
      'no progress',
    );
  });
});
