/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { finalizeMutationEffects } from './historyMutationFailure.js';
import {
  publishMutationTokens,
  type HistoryMutationInput,
  type PreparedHistoryBatchEffect,
} from './historyBatchContracts.js';
import type {
  HistoryServiceEventEmitter,
  RemovedInteriorSpan,
} from './historyEventTypes.js';
import { buildRowContextRangeSnapshot } from './rowContextRange.js';
import { HistoryDensityRows } from './historyDensityRows.js';

export async function finalizeHistoryMutation(
  history: HistoryServiceEventEmitter & { getTotalTokens(): number },
  input: HistoryMutationInput,
  effects: readonly PreparedHistoryBatchEffect[],
  addedTokens: number,
  spans: readonly RemovedInteriorSpan[],
  emitEagerRange: () => void,
): Promise<void> {
  publishMutationTokens(history, input, addedTokens);
  await input.options.afterPublication?.();
  input.signal?.throwIfAborted();
  await finalizeMutationEffects(effects);
  if (
    input.streamPublication === true ||
    input.nextHistory instanceof HistoryDensityRows
  ) {
    history.emit(
      'contextRangeChanged',
      buildRowContextRangeSnapshot(input.nextHistory, spans),
    );
  } else emitEagerRange();
}
