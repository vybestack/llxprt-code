/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { OccurrencePlanner } from './groupEdits.js';
import type { IdOccurrence } from './idFactUpdate.js';
import { OCCURRENCE_KIND } from './idKeys.js';
import { ROW_ID_KIND } from './rowRecord.js';

/**
 * Every id sits at its own row, part 0 and unit 0, in a unit of the row's
 * speaker. The normalizer of phase 5 replaces this; until then the journal
 * only records what the planner gives it.
 */
export const planOwnRowOccurrences: OccurrencePlanner = (row) => {
  const occurrences: IdOccurrence[] = row.ids.map((id) => ({
    rawId: id.rawId,
    kind:
      id.kind === ROW_ID_KIND.call
        ? OCCURRENCE_KIND.call
        : OCCURRENCE_KIND.response,
    at: { label: row.label, part: 0, block: id.block },
    partSpeaker: row.speaker,
    unit: {
      position: { label: row.label, part: 0, unit: 0 },
      speaker: row.speaker,
      leadingTool: false,
    },
    score: id.score,
    nameLen: id.nameLen,
    reconstructed: false,
  }));
  return Promise.resolve(occurrences);
};
