/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  rowReadWindow,
  ROW_READ_WINDOW_BYTES,
  ROW_READ_WINDOW_COUNT,
} from './row-read-window.js';
import type { PositionalReader } from './positionalFile.js';

function sourceReader(bytes: Uint8Array): {
  readonly reader: PositionalReader;
  readonly cost: { reads: number; bytes: number };
} {
  const cost = { reads: 0, bytes: 0 };
  return {
    cost,
    reader: {
      readAt: async (position, length) => {
        cost.reads++;
        cost.bytes += length;
        if (position + length > bytes.length)
          throw new Error('Read exceeded the committed source');
        return bytes.slice(position, position + length);
      },
    },
  };
}

describe('fill-owned bounded ROW reads', () => {
  it('reuses two lookahead ranges without retaining caller-owned slices', async () => {
    const bytes = Uint8Array.from(
      { length: ROW_READ_WINDOW_BYTES * 4 },
      (_, index) => index % 251,
    );
    const { reader, cost } = sourceReader(bytes);
    const window = rowReadWindow(reader, bytes.length);
    const first = await window.readAt(5, 20);
    await window.readAt(ROW_READ_WINDOW_BYTES * 2, 20);
    first.fill(0);
    expect(await window.readAt(5, 20)).toStrictEqual(bytes.slice(5, 25));
    expect(cost.reads).toBe(ROW_READ_WINDOW_COUNT);
    expect(cost.bytes).toBe(ROW_READ_WINDOW_BYTES * ROW_READ_WINDOW_COUNT);
    await window.readAt(ROW_READ_WINDOW_BYTES * 3, 20);
    await window.readAt(5, 20);
    expect(cost.reads).toBe(4);
  });

  it('clips prefetch to the pinned durable end', async () => {
    const bytes = new TextEncoder().encode('committed bytes');
    const { reader, cost } = sourceReader(bytes);
    const window = rowReadWindow(reader, bytes.length);
    expect(await window.readAt(3, 4)).toStrictEqual(bytes.slice(3, 7));
    expect(await window.readAt(7, bytes.length - 7)).toStrictEqual(
      bytes.slice(7),
    );
    expect(cost).toStrictEqual({ reads: 1, bytes: bytes.length - 3 });
  });

  it.each([17, 40, 200])(
    'passes a %s MiB conversion-unit read through without truncation or a cached duplicate',
    async (mib) => {
      const bytes = new Uint8Array(mib * 1024 * 1024);
      bytes[bytes.length - 1] = 127;
      let reads = 0;
      const window = rowReadWindow(
        {
          readAt: async (position, length) => {
            reads++;
            expect(position).toBe(0);
            expect(length).toBe(bytes.length);
            return bytes;
          },
        },
        bytes.length,
      );
      const result = await window.readAt(0, bytes.length);
      expect(result).toBe(bytes);
      expect(result.at(-1)).toBe(127);
      expect(await window.readAt(0, bytes.length)).toBe(bytes);
      expect(reads).toBe(2);
    },
  );

  it('preserves the original physical read failure and does not cache it', async () => {
    const failure = new Error('descriptor failure');
    let reads = 0;
    const window = rowReadWindow(
      {
        readAt: async () => {
          reads++;
          throw failure;
        },
      },
      100,
    );
    await expect(window.readAt(0, 20)).rejects.toBe(failure);
    await expect(window.readAt(0, 20)).rejects.toBe(failure);
    expect(reads).toBe(2);
  });
});
