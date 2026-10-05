/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryRowSource } from './historyMutationSnapshot.js';
import type { ContextRange, RemovedInteriorSpan } from './historyEventTypes.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';

/** Derive the boundary without retaining content rows. Span output is unchanged. */
export function buildRowContextRangeSnapshot(
  rows: HistoryRowSource,
  accumulated: readonly RemovedInteriorSpan[],
): ContextRange {
  let firstSeq = 0;
  let lastSeq = 0;
  let totalEntries = 0;
  let approximate = false;
  const spans: RemovedInteriorSpan[] = [];
  for (const row of rows) {
    const marker = row.metadata?.chronology;
    if (totalEntries++ === 0) firstSeq = marker?.seq ?? 0;
    lastSeq = marker?.seq ?? 0;
    approximate ||= marker === undefined;
    const replaced = row.metadata?.chronologyReplaced;
    if (replaced !== undefined) {
      spans.push({
        start: replaced.fromSeq,
        end: replaced.toSeq,
        reason: 'compressed',
      });
    }
  }
  return {
    firstSeq,
    lastSeq,
    totalEntries,
    approximate,
    removedInterior: mergeRemovedInteriorSpans([
      ...accumulated,
      ...(approximate ? [] : spans),
    ]),
  };
}
