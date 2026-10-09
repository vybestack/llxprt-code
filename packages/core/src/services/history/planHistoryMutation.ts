/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { isDeepStrictEqual } from 'node:util';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import { planDiskDensityMutation } from './historyDiskDensity.js';
import type { HistoryMutationInput } from './historyBatchContracts.js';
import type { DensityResult } from '../../core/compression/types.js';
import type { DensityReplacementRecordShape } from './historyJournalGuards.js';
import type {
  HistoryJournalOp,
  HistoryJournalStore,
} from './historyJournalStore.js';
import {
  historyRowAt,
  type HistoryRowSource,
  type HistoryMutationSnapshot,
} from './historyMutationSnapshot.js';

const MAX_RETAINED_VALUE_OPS = 64;

export function* planMutation(
  previous: HistoryRowSource,
  input: HistoryMutationInput,
  ownership?: RowOwnership,
): Generator<HistoryJournalOp, void, unknown> {
  if (input.diskDensityResult !== undefined) {
    if (
      !('readRow' in previous) ||
      !(input.nextHistory instanceof HistoryDensityRows)
    )
      throw new Error('Disk density requires indexed snapshots and candidates');
    yield* planDiskDensityMutation(
      previous,
      input.nextHistory,
      input.diskDensityResult,
      ownership,
    );
    return;
  }
  if (input.options.replaceAll === true) {
    if (previous.length > 0) yield rewindAllOp(previous);
    for (const content of input.nextHistory) yield { kind: 'content', content };
    return;
  }
  yield* planHistoryMutation(previous, input.nextHistory, ownership);
}

export function planDensityMutation(
  current: HistoryRowSource,
  result: DensityResult,
): HistoryJournalOp[] | null {
  const removedSeqs: number[] = [];
  for (const index of result.removals) {
    const seq = chronSeqOf(historyRowAt(current, index));
    if (seq === null) return null;
    removedSeqs.push(seq);
  }
  const replacements: DensityReplacementRecordShape[] = [];
  for (const [index, replacement] of result.replacements) {
    const seq = chronSeqOf(historyRowAt(current, index));
    if (seq === null) return null;
    replacements.push({ replacedSeq: seq, replacement });
  }
  return [{ kind: 'density', payload: { removedSeqs, replacements } }];
}

export async function compensateMutation(
  journal: HistoryJournalStore,
  previousHistory: HistoryMutationSnapshot,
  input: HistoryMutationInput,
): Promise<void> {
  const nextHistory = input.nextHistory;
  const awaitDurability =
    input.streamPublication !== false &&
    nextHistory instanceof HistoryDensityRows &&
    !previousHistory.hasPendingRows;
  // Every admitted prefix contains at most the old rows plus the new rows.
  // A count-only rewind clears it even if admission stopped before a row
  // needed by a seq-addressed inverse. Replay without another projection.
  journal.apply({
    kind: 'rewind',
    itemsRemoved: previousHistory.length + nextHistory.length,
  });
  if (awaitDurability) await journal.waitForDurable();
  for (const content of previousHistory) {
    journal.apply({ kind: 'content', content });
    if (awaitDurability) await journal.waitForDurable();
  }
}

function chronSeqOf(content: IContent): number | null {
  const seq = content.metadata?.chronology?.seq;
  return typeof seq === 'number' ? seq : null;
}

/** True when `next` extends or truncates `previous` at the same marked positions. */
function isMarkedPrefix(
  previous: HistoryRowSource,
  next: HistoryRowSource,
  length = next.length,
): boolean {
  if (length > previous.length) return false;
  for (let index = 0; index < length; index += 1) {
    const previousSeq = chronSeqOf(historyRowAt(previous, index));
    if (
      previousSeq === null ||
      previousSeq !== chronSeqOf(historyRowAt(next, index))
    ) {
      return false;
    }
  }
  return true;
}

function rewindAllOp(rows: HistoryRowSource): HistoryJournalOp {
  const firstSeq =
    rows.length > 0
      ? (chronSeqOf(historyRowAt(rows, 0)) ?? undefined)
      : undefined;
  return { kind: 'rewind', itemsRemoved: rows.length, cutSeq: firstSeq };
}

function* retainedValueOps(
  previous: HistoryRowSource,
  next: HistoryRowSource,
  length = next.length,
  ownership?: RowOwnership,
): Generator<HistoryJournalOp, void, unknown> {
  for (let index = 0; index < length; index += 1) {
    const old = historyRowAt(previous, index);
    const replacement = historyRowAt(next, index);
    if (replacement === old || isDeepStrictEqual(replacement, old)) continue;
    ownership?.retain(old);
    try {
      ownership?.retain(replacement);
      try {
        yield {
          kind: 'density',
          payload: {
            removedSeqs: [],
            replacements: [{ replacedSeq: chronSeqOf(old) ?? 0, replacement }],
          },
        };
      } finally {
        ownership?.release(replacement);
      }
    } finally {
      ownership?.release(old);
    }
  }
}

function allMarked(previous: HistoryRowSource): boolean {
  for (const row of previous) if (chronSeqOf(row) === null) return false;
  return true;
}

function preferDetachedReplay(
  previous: HistoryRowSource,
  next: HistoryRowSource,
): boolean {
  if (!(next instanceof HistoryDensityRows)) return false;
  let changes = 0;
  for (let index = 0; index < Math.min(previous.length, next.length); index++) {
    const original = historyRowAt(previous, index);
    const replacement = historyRowAt(next, index);
    if (
      chronSeqOf(original) === null ||
      chronSeqOf(original) !== chronSeqOf(replacement)
    )
      return false;
    if (
      !isDeepStrictEqual(original, replacement) &&
      ++changes > MAX_RETAINED_VALUE_OPS
    )
      return true;
  }
  return false;
}

/**
 * Plan the journal ops that turn `previous` into `next`:
 *
 *  - strict marked prefix, shorter → one `rewind` (count + cut seq);
 *  - strict marked prefix, longer → `content` rows for the appended tail;
 *  - single-item whole replacement over a marked history →
 *    `compression_detail` + `compressed` (the compression shape);
 *  - anything else → rewind everything, then re-record `next` in full.
 */
export function* planHistoryMutation(
  previous: HistoryRowSource,
  next: HistoryRowSource,
  ownership?: RowOwnership,
): Generator<HistoryJournalOp, void, unknown> {
  if (preferDetachedReplay(previous, next)) {
    if (previous.length > 0) yield rewindAllOp(previous);
    for (const content of next) yield { kind: 'content', content };
    return;
  }
  if (next.length === previous.length && isMarkedPrefix(previous, next)) {
    yield* retainedValueOps(previous, next, next.length, ownership);
    return;
  }
  if (
    next.length > previous.length &&
    isMarkedPrefix(previous, next, previous.length)
  ) {
    yield* retainedValueOps(previous, next, previous.length, ownership);
    for (let index = previous.length; index < next.length; index++) {
      yield { kind: 'content', content: historyRowAt(next, index) };
    }
    return;
  }
  if (next.length < previous.length && isMarkedPrefix(previous, next)) {
    const firstRemoved = historyRowAt(previous, next.length);
    yield {
      kind: 'rewind',
      itemsRemoved: previous.length - next.length,
      cutSeq: chronSeqOf(firstRemoved) ?? undefined,
    };
    yield* retainedValueOps(previous, next, next.length, ownership);
    return;
  }
  if (next.length === 1 && previous.length > 0 && allMarked(previous)) {
    yield {
      kind: 'compressionDetail',
      payload: {
        fromSeq: chronSeqOf(historyRowAt(previous, 0)) ?? 0,
        toSeq: chronSeqOf(historyRowAt(previous, previous.length - 1)) ?? 0,
        itemsCompressed: previous.length,
      },
    };
    yield {
      kind: 'compressed',
      summary: historyRowAt(next, 0),
      itemsCompressed: previous.length,
    };
    return;
  }
  if (previous.length > 0) yield rewindAllOp(previous);
  for (const content of next) yield { kind: 'content', content };
}
