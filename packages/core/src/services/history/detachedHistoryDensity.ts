/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import type { DetachedHistorySink } from './detachedHistoryMutation.js';
import type { DensitySpanRows } from './densitySpanRows.js';
import { validateHistoryEntry } from './historyBatchContracts.js';

export function detachedHistorySink(
  previous: DetachedHistoryJournal,
  next: DetachedHistoryJournal,
  spans: DensitySpanRows,
  assertActive: () => void,
): DetachedHistorySink {
  return {
    appendValue: async (row): Promise<void> => {
      assertActive();
      validateHistoryEntry(row, next.length);
      next.append(row);
    },
    appendReplacement: async (ordinal, row): Promise<void> => {
      assertActive();
      validateHistoryEntry(row, next.length);
      const marker = previous.readOriginalMarker(ordinal).chronology;
      next.append(
        marker === undefined
          ? row
          : { ...row, metadata: { ...row.metadata, chronology: marker } },
      );
      if (marker !== undefined)
        spans.append({
          start: marker.seq,
          end: marker.seq,
          reason: 'density-replaced',
        });
    },
    removeValue: async (ordinal): Promise<void> => {
      assertActive();
      const marker = previous.readOriginalMarker(ordinal).chronology;
      if (marker !== undefined)
        spans.append({
          start: marker.seq,
          end: marker.seq,
          reason: 'density-removed',
        });
    },
  };
}
