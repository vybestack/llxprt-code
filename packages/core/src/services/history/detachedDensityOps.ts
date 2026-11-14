/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { isDeepStrictEqual } from 'node:util';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import type { DetachedHistoryJournal } from './detachedHistoryJournal.js';
import { batchDensityOps, type DensityChange } from './historyDiskDensity.js';
import type { HistoryJournalOp } from './historyStorePort.js';

/**
 * Walks a density candidate against the journal it was derived from. A
 * density pass keeps every surviving row at the chronology position of its
 * source row, so each previous row is either removed, replaced in place or
 * kept. Returns false when the candidate is not of that shape.
 */
function* densityChanges(
  previous: DetachedHistoryJournal,
  next: DetachedHistoryJournal,
): Generator<DensityChange, boolean, unknown> {
  const upcoming: Iterator<IContent> = next[Symbol.iterator]();
  try {
    let pending = upcoming.next();
    for (const original of previous) {
      const seq = original.metadata?.chronology?.seq;
      if (typeof seq !== 'number') return false;
      const candidate = pending.done === true ? undefined : pending.value;
      if (candidate?.metadata?.chronology?.seq !== seq) {
        yield { seq };
        continue;
      }
      pending = upcoming.next();
      if (!isDeepStrictEqual(original, candidate))
        yield { seq, replacement: candidate };
    }
    return pending.done === true;
  } finally {
    upcoming.return?.();
  }
}

function isDensityShape(
  previous: DetachedHistoryJournal,
  next: DetachedHistoryJournal,
): boolean {
  const changes = densityChanges(previous, next);
  for (;;) {
    const step = changes.next();
    if (step.done === true) return step.value;
  }
}

/**
 * The compact `density_mutation` records for a density pass, or undefined when
 * the candidate is not a density shape (a row without a chronology marker, or
 * a row that is not at its source position). Large passes are split into
 * bounded records; each record is atomic on its own.
 */
export function densityShapeOps(
  previous: DetachedHistoryJournal,
  next: DetachedHistoryJournal,
  ownership?: RowOwnership,
): Iterable<HistoryJournalOp> | undefined {
  if (!isDensityShape(previous, next)) return undefined;
  const changes = (function* (): Generator<DensityChange, void, unknown> {
    if (!(yield* densityChanges(previous, next)))
      throw new Error('Density shape changed while publishing');
  })();
  return batchDensityOps(changes, ownership);
}
