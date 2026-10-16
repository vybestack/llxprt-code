/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from './aggregate.js';
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import type { RowTreeAlgebra, RowTreeRoot } from './rowTreeBuilder.js';
import {
  ROW_TREE_ARITY,
  encodeRowTreeNode,
  type ChildSlot,
} from './rowTreeNode.js';
import { readRowTreeNode, type RowTreeRootRef } from './rowTreeReader.js';

/**
 * Changes to the entries of a tree, by label. A replacement takes the place of
 * the live entry with its label; an insert adds an entry for a label that is
 * not live. Both lists may be in any order.
 */
export interface RowTreeEdits {
  readonly replace: readonly RowEntry[];
  readonly insert: readonly RowEntry[];
}

interface EditOp {
  readonly entry: RowEntry;
  readonly replaces: boolean;
}

/** The slots, all pointing at nodes of one level, that replace an edited node. */
interface Edited {
  readonly level: number;
  readonly slots: readonly ChildSlot[];
}

function fail(message: string): never {
  throw new JournalFormatError(message);
}

function compareLabels(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Sorted operations; one label can carry only one of them. */
function sortedOps(edits: RowTreeEdits): EditOp[] {
  const ops: EditOp[] = [
    ...edits.replace.map((entry) => ({ entry, replaces: true })),
    ...edits.insert.map((entry) => ({ entry, replaces: false })),
  ].sort((left, right) => compareLabels(left.entry.label, right.entry.label));
  for (let index = 1; index < ops.length; index++) {
    if (ops[index].entry.label === ops[index - 1].entry.label) {
      fail(`Two edits name label ${ops[index].entry.label}`);
    }
  }
  return ops;
}

/**
 * How an overfull node is cut. The rightmost node of a level fills to the
 * arity from the left, as an append does, so rows added at the end do not leave
 * half-empty nodes behind. Any other node is cut evenly, so a later insert
 * into either half has room.
 */
export function splitSizes(total: number, rightmost: boolean): number[] {
  if (total <= ROW_TREE_ARITY) return [total];
  if (rightmost) {
    const sizes = new Array<number>(Math.floor(total / ROW_TREE_ARITY)).fill(
      ROW_TREE_ARITY,
    );
    if (total % ROW_TREE_ARITY > 0) sizes.push(total % ROW_TREE_ARITY);
    return sizes;
  }
  const parts = Math.ceil(total / ROW_TREE_ARITY);
  const base = Math.floor(total / parts);
  const larger = total % parts;
  return Array.from({ length: parts }, (_, index) =>
    index < larger ? base + 1 : base,
  );
}

function mergeLeaf(
  entries: readonly RowEntry[],
  ops: readonly EditOp[],
): RowEntry[] {
  const merged: RowEntry[] = [];
  let next = 0;
  const takeInserts = (below: bigint | undefined): void => {
    while (
      next < ops.length &&
      (below === undefined || ops[next].entry.label < below)
    ) {
      if (ops[next].replaces) {
        fail(`Row ${ops[next].entry.label} is not live, so it cannot change`);
      }
      merged.push(ops[next].entry);
      next += 1;
    }
  };
  for (const existing of entries) {
    takeInserts(existing.label);
    if (next < ops.length && ops[next].entry.label === existing.label) {
      if (!ops[next].replaces) {
        fail(`Row ${existing.label} is already live, so it cannot be added`);
      }
      merged.push(ops[next].entry);
      next += 1;
    } else {
      merged.push(existing);
    }
  }
  takeInserts(undefined);
  return merged;
}

/** The operations for each child: the first child whose largest label reaches the label, or the last. */
function partition(
  slots: readonly ChildSlot[],
  ops: readonly EditOp[],
): EditOp[][] {
  const groups: EditOp[][] = slots.map(() => []);
  let child = 0;
  for (const op of ops) {
    while (child < slots.length - 1 && slots[child].maxLabel < op.entry.label) {
      child += 1;
    }
    groups[child].push(op);
  }
  return groups;
}

class RowTreeEditor {
  constructor(
    private readonly access: RecordAccess,
    private readonly appender: RecordAppender,
    private readonly algebra: RowTreeAlgebra,
  ) {}

  async edit(
    root: RowTreeRootRef,
    ops: readonly EditOp[],
  ): Promise<RowTreeRoot> {
    const edited = await this.editNode(root.offset, ops, true);
    let { level, slots } = edited;
    while (slots.length > 1) {
      level += 1;
      slots = await this.writeInternals(level, slots, true);
    }
    return { ...slots[0], level };
  }

  private async editNode(
    offset: number,
    ops: readonly EditOp[],
    rightmost: boolean,
  ): Promise<Edited> {
    const node = await readRowTreeNode(this.access, offset);
    if (node.kind === 'leaf') {
      const entries = mergeLeaf(node.entries, ops);
      return { level: 0, slots: await this.writeLeaves(entries, rightmost) };
    }
    const groups = partition(node.slots, ops);
    const slots: ChildSlot[] = [];
    for (const [index, slot] of node.slots.entries()) {
      if (groups[index].length === 0) {
        slots.push(slot);
        continue;
      }
      const last = rightmost && index === node.slots.length - 1;
      slots.push(
        ...(await this.editNode(slot.childOffset, groups[index], last)).slots,
      );
    }
    return {
      level: node.level,
      slots: await this.writeInternals(node.level, slots, rightmost),
    };
  }

  private async writeLeaves(
    entries: readonly RowEntry[],
    rightmost: boolean,
  ): Promise<ChildSlot[]> {
    const slots: ChildSlot[] = [];
    let from = 0;
    for (const size of splitSizes(entries.length, rightmost)) {
      const chunk = entries.slice(from, from + size);
      from += size;
      slots.push(
        await this.writeNode(
          encodeRowTreeNode({ kind: 'leaf', entries: chunk }),
          chunk.length,
          chunk[chunk.length - 1].label,
          chunk.map((entry) => this.algebra.aggregateOf(entry)),
        ),
      );
    }
    return slots;
  }

  private async writeInternals(
    level: number,
    children: readonly ChildSlot[],
    rightmost: boolean,
  ): Promise<ChildSlot[]> {
    const slots: ChildSlot[] = [];
    let from = 0;
    for (const size of splitSizes(children.length, rightmost)) {
      const chunk = children.slice(from, from + size);
      from += size;
      slots.push(
        await this.writeNode(
          encodeRowTreeNode({ kind: 'internal', level, slots: chunk }),
          chunk.reduce((rows, child) => rows + child.count, 0),
          chunk[chunk.length - 1].maxLabel,
          chunk.map((child) => child.aggregate),
        ),
      );
    }
    return slots;
  }

  private async writeNode(
    record: ReturnType<typeof encodeRowTreeNode>,
    count: number,
    maxLabel: bigint,
    aggregates: readonly Aggregate[],
  ): Promise<ChildSlot> {
    const childOffset = await this.appender.append(record);
    const aggregate = aggregates.reduce(
      (acc, next) => this.algebra.compose(acc, next),
      this.algebra.empty,
    );
    return { childOffset, maxLabel, count, aggregate };
  }
}

/**
 * Applies label-keyed replacements and inserts to a tree by path copying
 * (design 3.2, 4.6): every node on a path to a changed leaf is written again,
 * a node that overflows is cut in two (or more), and a root that overflows
 * gets a parent. Nodes left of, right of, and below the paths stay shared with
 * the previous version. Returns the new root. A replacement of a label that is
 * not live and an insert of one that is live throw.
 */
export async function editRowTree(
  access: RecordAccess,
  appender: RecordAppender,
  algebra: RowTreeAlgebra,
  root: RowTreeRootRef,
  edits: RowTreeEdits,
): Promise<RowTreeRoot> {
  const ops = sortedOps(edits);
  if (ops.length === 0) fail('A tree edit needs at least one change');
  return new RowTreeEditor(access, appender, algebra).edit(root, ops);
}
