/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

import {
  publishProviderFallbackCandidate,
  ProviderFallbackInvariantError,
  type ProviderFallbackCandidate,
} from './providerFallbackCandidate.js';

export interface PendingFallbackDeps {
  historyService: HistoryService;
  performFallbackCompression(
    promptId: string,
    install: (candidate: ProviderFallbackCandidate) => Promise<void>,
    targetTokenCount?: number,
  ): Promise<boolean>;
  getRuntimeModel(): string;
  getLastPromptTokenCount(): number | null;
  restoreLastPromptTokenCount(value: number | null): void;
  resetLastPromptTokenCount(): void;
}

async function restoreRejectedState(
  deps: PendingFallbackDeps,
  restore: () => Promise<void>,
  anchor: number,
  baseline: number | null,
  failure: unknown,
): Promise<void> {
  try {
    await restore();
    if (anchor === 0) deps.historyService.resetCacheAnchorSeq();
    else deps.historyService.setCacheAnchorSeq(anchor);
    deps.restoreLastPromptTokenCount(baseline);
  } catch (rollbackError) {
    throw new AggregateError(
      [failure, rollbackError],
      'Pending-window fallback failed and its state rollback also failed',
    );
  }
}

export async function applyPendingWindowFallback(
  deps: PendingFallbackDeps,
  promptId: string,
  targetTokenCount: number | undefined,
): Promise<boolean> {
  const history = deps.historyService;
  const anchor = history.getCacheAnchorSeq();
  const baseline = deps.getLastPromptTokenCount();
  return history.detachedValues.withRollbackCheckpoint(async (restore) => {
    const state = { installed: false, committed: false };
    try {
      const applied = await deps.performFallbackCompression(
        promptId,
        async (candidate) => {
          if (state.installed)
            throw new ProviderFallbackInvariantError(
              'Fallback candidate may only be installed once',
            );
          await publishProviderFallbackCandidate(
            history,
            candidate,
            deps.getRuntimeModel(),
          );
          state.installed = true;
          history.resetCacheAnchorSeq();
          deps.resetLastPromptTokenCount();
          state.committed = true;
        },
        targetTokenCount,
      );
      if (applied && !state.committed)
        throw new ProviderFallbackInvariantError(
          'Hard-limit fallback reported applied but no candidate history was committed',
        );
      if (!applied && state.installed)
        throw new Error(
          'Fallback compression rejected after installing candidate history',
        );
      return applied;
    } catch (error) {
      if (state.installed)
        await restoreRejectedState(deps, restore, anchor, baseline, error);
      throw error;
    }
  });
}
