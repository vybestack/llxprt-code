/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { ROW_FLAG, ROW_SPEAKER } from './rowRecord.js';
import type { RecordAccess } from './recordAccess.js';
import { JournalFormatError } from './errors.js';
import { unitCount } from './unitContributions.js';
import type { RowEntry } from './rowEntry.js';
import { readRowTreeNode, type RowTreeRootRef } from './rowTreeReader.js';

export async function hasAssistantToolCalls(
  access: RecordAccess,
  root: RowTreeRootRef | undefined,
  excluded: ReadonlySet<bigint>,
): Promise<boolean> {
  if (root === undefined) return false;
  const node = await readRowTreeNode(access, root.offset);
  if (node.kind === 'leaf')
    return node.entries.some((entry) => {
      if (excluded.has(entry.label) || (entry.flags & ROW_FLAG.curated) === 0)
        return false;
      return (
        entry.reconBlocks > 0 ||
        (entry.toolCallBlocks > 0 && entry.speaker !== ROW_SPEAKER.human)
      );
    });
  for (const slot of node.slots)
    if (
      (slot.aggregate.callRows > 0 || slot.aggregate.reconRows > 0) &&
      (await hasAssistantToolCalls(
        access,
        { offset: slot.childOffset, rows: slot.count },
        excluded,
      ))
    )
      return true;
  return false;
}

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

/**
 * The entry of the live row `label`, or undefined when no row has it.
 * `root` undefined is an empty tree.
 */
export async function entryByLabel(
  access: RecordAccess,
  root: RowTreeRootRef | undefined,
  label: bigint,
): Promise<RowEntry | undefined> {
  if (root === undefined) return undefined;
  let node = await readRowTreeNode(access, root.offset);
  while (node.kind === 'internal') {
    const next = node.slots.find((slot) => slot.maxLabel >= label);
    if (next === undefined) return undefined;
    node = await readRowTreeNode(access, next.childOffset);
  }
  return node.entries.find((entry) => entry.label === label);
}
export interface IndexedUnit {
  readonly entry: RowEntry;
  readonly unit: number;
}

export async function countUnitsBelow(
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
      if (slot.maxLabel < cut) below += slot.aggregate.units;
      else {
        next = slot.childOffset;
        break;
      }
    }
    if (next === undefined) return below;
    node = await readRowTreeNode(access, next);
  }
  for (const entry of node.entries) {
    if (entry.label >= cut) break;
    below += unitCount(entry);
  }
  return below;
}

export async function entryAtUnit(
  access: RecordAccess,
  root: RowTreeRootRef | undefined,
  units: number,
  index: number,
): Promise<IndexedUnit> {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= units ||
    root === undefined
  )
    throw new RangeError(
      `Unit index ${index} is outside a tree of ${units} units`,
    );
  let node = await readRowTreeNode(access, root.offset);
  let within = index;
  while (node.kind === 'internal') {
    let next: number | undefined;
    for (const slot of node.slots) {
      if (within < slot.aggregate.units) {
        next = slot.childOffset;
        break;
      }
      within -= slot.aggregate.units;
    }
    if (next === undefined)
      throw new JournalFormatError('Unit aggregate exceeds its children');
    node = await readRowTreeNode(access, next);
  }
  for (const entry of node.entries) {
    const count = unitCount(entry);
    if (within < count) return { entry, unit: within };
    within -= count;
  }
  throw new JournalFormatError('Unit aggregate exceeds its entries');
}

export async function humanRowOrdinal(
  access: RecordAccess,
  root: RowTreeRootRef,
  index: number,
): Promise<number> {
  let node = await readRowTreeNode(access, root.offset);
  let ordinal = 0;
  let remaining = index;
  while (node.kind === 'internal') {
    let next: number | undefined;
    for (const slot of node.slots) {
      if (remaining < slot.aggregate.humanRows) {
        next = slot.childOffset;
        break;
      }
      remaining -= slot.aggregate.humanRows;
      ordinal += slot.count;
    }
    if (next === undefined)
      throw new JournalFormatError('Human aggregate exceeds its children');
    node = await readRowTreeNode(access, next);
  }
  for (const entry of node.entries) {
    if (entry.speaker === ROW_SPEAKER.human && remaining-- === 0)
      return ordinal;
    ordinal++;
  }
  throw new JournalFormatError('Human aggregate exceeds its entries');
}
