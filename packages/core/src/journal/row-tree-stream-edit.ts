/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { RecordAppender } from './groupAppender.js';
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import type { RowTreeAlgebra, RowTreeRoot } from './rowTreeBuilder.js';
import {
  encodeRowTreeNode,
  type ChildSlot,
  type RowTreeNode,
} from './rowTreeNode.js';
import { readRowTreeNode, type RowTreeRootRef } from './rowTreeReader.js';

class ReplacementCursor {
  private current: RowEntry | undefined;
  private previous = 0n;
  constructor(private readonly iterator: AsyncIterator<RowEntry>) {}
  entry(): RowEntry | undefined {
    return this.current;
  }
  async advance(): Promise<void> {
    const next = await this.iterator.next();
    this.current = next.done === true ? undefined : next.value;
    if (this.current === undefined) return;
    if (this.current.label <= this.previous)
      throw new JournalFormatError('Replacement labels must ascend strictly');
    this.previous = this.current.label;
  }
}

/** Sorted replacements share their union of paths while retaining only one replacement and one node per level. */
export async function replaceRowEntriesStream(
  access: RecordAccess,
  appender: RecordAppender,
  algebra: RowTreeAlgebra,
  root: RowTreeRootRef,
  entries: AsyncIterable<RowEntry>,
): Promise<RowTreeRoot | undefined> {
  const iterator = entries[Symbol.asyncIterator]();
  const cursor = new ReplacementCursor(iterator);
  async function write(node: RowTreeNode): Promise<ChildSlot> {
    const aggregate =
      node.kind === 'leaf'
        ? node.entries
            .map((entry) => algebra.aggregateOf(entry))
            .reduce(algebra.compose, algebra.empty)
        : node.slots
            .map((slot) => slot.aggregate)
            .reduce(algebra.compose, algebra.empty);
    const maxLabel =
      node.kind === 'leaf'
        ? node.entries[node.entries.length - 1].label
        : node.slots[node.slots.length - 1].maxLabel;
    return {
      childOffset: await appender.append(encodeRowTreeNode(node)),
      count: aggregate.rows,
      aggregate,
      maxLabel,
    };
  }
  async function visit(offset: number): Promise<RowTreeRoot> {
    const node = await readRowTreeNode(access, offset);
    if (node.kind === 'leaf') {
      const replaced: RowEntry[] = [];
      for (const entry of node.entries) {
        const next = cursor.entry();
        if (next !== undefined && next.label < entry.label)
          throw new JournalFormatError(
            `Replacement row ${next.label} is not live`,
          );
        if (next !== undefined && next.label === entry.label) {
          replaced.push(next);
          await cursor.advance();
        } else replaced.push(entry);
      }
      return {
        ...(await write({ kind: 'leaf', entries: replaced })),
        level: 0,
      };
    }
    const slots: ChildSlot[] = [];
    for (const slot of node.slots) {
      const next = cursor.entry();
      slots.push(
        next !== undefined && next.label <= slot.maxLabel
          ? await visit(slot.childOffset)
          : slot,
      );
    }
    return { ...(await write({ ...node, slots })), level: node.level };
  }
  try {
    await cursor.advance();
    if (cursor.entry() === undefined) return undefined;
    const changed = await visit(root.offset);
    const remaining = cursor.entry();
    if (remaining !== undefined)
      throw new JournalFormatError(
        `Replacement row ${remaining.label} is not live`,
      );
    return changed;
  } finally {
    await iterator.return?.();
  }
}
