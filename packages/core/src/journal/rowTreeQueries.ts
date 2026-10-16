/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAccess } from './recordAccess.js';
import { readRowTreeNode, type RowTreeRootRef } from './rowTreeReader.js';

/**
 * How many live rows have a label below `cut`: one node per level, chosen by
 * the largest label of each child (design 4.3 step 1). `root` undefined is an
 * empty tree.
 */
export async function countRowsBelow(
  access: RecordAccess,
  root: RowTreeRootRef | undefined,
  cut: bigint,
): Promise<number> {
  if (root === undefined) return 0;
  let node = await readRowTreeNode(access, root.offset);
  let below = 0;
  while (node.kind === 'internal') {
    let next: number | undefined;
    for (const slot of node.slots) {
      if (slot.maxLabel < cut) {
        below += slot.count;
      } else {
        next = slot.childOffset;
        break;
      }
    }
    if (next === undefined) return below;
    node = await readRowTreeNode(access, next);
  }
  return below + node.entries.filter((entry) => entry.label < cut).length;
}
