/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
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
    for (const content of cursor.rows())
      journal.apply({ kind: 'content', content });
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
      throw historyMutationFailure(
        error,
        restoreClearedRows(input.journal, cursor, admitted),
      );
    }
  });
}
