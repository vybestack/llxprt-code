/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export interface HistoryStateDeps {
  readonly historyService: HistoryService;
  readonly getPromptTokenBaseline: () => number | null;
  readonly restorePromptTokenBaseline: (baseline: number | null) => void;
}

export interface HistoryStateSnapshot {
  readonly restore: () => Promise<void>;
  readonly cacheAnchorSeq: number;
  readonly promptTokenBaseline: number | null;
}

/** The checkpoint holds a journal version, not copies of its rows. */
export function withHistoryState<T>(
  deps: HistoryStateDeps,
  execute: (snapshot: HistoryStateSnapshot) => Promise<T>,
): Promise<T> {
  return deps.historyService.detachedValues.withRollbackCheckpoint(
    (restore) =>
      execute({
        restore,
        cacheAnchorSeq: deps.historyService.getCacheAnchorSeq(),
        promptTokenBaseline: deps.getPromptTokenBaseline(),
      }),
    true,
  );
}

export async function rollbackHistoryState(
  deps: HistoryStateDeps,
  snapshot: HistoryStateSnapshot,
): Promise<void> {
  await snapshot.restore();
  if (snapshot.cacheAnchorSeq === 0) deps.historyService.resetCacheAnchorSeq();
  else deps.historyService.setCacheAnchorSeq(snapshot.cacheAnchorSeq);
  if (deps.getPromptTokenBaseline() !== snapshot.promptTokenBaseline)
    deps.restorePromptTokenBaseline(snapshot.promptTokenBaseline);
}
