/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mergeCommitSpans } from './contextRange.js';
import type { RemovedInteriorSpan } from './historyEventTypes.js';

import { isDeepStrictEqual } from 'node:util';
import type { DensityResultMetadata } from '../../core/compression/types.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import { invalidateResponsesStatefulChain, type IContent } from './IContent.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import type {
  HistoryIndexedRows,
  HistoryMutationSnapshot,
} from './historyMutationSnapshot.js';
import type { HistoryMutationInput } from './historyBatchContracts.js';
import type { HistoryJournalOp } from './historyJournalStore.js';
import { DensitySpanRows } from './densitySpanRows.js';
import { planHistoryMutation } from './planHistoryMutation.js';
import { retryWithBackoff } from '../../utils/retry.js';
import { shouldRetryCompressionError } from '../../core/compression/types.js';

export function projectDensityCommitSpans(
  input: HistoryMutationInput,
  accumulated: readonly RemovedInteriorSpan[],
  previous: HistoryMutationSnapshot,
): RemovedInteriorSpan[] {
  return input.diskDensitySpans === undefined
    ? mergeCommitSpans(
        accumulated,
        input.extraRemovedInterior,
        previous,
        input.nextHistory,
      )
    : input.diskDensitySpans.project(
        accumulated,
        mergeCommitSpans([], undefined, previous, input.nextHistory),
      );
}

export type DensityRowDecision =
  | { readonly kind: 'removed' }
  | { readonly kind: 'replaced'; readonly row: IContent };
export interface DiskDensityResult {
  readonly removalCount: number;
  readonly replacementCount: number;
  readonly metadata: DensityResultMetadata;
  decision(index: number): DensityRowDecision | undefined;
  close(): void;
}
export type DiskDensityOptimizer = (
  source: HistoryIndexedRows,
) => DiskDensityResult;

function captureCandidate(
  previous: HistoryMutationSnapshot,
  result: DiskDensityResult,
  next: HistoryDensityRows,
  ownership?: RowOwnership,
): void {
  let position = 0;
  for (const original of previous) {
    const index = position++;
    const decision = result.decision(index);
    const marker = original.metadata?.chronology;
    if (decision?.kind === 'removed') continue;
    let row =
      decision?.kind === 'replaced'
        ? {
            ...decision.row,
            metadata: {
              ...decision.row.metadata,
              ...(marker === undefined ? {} : { chronology: marker }),
            },
          }
        : original;
    [row] = invalidateResponsesStatefulChain([row]);
    ownership?.retain(row);
    try {
      if (previous.isPendingRow(index)) next.appendSanitized(row);
      else next.append(row);
    } finally {
      ownership?.release(row);
    }
  }
}

function collectDiskDensitySpans(
  previous: HistoryMutationSnapshot,
  result: DiskDensityResult,
  spans: DensitySpanRows,
): void {
  for (const kind of ['removed', 'replaced']) {
    let index = 0;
    for (const original of previous) {
      const decision = result.decision(index++);
      const marker = original.metadata?.chronology;
      if (decision?.kind === kind && marker !== undefined)
        spans.append({
          start: marker.seq,
          end: marker.seq,
          reason: kind === 'removed' ? 'density-removed' : 'density-replaced',
        });
    }
  }
}

export async function withDiskDensityMutation(
  previous: HistoryMutationSnapshot,
  optimize: DiskDensityOptimizer,
  commit: (input: HistoryMutationInput) => Promise<void>,
  estimate: (rows: Iterable<IContent>) => Promise<number>,
  ownership?: RowOwnership,
): Promise<void> {
  const result = optimize(previous);
  try {
    if (result.removalCount === 0 && result.replacementCount === 0) return;
    const next = new HistoryDensityRows(ownership);
    try {
      const spans = new DensitySpanRows();
      try {
        captureCandidate(previous, result, next, ownership);
        collectDiskDensitySpans(previous, result, spans);
        const nextHistoryTokens = await retryWithBackoff(() => estimate(next), {
          maxAttempts: 3,
          initialDelayMs: 2000,
          maxDelayMs: 10000,
          shouldRetryOnError: shouldRetryCompressionError,
        });
        await commit({
          nextHistory: next,
          nextHistoryTokens,
          diskDensityResult: result,
          diskDensitySpans: spans,
          streamPublication: !previous.hasPendingRows,
          options: {},
        });
      } finally {
        spans.close();
      }
    } finally {
      next.close();
    }
  } finally {
    result.close();
  }
}

export function* planDiskDensityMutation(
  previous: HistoryIndexedRows,
  next: HistoryDensityRows,
  result: DiskDensityResult,
  ownership?: RowOwnership,
): Generator<HistoryJournalOp, void, unknown> {
  for (const row of previous) {
    if (row.metadata?.chronology === undefined) {
      yield* planHistoryMutation(previous, next, ownership);
      return;
    }
  }
  yield* batchDensityOps(
    individualDensityOps(previous, next, result, ownership),
    ownership,
  );
}

type DensityOp = Extract<HistoryJournalOp, { readonly kind: 'density' }>;
interface DensityChange {
  readonly seq: number;
  readonly replacement?: IContent;
}

function* batchDensityOps(
  operations: Iterable<DensityChange>,
  ownership?: RowOwnership,
): Generator<DensityOp, void, unknown> {
  let removedSeqs: number[] = [];
  let replacements: Array<DensityOp['payload']['replacements'][number]> = [];
  const sequences = new Set<number>();
  let bytes = 0;
  const release = (): void => {
    for (const entry of replacements) ownership?.release(entry.replacement);
    removedSeqs = [];
    replacements = [];
    sequences.clear();
    bytes = 0;
  };
  try {
    for (const { seq, replacement } of operations) {
      const charge =
        Buffer.byteLength(
          JSON.stringify({ replacedSeq: seq, replacement }),
          'utf8',
        ) + 48;
      const changesChronology =
        replacement !== undefined &&
        replacement.metadata?.chronology?.seq !== seq;
      const full = sequences.size === 64 || bytes + charge > 64 * 1024;
      const conflicts = sequences.has(seq) || changesChronology;
      if (sequences.size > 0 && (full || conflicts)) {
        yield { kind: 'density', payload: { removedSeqs, replacements } };
        release();
      }
      if (replacement !== undefined) {
        ownership?.retain(replacement);
        replacements.push({ replacedSeq: seq, replacement });
      } else removedSeqs.push(seq);
      sequences.add(seq);
      bytes += charge;
      if (changesChronology) {
        yield { kind: 'density', payload: { removedSeqs, replacements } };
        release();
      }
    }
    if (sequences.size > 0)
      yield { kind: 'density', payload: { removedSeqs, replacements } };
  } finally {
    release();
  }
}

function* individualDensityOps(
  previous: HistoryIndexedRows,
  next: HistoryDensityRows,
  result: DiskDensityResult,
  ownership?: RowOwnership,
): Generator<DensityChange, void, unknown> {
  let candidateIndex = 0;
  let index = 0;
  for (const original of previous) {
    const seq = original.metadata?.chronology?.seq;
    if (seq === undefined)
      throw new Error('Pinned density chronology disappeared');
    if (result.decision(index++)?.kind === 'removed') yield { seq };
    else
      yield* replacementChange(
        original,
        next.readRow(candidateIndex++),
        seq,
        ownership,
      );
  }
}

function* replacementChange(
  original: IContent,
  replacement: IContent,
  seq: number,
  ownership?: RowOwnership,
): Generator<DensityChange, void, unknown> {
  if (isDeepStrictEqual(original, replacement)) return;
  ownership?.retain(replacement);
  try {
    yield { seq, replacement };
  } finally {
    ownership?.release(replacement);
  }
}
