/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { Aggregate } from './aggregate.js';
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import type { RowEntry } from './rowEntry.js';
import {
  ROW_TREE_ARITY,
  encodeRowTreeNode,
  type ChildSlot,
  type RowTreeNode,
} from './rowTreeNode.js';

/**
 * What the tree needs to know about aggregates, injected so the tree does not
 * depend on how an entry's facts are turned into one (they come from the
 * writer: design 3.2 lists the fields and 2.5 the combine rules).
 */
export interface RowTreeAlgebra {
  /** The aggregate of a single row. */
  aggregateOf(entry: RowEntry): Aggregate;
  /** The aggregate of two adjacent ranges, `left` before `right`. */
  compose(left: Aggregate, right: Aggregate): Aggregate;
  /** The aggregate of no rows, the identity of `compose`. */
  readonly empty: Aggregate;
}

/** The root node as its parent would describe it, plus its level (0 for a single leaf). */
export interface RowTreeRoot extends ChildSlot {
  readonly level: number;
}

/**
 * The rightmost node of every level, root to leaf order reversed: `leaf` holds
 * the entries of the last leaf and `internal[k]` the child slots of the last
 * node of level `k + 1`. The writer keeps this between groups, so an append
 * reads nothing from the file.
 */
export interface RightSpine {
  readonly leaf: readonly RowEntry[];
  readonly internal: ReadonlyArray<readonly ChildSlot[]>;
}

export interface RowTreeState {
  readonly root: RowTreeRoot;
  readonly spine: RightSpine;
}

/**
 * Builds the right edge of a tree bottom-up from entries in label order. Each
 * level holds one node under construction, so memory is the depth times the
 * arity. A node is written when its level is full and another item arrives (a
 * node is never written ahead of its last item, so the final node of a level
 * is written with whatever it holds). Starting from the right spine of an
 * existing tree, the same procedure rewrites only that spine: the nodes it
 * leaves behind keep serving every version that reaches them.
 */
class RowTreeAssembler {
  private leaf: RowEntry[] = [];
  /** `pending[k]` is the node under construction at level `k + 1`. */
  private pending: ChildSlot[][] = [];
  /** Nodes already written at each level, or standing to the left of the spine. */
  private writtenAtLevel: number[] = [];
  private lastLabel = 0n;

  constructor(
    private readonly appender: RecordAppender,
    private readonly algebra: RowTreeAlgebra,
    spine: RightSpine | undefined,
  ) {
    if (spine !== undefined) this.resume(spine);
  }

  async add(entry: RowEntry): Promise<void> {
    if (entry.label <= this.lastLabel) {
      throw new JournalFormatError(
        `Row labels must ascend: ${entry.label} follows ${this.lastLabel}`,
      );
    }
    this.lastLabel = entry.label;
    if (this.leaf.length === ROW_TREE_ARITY) {
      await this.push(1, await this.writeLeaf());
    }
    this.leaf.push(entry);
  }

  /** Writes the nodes still under construction, leaf to root, and returns the tree. */
  async finish(): Promise<RowTreeState | undefined> {
    if (this.leaf.length === 0) return undefined;
    const spineLeaf = [...this.leaf];
    const spineInternal: ChildSlot[][] = [];
    let level = 0;
    // A node with nothing written beside it on its level is the root.
    let hasLeftSibling = this.written(0) > 0;
    let slot = await this.writeLeaf();
    while (hasLeftSibling) {
      level += 1;
      await this.push(level, slot);
      spineInternal.push([...this.nodeAt(level)]);
      hasLeftSibling = this.written(level) > 0;
      slot = await this.writeInternal(level);
    }
    return {
      root: { ...slot, level },
      spine: { leaf: spineLeaf, internal: spineInternal },
    };
  }

  /** Continue from the rightmost path of an existing tree. */
  private resume(spine: RightSpine): void {
    this.leaf = [...spine.leaf];
    this.lastLabel = spine.leaf[spine.leaf.length - 1].label;
    // The last slot of each internal node names the node below it on the spine,
    // which is rewritten, so it is not kept.
    this.pending = spine.internal.map((slots) => slots.slice(0, -1));
    let leftOfSpine = false;
    for (let index = spine.internal.length - 1; index >= 0; index--) {
      this.writtenAtLevel[index + 1] = leftOfSpine ? 1 : 0;
      leftOfSpine = leftOfSpine || spine.internal[index].length >= 2;
    }
    this.writtenAtLevel[0] = leftOfSpine ? 1 : 0;
  }

  private written(level: number): number {
    return this.writtenAtLevel[level] ?? 0;
  }

  private nodeAt(level: number): ChildSlot[] {
    this.pending[level - 1] ??= [];
    return this.pending[level - 1];
  }

  private async writeLeaf(): Promise<ChildSlot> {
    const entries = this.leaf;
    const slot = await this.writeNode(
      { kind: 'leaf', entries },
      entries.length,
      entries[entries.length - 1].label,
      entries.map((entry) => this.algebra.aggregateOf(entry)),
    );
    this.leaf = [];
    this.writtenAtLevel[0] = this.written(0) + 1;
    return slot;
  }

  private async writeInternal(level: number): Promise<ChildSlot> {
    const slots = this.nodeAt(level);
    const slot = await this.writeNode(
      { kind: 'internal', level, slots },
      slots.reduce((rows, child) => rows + child.count, 0),
      slots[slots.length - 1].maxLabel,
      slots.map((child) => child.aggregate),
    );
    this.pending[level - 1] = [];
    this.writtenAtLevel[level] = this.written(level) + 1;
    return slot;
  }

  private async writeNode(
    node: RowTreeNode,
    count: number,
    maxLabel: bigint,
    aggregates: readonly Aggregate[],
  ): Promise<ChildSlot> {
    const childOffset = await this.appender.append(encodeRowTreeNode(node));
    const aggregate = aggregates.reduce(
      (acc, next) => this.algebra.compose(acc, next),
      this.algebra.empty,
    );
    return { childOffset, maxLabel, count, aggregate };
  }

  /** Adds a child slot to the node under construction at `level`, writing the node first if it is full. */
  private async push(level: number, slot: ChildSlot): Promise<void> {
    if (this.nodeAt(level).length === ROW_TREE_ARITY) {
      const written = await this.writeInternal(level);
      await this.push(level + 1, written);
    }
    this.nodeAt(level).push(slot);
  }
}

/**
 * Builds a whole tree from entries in ascending label order, such as the rows
 * of a replace or a rebuild after compression. The nodes are appended to the
 * group as they complete, so memory stays proportional to the depth however
 * many entries the iterable yields. Returns undefined for no entries.
 */
export async function bulkBuildRowTree(
  appender: RecordAppender,
  algebra: RowTreeAlgebra,
  entries: Iterable<RowEntry> | AsyncIterable<RowEntry>,
): Promise<RowTreeState | undefined> {
  const assembler = new RowTreeAssembler(appender, algebra, undefined);
  for await (const entry of entries) await assembler.add(entry);
  return assembler.finish();
}

/**
 * Appends rows to the end of a tree as part of the current group. Only the
 * right spine is rewritten (one leaf and one node per internal level, plus any
 * nodes that fill up on the way); everything left of it is shared with the
 * previous version. `spine` is undefined for an empty tree. A group that
 * appends no rows has no tree change to make, so there is nothing to call.
 */
export async function appendRowEntries(
  appender: RecordAppender,
  algebra: RowTreeAlgebra,
  spine: RightSpine | undefined,
  entries: Iterable<RowEntry> | AsyncIterable<RowEntry>,
): Promise<RowTreeState> {
  const assembler = new RowTreeAssembler(appender, algebra, spine);
  for await (const entry of entries) await assembler.add(entry);
  const state = await assembler.finish();
  if (state === undefined) {
    throw new JournalFormatError('A row append needs at least one entry');
  }
  return state;
}
