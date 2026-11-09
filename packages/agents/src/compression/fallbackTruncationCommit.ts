/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderContentEnforcementDeps } from './providerContentEnforcement.js';
import {
  captureHistoryState,
  rollbackHistoryState,
  watchIndependentWrites,
  type HistoryStateSnapshot,
  type IndependentWrites,
} from './historyStateRollback.js';

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function restoreRejectedFallback(
  deps: ProviderContentEnforcementDeps,
  snapshot: HistoryStateSnapshot,
  writes: IndependentWrites,
  fallbackError: unknown,
): Promise<Error> {
  const failure = normalizeError(fallbackError);
  try {
    await rollbackHistoryState(deps, snapshot, writes);
    return failure;
  } catch (rollbackError) {
    return new AggregateError(
      [failure, normalizeError(rollbackError)],
      'Provider truncation fallback failed and its state rollback also failed',
    );
  }
}

/**
 * Executes fallback truncation and commits its candidate history atomically.
 * The existing history remains untouched unless the complete candidate is
 * accepted and its token accounting succeeds. A rejected candidate is rolled
 * back to the snapshot plus whatever other writers committed meanwhile.
 */
export async function executeFallbackTruncation(
  deps: ProviderContentEnforcementDeps,
  promptId: string,
  targetTokenCount: number | undefined,
): Promise<{
  truncationApplied: boolean;
  truncationFailure?: Error;
}> {
  const snapshot = captureHistoryState(deps);
  const writes = watchIndependentWrites(deps.historyService);
  let truncationFailure: Error | undefined;
  let fallbackSucceeded = false;
  const candidate = { installed: false, committed: false };
  try {
    fallbackSucceeded = await deps.performFallbackCompression(
      promptId,
      async (newHistory) => {
        await deps.historyService.replaceAll(
          [...invalidateResponsesStatefulChain(newHistory)],
          deps.runtimeContext.state.model,
          { origin: deps.historyOrigin },
        );
        candidate.installed = true;
        deps.historyService.resetCacheAnchorSeq();
        deps.resetPromptTokenBaseline();
        candidate.committed = true;
      },
      targetTokenCount,
    );
    if (!fallbackSucceeded && candidate.installed) {
      throw new Error(
        'Fallback compression rejected after installing candidate history',
      );
    }
  } catch (fallbackError) {
    truncationFailure = candidate.installed
      ? await restoreRejectedFallback(deps, snapshot, writes, fallbackError)
      : normalizeError(fallbackError);
    candidate.committed = false;
    deps.logger.warn(
      () =>
        '[CompressionHandler] Provider truncation fallback rejected during hard-limit enforcement',
      truncationFailure,
    );
  }
  writes.stop();
  if (fallbackSucceeded && !candidate.committed) {
    deps.logger.warn(
      () =>
        '[CompressionHandler] Fallback compression succeeded without providing candidate history',
    );
  }
  return {
    truncationApplied: fallbackSucceeded && candidate.committed,
    truncationFailure,
  };
}
