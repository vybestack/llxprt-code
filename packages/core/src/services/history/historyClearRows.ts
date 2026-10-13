/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { replaceAllOps } from './historyReplaceOps.js';
import type { HistoryJournalStore } from './historyJournalStore.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';
import { mergeRemovedInteriorSpans } from './contextRange.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import type { HistoryReadCursor } from '../../recording/synchronousHistoryCursor.js';

function restoreClearedRows(
  journal: HistoryJournalStore,
  cursor: HistoryReadCursor,
  admitted: boolean,
): unknown[] {
  if (!admitted) return [];
  try {
    // The journal is empty after the clear; one transaction makes a crash
    // during the restore leave it empty rather than partly restored.
    for (const op of replaceAllOps(cursor.rows())) journal.apply(op);
    return [];
  } catch (error) {
    return [error];
  }
}

export function clearHistoryRows(input: {
  readonly journal: HistoryJournalStore;
  readonly spans: readonly RemovedInteriorSpan[];
  readonly rollbackOnFailure: boolean;
  readonly publish: (spans: RemovedInteriorSpan[]) => void;
  readonly restore: () => void;
}): void {
  const captured = input.journal.capturePendingFold();
  try {
    input.journal.adoptMutationBoundary(captured.durableTail);
  } finally {
    captured.release();
  }
  input.journal.withReadRows((cursor) => {
    const cutSeq = cursor.length === 0 ? undefined : cursor.chronologySeqAt(0);
    const lastSeq =
      cursor.length === 0
        ? 0
        : (cursor.chronologySeqAt(cursor.length - 1) ?? 0);
    const firstSeq = cutSeq ?? 0;
    const spans =
      cursor.length === 0
        ? mergeRemovedInteriorSpans(input.spans)
        : mergeRemovedInteriorSpans([
            ...input.spans.filter((span) => span.start > lastSeq),
            { start: firstSeq, end: lastSeq, reason: 'cleared' },
          ]);
    let admitted = false;
    // The clear and its restore reach the mirrors together or not at all, so a
    // restored row is never seen without the owner its original had.
    const publication = input.journal.openPublication();
    let published = true;
    try {
      if (cursor.length > 0) {
        input.journal.apply({
          kind: 'rewind',
          itemsRemoved: cursor.length,
          cutSeq,
        });
        admitted = true;
      }
      input.publish(spans);
    } catch (error) {
      if (!input.rollbackOnFailure) throw error;
      input.restore();
      const failures = restoreClearedRows(input.journal, cursor, admitted);
      published = failures.length > 0;
      throw historyMutationFailure(error, failures);
    } finally {
      publication.close(published);
    }
  });
}
