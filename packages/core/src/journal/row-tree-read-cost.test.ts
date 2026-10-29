/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { encodeBodylessFrame } from './frame.js';
import { createRecordAccess } from './recordAccess.js';
import { encodeRowTreeNode } from './rowTreeNode.js';
import { readRowTreeNode } from './rowTreeReader.js';
import {
  syntheticEntry,
  NO_KINDS,
} from './__tests__/support/rowTreeFixtures.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

describe('row tree positional read cost', () => {
  it('reuses immutable tree bytes across repeated pinned lookups', async () => {
    const random = new SeededRandom(1);
    const entries = Array.from({ length: 8 }, (_, index) =>
      syntheticEntry(random, index, NO_KINDS),
    );
    const record = encodeRowTreeNode({ kind: 'leaf', entries });
    const frame = encodeBodylessFrame(record.kind, record.kindHeader);
    const bytes = new Uint8Array(64 * 1024);
    bytes.set(frame);
    bytes.set(frame, 32 * 1024);
    let readBytes = 0;
    const access = createRecordAccess(
      'pinned-read-cost',
      {
        async readAt(position, length): Promise<Uint8Array> {
          readBytes += length;
          return bytes.slice(position, position + length);
        },
      },
      { selfOffset: 0, durableEnd: bytes.length },
      true,
    );

    for (let lookup = 0; lookup < 16; lookup++) {
      expect(await readRowTreeNode(access, 0)).toStrictEqual({
        kind: 'leaf',
        entries,
      });
    }
    expect(readBytes).toBeLessThanOrEqual(16 * 1024);
    const firstReadBytes = readBytes;
    await readRowTreeNode(access, 32 * 1024);
    expect(readBytes).toBeLessThanOrEqual(firstReadBytes * 2);
    const bothReadBytes = readBytes;
    await readRowTreeNode(access, 0);
    expect(readBytes - bothReadBytes).toBe(0);
  });

  it('does not prefetch neighboring payloads from a published metadata read', async () => {
    const entries = [syntheticEntry(new SeededRandom(1), 0, NO_KINDS)];
    const record = encodeRowTreeNode({ kind: 'leaf', entries });
    const frame = encodeBodylessFrame(record.kind, record.kindHeader);
    const bytes = new Uint8Array(64 * 1024);
    bytes.set(frame);
    let furthestRead = 0;
    const access = createRecordAccess(
      'published-metadata',
      {
        async readAt(position, length): Promise<Uint8Array> {
          furthestRead = Math.max(furthestRead, position + length);
          return bytes.slice(position, position + length);
        },
      },
      { selfOffset: 0, durableEnd: bytes.length },
      true,
      true,
    );
    expect(await readRowTreeNode(access, 0)).toStrictEqual({
      kind: 'leaf',
      entries,
    });
    expect(furthestRead).toBeLessThanOrEqual(frame.length);
  });

  it.each([1, 8])(
    'reads a %i-entry node with one descriptor read',
    async (count) => {
      const random = new SeededRandom(1);
      const entries = Array.from({ length: count }, (_, index) =>
        syntheticEntry(random, index, NO_KINDS),
      );
      const record = encodeRowTreeNode({ kind: 'leaf', entries });
      const bytes = encodeBodylessFrame(record.kind, record.kindHeader);
      let reads = 0;
      const access = createRecordAccess(
        'read-cost',
        {
          async readAt(position, length): Promise<Uint8Array> {
            reads += 1;
            return bytes.slice(position, position + length);
          },
        },
        { selfOffset: 0, durableEnd: bytes.length },
      );

      expect(await readRowTreeNode(access, 0)).toStrictEqual({
        kind: 'leaf',
        entries,
      });
      expect(reads).toBe(1);
    },
  );
});
