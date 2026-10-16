/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  AGGREGATE_BYTES,
  decodeAggregate,
  encodeAggregateInto,
  type Aggregate,
} from './aggregate.js';
import {
  assertAllZero,
  getU64,
  getU64Big,
  putU8,
  putU32,
  putU64,
  putU64Big,
  span,
  viewOf,
} from './bytes.js';
import { JournalFormatError } from './errors.js';
import { BODY_CRC_BYTES, FRAME_HEAD_BYTES } from './frame.js';
import type { GroupRecord } from './groupWriter.js';
import { RECORD_KIND } from './recordKinds.js';
import {
  ROW_ENTRY_BYTES,
  decodeRowEntry,
  encodeRowEntryInto,
  type RowEntry,
} from './rowEntry.js';

/** Leaves hold up to 8 entries and internal nodes up to 8 children (design 3.2). */
export const ROW_TREE_ARITY = 8;
/** Level, entry or child count, and zero bytes. */
export const ROW_TREE_NODE_HEADER_BYTES = 16;
/** `{childOffset, maxLabel, count, Aggregate}` is 1,164 bytes, padded to 1,168. */
export const CHILD_SLOT_BYTES = 1168;

/** The largest frame of an `RTNODE` (a full internal node), so one read gets any node. */
export const ROW_TREE_MAX_FRAME_BYTES =
  FRAME_HEAD_BYTES +
  ROW_TREE_NODE_HEADER_BYTES +
  ROW_TREE_ARITY * CHILD_SLOT_BYTES +
  BODY_CRC_BYTES;

const NODE_HEADER_LAYOUT = {
  level: span(0, 1),
  count: span(1, 1),
  reserved: span(2, 14),
};

export const CHILD_SLOT_LAYOUT = {
  childOffset: span(0, 8),
  maxLabel: span(8, 8),
  count: span(16, 4),
  aggregate: span(20, AGGREGATE_BYTES),
  pad: span(20 + AGGREGATE_BYTES, 4),
};

/** What a parent knows about one child: where it is, its largest label, its row count and range aggregate. */
export interface ChildSlot {
  readonly childOffset: number;
  readonly maxLabel: bigint;
  readonly count: number;
  readonly aggregate: Aggregate;
}

export interface LeafNode {
  readonly kind: 'leaf';
  readonly entries: readonly RowEntry[];
}

export interface InternalNode {
  readonly kind: 'internal';
  /** 1 for the parent of leaves. */
  readonly level: number;
  readonly slots: readonly ChildSlot[];
}

export type RowTreeNode = LeafNode | InternalNode;

function fail(message: string): never {
  throw new JournalFormatError(message);
}

function assertCount(count: number): void {
  if (count < 1 || count > ROW_TREE_ARITY) {
    fail(`A row tree node holds 1 to ${ROW_TREE_ARITY} items, not ${count}`);
  }
}

function assertSlot(slot: ChildSlot): void {
  if (slot.count !== slot.aggregate.rows) {
    fail(
      `Child slot counts ${slot.count} rows but its aggregate covers ${slot.aggregate.rows}`,
    );
  }
  if (slot.childOffset === 0) fail('Child slot has no child offset');
}

function assertAscending(labels: readonly bigint[], what: string): void {
  for (let index = 1; index < labels.length; index++) {
    if (labels[index] <= labels[index - 1]) {
      fail(`${what} do not ascend: ${labels[index - 1]} then ${labels[index]}`);
    }
  }
}

function allocateNode(level: number, count: number, itemBytes: number) {
  const bytes = new Uint8Array(ROW_TREE_NODE_HEADER_BYTES + count * itemBytes);
  const view = viewOf(bytes);
  putU8(view, NODE_HEADER_LAYOUT.level.offset, 'level', level);
  putU8(view, NODE_HEADER_LAYOUT.count.offset, 'count', count);
  return { bytes, view };
}

function encodeLeaf(node: LeafNode): Uint8Array {
  assertCount(node.entries.length);
  assertAscending(
    node.entries.map((entry) => entry.label),
    'Leaf labels',
  );
  const { bytes } = allocateNode(0, node.entries.length, ROW_ENTRY_BYTES);
  node.entries.forEach((entry, index) =>
    encodeRowEntryInto(
      bytes,
      ROW_TREE_NODE_HEADER_BYTES + index * ROW_ENTRY_BYTES,
      entry,
    ),
  );
  return bytes;
}

function encodeInternal(node: InternalNode): Uint8Array {
  assertCount(node.slots.length);
  if (node.level < 1)
    fail(`An internal node has level 1 or more, not ${node.level}`);
  assertAscending(
    node.slots.map((slot) => slot.maxLabel),
    'Child slot labels',
  );
  const { bytes, view } = allocateNode(
    node.level,
    node.slots.length,
    CHILD_SLOT_BYTES,
  );
  node.slots.forEach((slot, index) => {
    assertSlot(slot);
    const base = ROW_TREE_NODE_HEADER_BYTES + index * CHILD_SLOT_BYTES;
    const L = CHILD_SLOT_LAYOUT;
    putU64(view, base + L.childOffset.offset, 'childOffset', slot.childOffset);
    putU64Big(view, base + L.maxLabel.offset, 'maxLabel', slot.maxLabel);
    putU32(view, base + L.count.offset, 'count', slot.count);
    encodeAggregateInto(bytes, base + L.aggregate.offset, slot.aggregate);
  });
  return bytes;
}

/**
 * An `RTNODE` record. The whole node is the kind header and the record has no
 * body, so the frame CRC covers it and one read verifies it.
 */
export function encodeRowTreeNode(node: RowTreeNode): GroupRecord {
  const kindHeader =
    node.kind === 'leaf' ? encodeLeaf(node) : encodeInternal(node);
  return { kind: RECORD_KIND.RTNODE, kindHeader };
}

function decodeLeaf(bytes: Uint8Array, count: number): LeafNode {
  const entries: RowEntry[] = [];
  for (let index = 0; index < count; index++) {
    entries.push(
      decodeRowEntry(
        bytes,
        ROW_TREE_NODE_HEADER_BYTES + index * ROW_ENTRY_BYTES,
      ),
    );
  }
  assertAscending(
    entries.map((entry) => entry.label),
    'Leaf labels',
  );
  return { kind: 'leaf', entries };
}

function decodeSlot(
  bytes: Uint8Array,
  view: DataView,
  base: number,
): ChildSlot {
  const L = CHILD_SLOT_LAYOUT;
  assertAllZero(
    bytes,
    base + L.pad.offset,
    base + L.pad.offset + L.pad.size,
    'Child slot padding',
  );
  const slot: ChildSlot = {
    childOffset: getU64(view, base + L.childOffset.offset, 'childOffset'),
    maxLabel: getU64Big(view, base + L.maxLabel.offset),
    count: view.getUint32(base + L.count.offset, true),
    aggregate: decodeAggregate(bytes, base + L.aggregate.offset),
  };
  assertSlot(slot);
  return slot;
}

function decodeInternal(
  bytes: Uint8Array,
  level: number,
  count: number,
): InternalNode {
  const view = viewOf(bytes);
  const slots: ChildSlot[] = [];
  for (let index = 0; index < count; index++) {
    slots.push(
      decodeSlot(
        bytes,
        view,
        ROW_TREE_NODE_HEADER_BYTES + index * CHILD_SLOT_BYTES,
      ),
    );
  }
  assertAscending(
    slots.map((slot) => slot.maxLabel),
    'Child slot labels',
  );
  return { kind: 'internal', level, slots };
}

/** Decodes the kind header of an `RTNODE` record whose frame has already been verified. */
export function decodeRowTreeNode(kindHeader: Uint8Array): RowTreeNode {
  if (kindHeader.length < ROW_TREE_NODE_HEADER_BYTES) {
    fail(`Row tree node of ${kindHeader.length} bytes has no header`);
  }
  const view = viewOf(kindHeader);
  const level = view.getUint8(NODE_HEADER_LAYOUT.level.offset);
  const count = view.getUint8(NODE_HEADER_LAYOUT.count.offset);
  const reserved = NODE_HEADER_LAYOUT.reserved;
  assertAllZero(
    kindHeader,
    reserved.offset,
    reserved.offset + reserved.size,
    'Row tree node header',
  );
  assertCount(count);
  const itemBytes = level === 0 ? ROW_ENTRY_BYTES : CHILD_SLOT_BYTES;
  const expected = ROW_TREE_NODE_HEADER_BYTES + count * itemBytes;
  if (kindHeader.length !== expected) {
    fail(
      `Row tree node of level ${level} with ${count} items must be ${expected} bytes, got ${kindHeader.length}`,
    );
  }
  return level === 0
    ? decodeLeaf(kindHeader, count)
    : decodeInternal(kindHeader, level, count);
}
