/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

/**
 * Disposes a history that was abandoned because `failure` occurred, and
 * returns what the caller should throw: `failure` itself when the disposal
 * succeeded, otherwise both errors together so neither is lost.
 */
export async function failureAfterDisposal(
  history: Pick<HistoryService, 'dispose'>,
  failure: unknown,
): Promise<unknown> {
  try {
    await history.dispose();
  } catch (disposalError) {
    return new AggregateError(
      [failure, disposalError],
      'History disposal failed after another failure',
    );
  }
  return failure;
}
