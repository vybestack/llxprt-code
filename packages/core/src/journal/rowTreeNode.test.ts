/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { AGGREGATE_BYTES } from './aggregate.js';
import { JournalFormatError } from './errors.js';
import { decodeFrameStart, encodeBodylessFrame, frameLength } from './frame.js';
import { RECORD_KIND } from './recordKinds.js';
import { ROW_ENTRY_BYTES } from './rowEntry.js';
import {
  CHILD_SLOT_BYTES,
  ROW_TREE_ARITY,
  ROW_TREE_NODE_HEADER_BYTES,
  decodeRowTreeNode,
  encodeRowTreeNode,
  type ChildSlot,
  type RowTreeNode,
} from './rowTreeNode.js';
import {
  TEST_KINDS,
  syntheticEntry,
  testAggregateOf,
} from './__tests__/support/rowTreeFixtures.js';
import { SeededRandom } from './__tests__/support/seededRandom.js';

const entries = (count: number) => {
  const random = new SeededRandom(count);
  return Array.from({ length: count }, (_, index) =>
    syntheticEntry(random, index, TEST_KINDS),
  );
};

function slots(count: number): ChildSlot[] {
  return entries(count).map((entry, index) => ({
    childOffset: 5000 + index * 9000,
    maxLabel: entry.label,
    count: 1,
    aggregate: testAggregateOf(entry),
  }));
}

function leaf(count: number): RowTreeNode {
  return { kind: 'leaf', entries: entries(count) };
}

function internal(count: number, level = 1): RowTreeNode {
  return { kind: 'internal', level, slots: slots(count) };
}

function frameBytes(node: RowTreeNode): number {
  const record = encodeRowTreeNode(node);
  return frameLength(record.kindHeader.length, record.body?.length ?? 0);
}

describe('RTNODE sizes (design 3.2)', () => {
  it('has arity 8, a 16-byte node header and 1,232-byte child slots', () => {
    expect(ROW_TREE_ARITY).toBe(8);
    expect(ROW_TREE_NODE_HEADER_BYTES).toBe(16);
    expect(CHILD_SLOT_BYTES).toBe(1232);
    expect(8 + 8 + 4 + AGGREGATE_BYTES).toBeLessThanOrEqual(CHILD_SLOT_BYTES);
  });

  it('is 9,000 bytes for a full leaf and 9,896 for a full internal node, with the frame', () => {
    expect(frameBytes(leaf(8))).toBe(9000);
    expect(frameBytes(internal(8))).toBe(9896);
    expect(8 * ROW_ENTRY_BYTES + ROW_TREE_NODE_HEADER_BYTES).toBe(8976);
    expect(8 * CHILD_SLOT_BYTES + ROW_TREE_NODE_HEADER_BYTES).toBe(9872);
  });

  it('takes only the bytes of the entries or slots it holds', () => {
    expect(frameBytes(leaf(1))).toBe(9000 - 7 * ROW_ENTRY_BYTES);
    expect(frameBytes(internal(3))).toBe(9896 - 5 * CHILD_SLOT_BYTES);
  });

  it('is an RTNODE record with no body, so the frame CRC covers all of it', () => {
    const record = encodeRowTreeNode(leaf(2));

    expect(record.kind).toBe(RECORD_KIND.RTNODE);
    expect(record.body).toBeUndefined();
  });
});

describe('RTNODE codec', () => {
  for (const count of [1, 2, 7, 8]) {
    it(`round-trips a leaf of ${count} through its frame`, () => {
      const node = leaf(count);
      const record = encodeRowTreeNode(node);

      const decoded = decodeRowTreeNode(record.kindHeader);

      expect(decoded).toStrictEqual(node);
    });

    it(`round-trips an internal node of ${count} slots`, () => {
      const node = internal(count, 3);
      const record = encodeRowTreeNode(node);

      expect(decodeRowTreeNode(record.kindHeader)).toStrictEqual(node);
    });
  }

  it('survives the real frame encoding', () => {
    const node = internal(5, 2);
    const record = encodeRowTreeNode(node);

    const head = decodeFrameStart(
      encodeBodylessFrame(record.kind, record.kindHeader),
      0,
    );

    expect(decodeRowTreeNode(head.kindHeader)).toStrictEqual(node);
  });

  it('refuses a node of no entries or of more than eight', () => {
    expect(() => encodeRowTreeNode({ kind: 'leaf', entries: [] })).toThrow(
      JournalFormatError,
    );
    expect(() => encodeRowTreeNode(leaf(9))).toThrow(JournalFormatError);
    expect(() => encodeRowTreeNode(internal(9))).toThrow(JournalFormatError);
  });

  it('refuses a leaf whose labels do not ascend', () => {
    const [first, second] = entries(2);

    expect(() =>
      encodeRowTreeNode({ kind: 'leaf', entries: [second, first] }),
    ).toThrow(JournalFormatError);
  });

  it('refuses a slot whose count differs from its aggregate rows', () => {
    const [slot] = slots(1);

    expect(() =>
      encodeRowTreeNode({
        kind: 'internal',
        level: 1,
        slots: [{ ...slot, count: 2 }],
      }),
    ).toThrow(JournalFormatError);
  });

  it('refuses stored nodes that break the format', () => {
    const good = encodeRowTreeNode(internal(3, 2)).kindHeader;
    const corrupt = (change: (bytes: Uint8Array) => void): Uint8Array => {
      const bytes = good.slice();
      change(bytes);
      return bytes;
    };

    expect(() => decodeRowTreeNode(corrupt((bytes) => (bytes[1] = 0)))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeRowTreeNode(corrupt((bytes) => (bytes[1] = 9)))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeRowTreeNode(corrupt((bytes) => (bytes[5] = 1)))).toThrow(
      JournalFormatError,
    );
    expect(() => decodeRowTreeNode(good.subarray(0, good.length - 1))).toThrow(
      JournalFormatError,
    );
    expect(() =>
      decodeRowTreeNode(
        corrupt((bytes) => {
          bytes[ROW_TREE_NODE_HEADER_BYTES + 1228] = 7;
        }),
      ),
    ).toThrow(JournalFormatError);
  });
});
