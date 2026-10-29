/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalFormatError } from './errors.js';
import type { RecordAccess } from './recordAccess.js';
import type { RowEntry } from './rowEntry.js';
import { readRowTreeNode, type RowTreeRootRef } from './rowTreeReader.js';

export interface IndexedRowEntry {
  readonly entry: RowEntry;
  readonly ordinal: number;
}

async function* below(
  access: RecordAccess,
  offset: number,
  labels: readonly bigint[],
  from: number,
  to: number,
  ordinal: number,
): AsyncGenerator<IndexedRowEntry | undefined> {
  const node = await readRowTreeNode(access, offset);
  if (node.kind === 'leaf') {
    let entry = 0;
    for (let index = from; index < to; index++) {
      const label = labels[index];
      while (entry < node.entries.length && node.entries[entry].label < label)
        entry += 1;
      yield node.entries[entry]?.label === label
        ? { entry: node.entries[entry], ordinal: ordinal + entry }
        : undefined;
    }
    return;
  }
  let at = from;
  let base = ordinal;
  for (const slot of node.slots) {
    const start = at;
    while (at < to && labels[at] <= slot.maxLabel) at += 1;
    if (start < at)
      yield* below(access, slot.childOffset, labels, start, at, base);
    if (at === to) return;
    base += slot.count;
  }
  for (; at < to; at++) yield undefined;
}

/** Reads the union of the requested paths, holding only one tree path and one result. */
export async function* indexedEntriesByLabels(
  access: RecordAccess,
  root: RowTreeRootRef | undefined,
  labels: readonly bigint[],
): AsyncGenerator<IndexedRowEntry | undefined> {
  for (let index = 1; index < labels.length; index++) {
    if (labels[index] <= labels[index - 1])
      throw new JournalFormatError('Requested row labels must ascend strictly');
  }
  if (labels.length === 0) return;
  if (root === undefined) {
    for (let index = 0; index < labels.length; index++) yield undefined;
    return;
  }
  yield* below(access, root.offset, labels, 0, labels.length, 0);
}

export async function* entriesByLabels(
  access: RecordAccess,
  root: RowTreeRootRef | undefined,
  labels: readonly bigint[],
): AsyncGenerator<RowEntry | undefined> {
  for await (const found of indexedEntriesByLabels(access, root, labels))
    yield found?.entry;
}
