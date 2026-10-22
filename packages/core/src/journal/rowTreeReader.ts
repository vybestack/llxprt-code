/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from './aggregate.js';
import { JournalFormatError } from './errors.js';
import type { RecordAccess } from './recordAccess.js';
import { RECORD_KIND } from './recordKinds.js';
import type { RowEntry } from './rowEntry.js';
import type { RightSpine } from './rowTreeBuilder.js';
import { FRAME_HEAD_BYTES } from './frame.js';
import {
  decodeRowTreeNode,
  type ChildSlot,
  type RowTreeNode,
} from './rowTreeNode.js';
import type { TrailerHeader } from './trailerRecord.js';

/** What a trailer says about the row tree: where the root is and how many rows it covers. */
export interface RowTreeRootRef {
  readonly offset: number;
  readonly rows: number;
}

/** The root named by a trailer, or undefined for an empty tree or a journal with no group. */
export function rowTreeRootOf(
  trailer: TrailerHeader | undefined,
): RowTreeRootRef | undefined {
  if (trailer === undefined || trailer.rowRoot === 0) return undefined;
  return { offset: trailer.rowRoot, rows: trailer.rootAggregate.rows };
}

/** Reads and decodes the `RTNODE` at `offset`; the frame CRC is checked by the access. */
export async function readRowTreeNode(
  access: RecordAccess,
  offset: number,
): Promise<RowTreeNode> {
  const head = await access.readRecordHead(offset, 'RTNODE', FRAME_HEAD_BYTES);
  if (head.kind !== RECORD_KIND.RTNODE || head.bodyLen !== 0) {
    throw new JournalFormatError(
      `Record at offset ${offset} is not a row tree node (kind ${head.kind}, body ${head.bodyLen})`,
    );
  }
  return decodeRowTreeNode(head.kindHeader);
}

function rowsOf(node: RowTreeNode): number {
  return node.kind === 'leaf'
    ? node.entries.length
    : node.slots.reduce((total, slot) => total + slot.count, 0);
}

async function readRoot(
  access: RecordAccess,
  root: RowTreeRootRef,
): Promise<RowTreeNode> {
  const node = await readRowTreeNode(access, root.offset);
  if (rowsOf(node) !== root.rows) {
    throw new JournalFormatError(
      `Row tree root at ${root.offset} covers ${rowsOf(node)} rows, the trailer says ${root.rows}`,
    );
  }
  return node;
}

function assertIndex(index: number, rows: number, inclusiveEnd: boolean): void {
  const limit = inclusiveEnd ? rows : rows - 1;
  if (!Number.isInteger(index) || index < 0 || index > limit) {
    throw new RangeError(
      `Row index ${index} is outside a tree of ${rows} rows`,
    );
  }
}

/** The child of `slots` that holds row `remaining`, and the index of that row inside it. */
function childFor(
  slots: readonly ChildSlot[],
  remaining: number,
): { at: number; within: number } {
  let within = remaining;
  for (let at = 0; at < slots.length; at++) {
    if (within < slots[at].count) return { at, within };
    within -= slots[at].count;
  }
  throw new JournalFormatError(
    `Row ${remaining} lies beyond the children of a node that covers fewer rows`,
  );
}

/** The `index`-th live row (0-based): one node per level, chosen by the row counts of the child slots. */
export async function entryAt(
  access: RecordAccess,
  root: RowTreeRootRef,
  index: number,
): Promise<RowEntry> {
  assertIndex(index, root.rows, false);
  let node = await readRoot(access, root);
  let within = index;
  while (node.kind === 'internal') {
    const next = childFor(node.slots, within);
    within = next.within;
    node = await readRowTreeNode(access, node.slots[next.at].childOffset);
  }
  return node.entries[within];
}

/** An internal node on the path and the next child to visit. */
interface PathFrame {
  readonly slots: readonly ChildSlot[];
  next: number;
}

/** Descends leftmost from `node` to a leaf, pushing a frame for each internal node on the way. */
async function descendLeftmost(
  access: RecordAccess,
  path: PathFrame[],
  first: RowTreeNode,
): Promise<readonly RowEntry[]> {
  let node = first;
  while (node.kind === 'internal') {
    path.push({ slots: node.slots, next: 1 });
    node = await readRowTreeNode(access, node.slots[0].childOffset);
  }
  return node.entries;
}

/** The leaf after the one just finished, or undefined at the end of the tree. */
async function nextLeaf(
  access: RecordAccess,
  path: PathFrame[],
): Promise<readonly RowEntry[] | undefined> {
  while (
    path.length > 0 &&
    path[path.length - 1].next >= path[path.length - 1].slots.length
  ) {
    path.pop();
  }
  if (path.length === 0) return undefined;
  const frame = path[path.length - 1];
  const slot = frame.slots[frame.next];
  frame.next += 1;
  return descendLeftmost(
    access,
    path,
    await readRowTreeNode(access, slot.childOffset),
  );
}

/**
 * Rows in label order from index `from`. The iterator holds the nodes from the
 * root to the current leaf and nothing else, so its memory is the depth: nodes
 * are immutable and have no sibling links, and the stack of parents is the
 * cursor.
 */
export async function* iterateRowEntries(
  access: RecordAccess,
  root: RowTreeRootRef,
  from = 0,
): AsyncGenerator<RowEntry> {
  assertIndex(from, root.rows, true);
  if (from === root.rows) return;
  const path: PathFrame[] = [];
  let node = await readRoot(access, root);
  let within = from;
  while (node.kind === 'internal') {
    const next = childFor(node.slots, within);
    within = next.within;
    path.push({ slots: node.slots, next: next.at + 1 });
    node = await readRowTreeNode(access, node.slots[next.at].childOffset);
  }
  let leaf: readonly RowEntry[] | undefined = node.entries;
  while (leaf !== undefined) {
    for (; within < leaf.length; within++) yield leaf[within];
    within = 0;
    leaf = await nextLeaf(access, path);
  }
}

async function* matchingBelow(
  access: RecordAccess,
  node: RowTreeNode,
  mightMatch: (aggregate: Aggregate) => boolean,
): AsyncGenerator<RowEntry> {
  if (node.kind === 'leaf') {
    yield* node.entries;
    return;
  }
  for (const slot of node.slots) {
    if (!mightMatch(slot.aggregate)) continue;
    const child = await readRowTreeNode(access, slot.childOffset);
    yield* matchingBelow(access, child, mightMatch);
  }
}

/**
 * The entries of the leaves that might hold a match, in label order. A
 * subtree whose aggregate fails `mightMatch` is skipped without being read
 * (design 5.3: the owner bloom keeps a mirror seed from reading the rows of
 * other agents). The entries of a leaf that passes are all yielded, so the
 * caller still tests each one. Memory is the nodes from the root to the
 * current leaf.
 */
export async function* iterateMatchingEntries(
  access: RecordAccess,
  root: RowTreeRootRef,
  rootAggregate: Aggregate,
  mightMatch: (aggregate: Aggregate) => boolean,
): AsyncGenerator<RowEntry> {
  if (!mightMatch(rootAggregate)) return;
  yield* matchingBelow(access, await readRoot(access, root), mightMatch);
}

/**
 * Rebuilds the right spine of a tree from the file, one node per level, for a
 * writer that has just opened it. Afterwards the writer appends without
 * reading.
 */
export async function loadRightSpine(
  access: RecordAccess,
  root: RowTreeRootRef,
): Promise<RightSpine> {
  let node = await readRoot(access, root);
  const internal: Array<readonly ChildSlot[]> = [];
  while (node.kind === 'internal') {
    internal.push(node.slots);
    node = await readRowTreeNode(
      access,
      node.slots[node.slots.length - 1].childOffset,
    );
  }
  return { leaf: node.entries, internal: internal.reverse() };
}
