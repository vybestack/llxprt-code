/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import { ROW_FLAG } from './rowRecord.js';
import { readRowTreeNode, type RowTreeRootRef } from './rowTreeReader.js';
import { JournalFormatError } from './errors.js';

async function curatedThrough(
  access: RecordAccess,
  root: RowTreeRootRef,
  label: bigint,
): Promise<number> {
  let node = await readRowTreeNode(access, root.offset);
  let count = 0;
  while (node.kind === 'internal') {
    let next: number | undefined;
    for (const slot of node.slots) {
      if (slot.maxLabel <= label) count += slot.aggregate.curated;
      else {
        next = slot.childOffset;
        break;
      }
    }
    if (next === undefined) return count;
    node = await readRowTreeNode(access, next);
  }
  return (
    count +
    node.entries.filter(
      (entry) => entry.label <= label && (entry.flags & ROW_FLAG.curated) !== 0,
    ).length
  );
}

export async function nextCuratedEntry(
  access: RecordAccess,
  root: RowTreeRootRef,
  total: number,
  label: bigint,
): Promise<RowEntry | undefined> {
  let within = await curatedThrough(access, root, label);
  if (within === total) return undefined;
  let node = await readRowTreeNode(access, root.offset);
  while (node.kind === 'internal') {
    let next: number | undefined;
    for (const slot of node.slots) {
      if (within < slot.aggregate.curated) {
        next = slot.childOffset;
        break;
      }
      within -= slot.aggregate.curated;
    }
    if (next === undefined)
      throw new JournalFormatError('Curated aggregate exceeds its children');
    node = await readRowTreeNode(access, next);
  }
  const entry = node.entries
    .filter((candidate) => (candidate.flags & ROW_FLAG.curated) !== 0)
    .find((_, index) => index === within);
  if (entry === undefined)
    throw new JournalFormatError('Curated aggregate exceeds its entries');
  return entry;
}
