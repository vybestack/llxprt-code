/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { RecordAccess } from './recordAccess.js';
import { readRowTreeNode } from './rowTreeReader.js';
import type { SlotSummary } from './slotSummary.js';
import { decodeSlotSummary } from './slotSummary.js';
import type { FormatSlot } from './slotTable.js';
import {
  composeSlotSummaries,
  identitySlotSummary,
} from './summaryComposition.js';
import { JournalFormatError } from './errors.js';
import type { ChildSlot } from './rowTreeNode.js';

type Selection = {
  readonly label: bigint;
  select(summary: SlotSummary, kept: boolean): SlotSummary;
};
function storedChild(
  child: ChildSlot,
  slot: number,
  format: FormatSlot,
  lower: bigint,
  from: bigint,
  to: bigint,
  selection?: Selection,
): SlotSummary | undefined {
  if (lower < from || child.maxLabel >= to) return undefined;
  if (
    selection !== undefined &&
    selection.label >= lower &&
    selection.label <= child.maxLabel
  )
    return undefined;
  const value = decodeSlotSummary(child.aggregate.summaries[slot], format);
  return selection === undefined ? value : selection.select(value, false);
}

export async function rowSummaryRange(
  access: RecordAccess,
  offset: number,
  slot: number,
  format: FormatSlot,
  from: bigint,
  to: bigint,
  selection?: {
    readonly label: bigint;
    select(summary: SlotSummary, kept: boolean): SlotSummary;
  },
): Promise<SlotSummary> {
  if (format.summaryKind === null)
    throw new JournalFormatError('Range format has no summary kind');
  let summary = identitySlotSummary(format.summaryKind);
  const node = await readRowTreeNode(access, offset);
  if (node.kind === 'leaf') {
    for (const entry of node.entries) {
      if (entry.label < from || entry.label >= to) continue;
      if (entry.stamp[slot].gen !== format.gen)
        throw new JournalFormatError('Range format is stale');
      const value = decodeSlotSummary(entry.summary[slot], format);
      summary = composeSlotSummaries(
        summary,
        selection === undefined
          ? value
          : selection.select(value, entry.label === selection.label),
      );
    }
  } else {
    let lower = 0n;
    for (const child of node.slots) {
      if (child.maxLabel >= from && lower < to) {
        const contribution =
          storedChild(child, slot, format, lower, from, to, selection) ??
          (await rowSummaryRange(
            access,
            child.childOffset,
            slot,
            format,
            from,
            to,
            selection,
          ));
        summary = composeSlotSummaries(summary, contribution);
      }
      lower = child.maxLabel + 1n;
      if (lower >= to) break;
    }
  }
  return summary;
}
