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

export async function rowSummaryRange(
  access: RecordAccess,
  offset: number,
  slot: number,
  format: FormatSlot,
  from: bigint,
  to: bigint,
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
      summary = composeSlotSummaries(
        summary,
        decodeSlotSummary(entry.summary[slot], format),
      );
    }
  } else {
    let lower = 0n;
    for (const child of node.slots) {
      if (child.maxLabel >= from && lower < to) {
        summary = composeSlotSummaries(
          summary,
          lower >= from && child.maxLabel < to
            ? decodeSlotSummary(child.aggregate.summaries[slot], format)
            : await rowSummaryRange(
                access,
                child.childOffset,
                slot,
                format,
                from,
                to,
              ),
        );
      }
      lower = child.maxLabel + 1n;
      if (lower >= to) break;
    }
  }
  return summary;
}
