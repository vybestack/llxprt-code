/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { isDeepStrictEqual } from 'node:util';
import {
  invalidateResponsesStatefulChain,
  type IContent,
  type ToolResponseBlock,
} from './IContent.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import { HistoryMutationPublication } from './historyMutationPublication.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { HistoryJournalStore } from './historyJournalStore.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import { planHistoryMutation } from './planHistoryMutation.js';
import { historyMutationFailure } from './historyMutationEffects.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';

interface RewriteInput {
  readonly journal: HistoryJournalStore;
  readonly entryIndex: number;
  readonly blockIndex: number;
  readonly replacement: ToolResponseBlock;
  readonly ownership?: RowOwnership;
  readonly owner?: HistoryMediaOwner;
  readonly prepareTokens: () => Promise<void>;
  readonly recalculate: () => Promise<void>;
  readonly restoreTokens: () => void;
  readonly signal?: AbortSignal;
}

function rewritesStoredParent(
  previous: HistoryMutationSnapshot,
  start: number,
): boolean {
  let index = 0;
  for (const row of previous)
    if (
      index++ >= start &&
      row.speaker === 'ai' &&
      row.metadata?.responsesStored === true
    )
      return true;
  return false;
}

function hasResponseType(value: { readonly type?: unknown }): boolean {
  return value.type === 'tool_response';
}

export async function rewriteToolResponse(
  input: RewriteInput,
): Promise<boolean> {
  input.signal?.throwIfAborted();
  if (
    !Number.isInteger(input.entryIndex) ||
    input.entryIndex < 0 ||
    !Number.isInteger(input.blockIndex) ||
    input.blockIndex < 0
  )
    return false;
  return input.journal.withMutationSnapshot(async (previous) => {
    if (input.entryIndex >= previous.length) return false;
    const entry = previous.readRow(input.entryIndex);
    input.ownership?.retain(entry);
    try {
      input.ownership?.retain(input.replacement);
      try {
        return await prepareToolRewrite(input, previous, entry);
      } finally {
        input.ownership?.release(input.replacement);
      }
    } finally {
      input.ownership?.release(entry);
    }
  }, input.signal);
}

async function prepareToolRewrite(
  input: RewriteInput,
  previous: HistoryMutationSnapshot,
  entry: IContent,
): Promise<boolean> {
  if (input.blockIndex >= entry.blocks.length) return false;
  const target = entry.blocks.find((_, index) => index === input.blockIndex);
  if (
    target?.type !== 'tool_response' ||
    !hasResponseType(input.replacement) ||
    target.callId !== input.replacement.callId ||
    target.toolName !== input.replacement.toolName
  )
    return false;
  if (isDeepStrictEqual(target, input.replacement)) return true;
  await input.prepareTokens();
  input.signal?.throwIfAborted();
  const next = new HistoryDensityRows(input.ownership);
  try {
    captureToolRewrite(input, previous, next);
    await publishToolRewrite(input, previous, next);
    return true;
  } finally {
    next.close();
  }
}

function captureToolRewrite(
  input: RewriteInput,
  previous: HistoryMutationSnapshot,
  next: HistoryDensityRows,
): void {
  const invalidate = rewritesStoredParent(previous, input.entryIndex);
  let index = 0;
  for (const original of previous) {
    input.signal?.throwIfAborted();
    const position = index++;
    let row = original;
    if (position === input.entryIndex) {
      const blocks = [...row.blocks];
      blocks[input.blockIndex] = input.replacement;
      row = { ...row, blocks };
    }
    if (invalidate) [row] = invalidateResponsesStatefulChain([row]);
    if (previous.isPendingRow(position) || position === input.entryIndex)
      next.appendSanitized(row);
    else next.append(row);
  }
}

function restoreRows(
  input: RewriteInput,
  previous: HistoryMutationSnapshot,
  next: HistoryDensityRows,
): void {
  previous.restorePendingChronology();
  for (const op of planHistoryMutation(next, previous, input.ownership))
    input.journal.apply(op);
}

async function publishToolRewrite(
  input: RewriteInput,
  previous: HistoryMutationSnapshot,
  next: HistoryDensityRows,
): Promise<void> {
  const publication = new HistoryMutationPublication(
    input.journal,
    input.ownership,
  );
  const effect = await input.owner?.prepareReplacement({
    previous,
    next,
    adopted: [],
    ownership: input.ownership,
  });
  try {
    await effect?.publish();
    input.signal?.throwIfAborted();
    await publication.publish(previous, {
      nextHistory: next,
      streamPublication: !previous.hasPendingRows,
      signal: input.signal,
      options: {},
    });
    input.signal?.throwIfAborted();
    await input.recalculate();
    await effect?.finalize?.();
  } catch (error) {
    const failures: unknown[] = [];
    if (publication.admittedCount > 0) {
      try {
        restoreRows(input, previous, next);
      } catch (failure) {
        failures.push(failure);
      }
    }
    input.restoreTokens();
    try {
      await effect?.rollback();
    } catch (failure) {
      failures.push(failure);
    }
    throw historyMutationFailure(error, failures);
  } finally {
    publication.close();
  }
}
