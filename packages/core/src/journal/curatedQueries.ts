/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import { ROW_FLAG } from './rowRecord.js';
import { readRowTreeNode, type RowTreeRootRef } from './rowTreeReader.js';
import { JournalFormatError } from './errors.js';

async function curatedAfter(
  access: RecordAccess,
  offset: number,
  label: bigint,
): Promise<RowEntry | undefined> {
  const node = await readRowTreeNode(access, offset);
  if (node.kind === 'leaf')
    return node.entries.find(
      (entry) => entry.label > label && (entry.flags & ROW_FLAG.curated) !== 0,
    );
  for (const slot of node.slots) {
    if (slot.maxLabel <= label || slot.aggregate.curated === 0) continue;
    const entry = await curatedAfter(access, slot.childOffset, label);
    if (entry !== undefined) return entry;
  }
  return undefined;
}

export async function nextCuratedEntry(
  access: RecordAccess,
  root: RowTreeRootRef,
  total: number,
  label: bigint,
): Promise<RowEntry | undefined> {
  if (total === 0) return undefined;
  return curatedAfter(access, root.offset, label);
}

export async function curatedEntryAt(
  access: RecordAccess,
  root: RowTreeRootRef,
  total: number,
  index: number,
): Promise<RowEntry> {
  return (await curatedEntryWithOrdinalAt(access, root, total, index)).entry;
}

export async function curatedEntryWithOrdinalAt(
  access: RecordAccess,
  root: RowTreeRootRef,
  total: number,
  index: number,
): Promise<{ readonly entry: RowEntry; readonly ordinal: number }> {
  if (!Number.isInteger(index) || index < 0 || index >= total)
    throw new RangeError('Curated row index is out of range');
  let within = index;
  let ordinal = 0;
  let node = await readRowTreeNode(access, root.offset);
  while (node.kind === 'internal') {
    let next: number | undefined;
    for (const slot of node.slots) {
      if (within < slot.aggregate.curated) {
        next = slot.childOffset;
        break;
      }
      within -= slot.aggregate.curated;
      ordinal += slot.count;
    }
    if (next === undefined)
      throw new JournalFormatError('Curated aggregate exceeds its children');
    node = await readRowTreeNode(access, next);
  }
  for (const entry of node.entries) {
    if ((entry.flags & ROW_FLAG.curated) !== 0) {
      if (within === 0) return { entry, ordinal };
      within--;
    }
    ordinal++;
  }
  throw new JournalFormatError('Curated aggregate exceeds its entries');
}
