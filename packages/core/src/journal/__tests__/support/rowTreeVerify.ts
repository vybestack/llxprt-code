/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import type { Aggregate } from '../../aggregate.js';
import {
  EMPTY_AGGREGATE,
  composeAggregates,
  type SlotKinds,
} from '../../aggregateComposition.js';
import type { RecordAccess } from '../../recordAccess.js';
import type { RowEntry } from '../../rowEntry.js';
import {
  iterateRowEntries,
  readRowTreeNode,
  type RowTreeRootRef,
} from '../../rowTreeReader.js';
import { naiveAggregate } from './rowTreeFixtures.js';

export async function collectRows(
  access: RecordAccess,
  root: RowTreeRootRef,
  from = 0,
): Promise<RowEntry[]> {
  const rows: RowEntry[] = [];
  for await (const entry of iterateRowEntries(access, root, from)) {
    rows.push(entry);
  }
  return rows;
}

export interface Verified {
  readonly count: number;
  readonly level: number;
  readonly maxLabel: bigint;
  readonly aggregate: Aggregate;
}

/**
 * Walks a node and returns what it covers, worked out from its leaves alone.
 * Every internal slot must describe its child exactly: row count, largest
 * label and the aggregate of the child's own items.
 */
export async function verifyNodes(
  access: RecordAccess,
  offset: number,
  kinds: SlotKinds,
  expectedLevel?: number,
): Promise<Verified> {
  const node = await readRowTreeNode(access, offset);
  if (node.kind === 'leaf') {
    expect(expectedLevel ?? 0).toBe(0);
    return {
      count: node.entries.length,
      level: 0,
      maxLabel: node.entries[node.entries.length - 1].label,
      aggregate: naiveAggregate(node.entries, kinds),
    };
  }
  expect(expectedLevel ?? node.level).toBe(node.level);
  let folded = EMPTY_AGGREGATE;
  let count = 0;
  for (const slot of node.slots) {
    const child = await verifyNodes(
      access,
      slot.childOffset,
      kinds,
      node.level - 1,
    );
    expect(slot.count).toBe(child.count);
    expect(slot.maxLabel).toBe(child.maxLabel);
    expect(slot.aggregate).toStrictEqual(child.aggregate);
    folded = composeAggregates(folded, child.aggregate, kinds);
    count += child.count;
  }
  return {
    count,
    level: node.level,
    maxLabel: node.slots[node.slots.length - 1].maxLabel,
    aggregate: folded,
  };
}
