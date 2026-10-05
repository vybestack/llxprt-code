/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { isDeepStrictEqual } from 'node:util';
import type { HistoryServiceCore } from './HistoryServiceCore.js';
import type { HistoryMutationInput } from './historyBatchContracts.js';
import type { IContent } from './IContent.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import {
  validateHistoryEntry,
  type HistoryBatchOptions,
} from './historyBatchContracts.js';
import { sanitizeProviderContentForSerialization } from './historyCloneUtils.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

export interface HistoryTransformEntry {
  readonly row: IContent;
  readonly ownership: 'borrowed' | 'detached';
}

export async function prepareRowTransformMutation(
  nextHistory: HistoryDensityRows,
  history: HistoryServiceCore,
  modelName: string | undefined,
  options: HistoryRowTransformOptions,
): Promise<HistoryMutationInput> {
  await history.waitForTokenUpdates();
  const nextHistoryTokens = await history.estimateTokensForContents(
    nextHistory.streamRows(options.signal),
    modelName,
    options.signal,
  );
  return {
    nextHistory,
    nextHistoryTokens,
    streamPublication: options.streamPublication ?? true,
    signal: options.signal,
    options,
  };
}

export interface HistoryTransformSource {
  readonly length: number;
  streamRows(signal?: AbortSignal): AsyncIterable<HistoryTransformEntry>;
}

export interface HistoryTransformSink {
  appendRetained(sourceIndex: number, row: IContent): void;
  /** Serialize a sanitized value now. The caller's row is never stamped. */
  appendDetached(row: IContent): void;
  /** Keep the caller's exact row strongly alive and charge it until completion. */
  appendBorrowed(row: IContent): void;
  /** Keep the exact row and its original marker for rollback, even after GC. */
  appendIdentity(row: IContent): void;
}

export interface HistoryRowTransformOptions extends HistoryBatchOptions {
  readonly signal?: AbortSignal;
  /** Pending caller writers cannot be awaited by the publication they own. */
  readonly streamPublication?: boolean;
}

export type HistoryRowTransform = (
  source: HistoryTransformSource,
  sink: HistoryTransformSink,
) => Promise<void>;

class HistoryTransformRows extends HistoryDensityRows {
  override readRow(index: number): IContent {
    const row = super.readRow(index);
    for (const block of row.blocks) {
      if (
        block.type === 'media' &&
        block.encoding === 'reference' &&
        block.providerFiles !== undefined
      ) {
        for (const reference of block.providerFiles) Object.freeze(reference);
        Object.freeze(block.providerFiles);
      }
    }
    return row;
  }
}

function appendRetainedRow(
  previous: HistoryMutationSnapshot,
  candidate: HistoryDensityRows,
  sourceIndex: number,
  row: IContent,
): void {
  if (
    !Number.isInteger(sourceIndex) ||
    sourceIndex < 0 ||
    sourceIndex >= previous.length
  )
    throw new Error('Retained history row index is invalid');
  const original = previous.readRow(sourceIndex);
  if (
    row.speaker !== original.speaker ||
    !isDeepStrictEqual(row.blocks, original.blocks)
  )
    throw new Error('Retained history row blocks or speaker changed');
  if (previous.isPendingRow(sourceIndex)) candidate.appendIdentity(row);
  else candidate.append(sanitizeProviderContentForSerialization(row));
}

/** Scoped repeatable source and disk sink. Borrowing does not waive owner charge:
 * both reference writer operations pin the row and protect its original marker.
 * Pending source rows are caller-owned references; durable source rows are values.
 */
export async function withHistoryRowTransform(
  previous: HistoryMutationSnapshot,
  transform: HistoryRowTransform,
  commit: (candidate: HistoryDensityRows) => Promise<void>,
  ownership?: RowOwnership,
  signal?: AbortSignal,
): Promise<void> {
  signal?.throwIfAborted();
  const candidate = new HistoryTransformRows(ownership);
  let active = true;
  const assertActive = (): void => {
    if (!active)
      throw new Error('History transform cursor and sink are closed');
    signal?.throwIfAborted();
  };
  const pin = (row: IContent): void => {
    assertActive();
    validateHistoryEntry(row, candidate.length);
    candidate.appendIdentity(row);
  };
  const source: HistoryTransformSource = {
    length: previous.length,
    async *streamRows(
      cursorSignal,
    ): AsyncGenerator<HistoryTransformEntry, void, unknown> {
      assertActive();
      cursorSignal?.throwIfAborted();
      let index = 0;
      for (const row of previous) {
        assertActive();
        cursorSignal?.throwIfAborted();
        yield {
          row,
          ownership: previous.isPendingRow(index++) ? 'borrowed' : 'detached',
        };
      }
      assertActive();
      cursorSignal?.throwIfAborted();
    },
  };
  const sink: HistoryTransformSink = {
    appendRetained: (sourceIndex, row): void => {
      assertActive();
      appendRetainedRow(previous, candidate, sourceIndex, row);
    },
    appendDetached: (row): void => {
      assertActive();
      validateHistoryEntry(row, candidate.length);
      candidate.append(sanitizeProviderContentForSerialization(row));
    },
    appendBorrowed: pin,
    appendIdentity: pin,
  };
  try {
    await transform(source, sink);
    assertActive();
    active = false;
    await commit(candidate);
  } finally {
    active = false;
    candidate.close();
  }
}
