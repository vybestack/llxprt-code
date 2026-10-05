/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { validateDensityResult } from './densityValidation.js';
import { collectDensitySpans } from './contextRange.js';
import { HistoryDensityRows } from './historyDensityRows.js';
import type { HistoryMutationSnapshot } from './historyMutationSnapshot.js';
import type { DensityResult } from '../../core/compression/types.js';
import type { HistoryMutationInput } from './historyBatchContracts.js';
import type { RowOwnership } from '../../recording/rowOwnership.js';
import type { DebugLogger } from '../../debug/DebugLogger.js';

export async function withArrayDensityMutation(
  previous: HistoryMutationSnapshot,
  result: DensityResult,
  wait: () => Promise<void>,
  commit: (input: HistoryMutationInput) => Promise<void>,
  logger: DebugLogger,
  ownership?: RowOwnership,
): Promise<void> {
  validateDensityResult(result, previous.length);
  const densitySpans = collectDensitySpans(previous, result);
  const nextHistory = new HistoryDensityRows(ownership);
  try {
    nextHistory.capture(previous, result);
    await wait();
    await commit({
      nextHistory,
      extraRemovedInterior: densitySpans,
      densityResult: result,
      options: {},
    });
    logger.debug('Density: applied result', {
      replacements: result.replacements.size,
      removals: result.removals.length,
      newHistoryLength: nextHistory.length,
      metadata: result.metadata,
    });
  } finally {
    nextHistory.close();
  }
}

export function restorePendingChronologyFailure(
  previous: HistoryMutationSnapshot,
  failures: unknown[],
): void {
  try {
    previous.restorePendingChronology();
  } catch (error) {
    failures.push(error);
  }
}
