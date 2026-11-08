/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderContentEnforcementDeps } from './providerContentEnforcement.js';

/**
 * The state a history rewrite (compression or truncation) can change and a
 * rejected rewrite must give back: the history itself, the cache-anchor
 * sequence and the prompt-token baseline.
 */
export interface HistoryStateSnapshot {
  readonly history: IContent[];
  readonly cacheAnchorSeq: number;
  readonly promptTokenBaseline: number | null;
}

export function captureHistoryState(
  deps: ProviderContentEnforcementDeps,
): HistoryStateSnapshot {
  return {
    history: [...deps.historyService.getRawHistory()],
    cacheAnchorSeq: deps.historyService.getCacheAnchorSeq(),
    promptTokenBaseline: deps.getPromptTokenBaseline(),
  };
}

export async function restoreHistoryState(
  deps: ProviderContentEnforcementDeps,
  snapshot: HistoryStateSnapshot,
): Promise<void> {
  await deps.historyService.replaceAll(
    [...snapshot.history],
    deps.runtimeContext.state.model,
    { origin: deps.historyOrigin },
  );
  if (snapshot.cacheAnchorSeq === 0) {
    deps.historyService.resetCacheAnchorSeq();
  } else {
    deps.historyService.setCacheAnchorSeq(snapshot.cacheAnchorSeq);
  }
  deps.restorePromptTokenBaseline(snapshot.promptTokenBaseline);
}

function sameHistory(
  current: readonly IContent[],
  snapshot: readonly IContent[],
): boolean {
  return (
    current.length === snapshot.length &&
    current.every((content, index) => content === snapshot[index])
  );
}

/**
 * Gives back the state a rewrite that did not complete may have left behind.
 * Nothing is written when the rewrite changed nothing, so a compression that
 * was merely skipped never re-stamps the history. The prompt-token baseline is
 * restored on its own because a rewrite can reset it without touching history.
 */
export async function rollbackHistoryState(
  deps: ProviderContentEnforcementDeps,
  snapshot: HistoryStateSnapshot,
): Promise<void> {
  const historyUntouched =
    sameHistory(deps.historyService.getRawHistory(), snapshot.history) &&
    deps.historyService.getCacheAnchorSeq() === snapshot.cacheAnchorSeq;
  if (!historyUntouched) {
    await restoreHistoryState(deps, snapshot);
    return;
  }
  if (deps.getPromptTokenBaseline() !== snapshot.promptTokenBaseline) {
    deps.restorePromptTokenBaseline(snapshot.promptTokenBaseline);
  }
}
