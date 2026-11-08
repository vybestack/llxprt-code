/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
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

/**
 * Entries that writers other than the watched rewrite committed to the
 * history while it was in flight. Every conversation writer (`add`, `addAll`,
 * `addBatch`, and adds queued under the compression lock and replayed when it
 * is released) announces the exact entries it commits; a compression applies
 * its rewrite through `replaceAll`, which announces none. Entries announced
 * during the window are therefore independent of the rewrite, by identity.
 */
export interface IndependentWrites {
  /** Stops watching; call exactly once when the rewrite attempt is over. */
  stop(): void;
  /** The announced entries that are still part of the history. */
  surviving(history: readonly IContent[]): IContent[];
}

export function watchIndependentWrites(
  historyService: HistoryService,
): IndependentWrites {
  const announced = new Set<IContent>();
  const single = (content: IContent): void => {
    announced.add(content);
  };
  const batch = (contents: readonly IContent[]): void => {
    contents.forEach((content) => announced.add(content));
  };
  historyService.on('contentAdded', single);
  historyService.on('contentBatchAdded', batch);
  return {
    stop: () => {
      historyService.off('contentAdded', single);
      historyService.off('contentBatchAdded', batch);
    },
    surviving: (history) => history.filter((content) => announced.has(content)),
  };
}

/**
 * Puts the snapshot back. Entries other writers committed during the attempt
 * (`independent`) that the snapshot does not hold are appended after it, in
 * the order they now appear, so a rollback never drops another writer's turn.
 */
export async function restoreHistoryState(
  deps: ProviderContentEnforcementDeps,
  snapshot: HistoryStateSnapshot,
  independent: readonly IContent[] = [],
): Promise<void> {
  const restored = new Set(snapshot.history);
  await deps.historyService.replaceAll(
    [
      ...snapshot.history,
      ...independent.filter((content) => !restored.has(content)),
    ],
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
 * Gives back the state a rewrite that did not complete may have left behind,
 * keeping what other writers committed meanwhile. Nothing is written when the
 * rewrite changed nothing, so a compression that was merely skipped never
 * re-stamps the history. The prompt-token baseline is restored on its own
 * because a rewrite can reset it without touching history.
 */
export async function rollbackHistoryState(
  deps: ProviderContentEnforcementDeps,
  snapshot: HistoryStateSnapshot,
  writes: IndependentWrites,
): Promise<void> {
  const current = deps.historyService.getRawHistory();
  const independent = writes.surviving(current);
  const ownEntries = current.filter(
    (content) => !independent.includes(content),
  );
  const historyUntouched =
    sameHistory(ownEntries, snapshot.history) &&
    deps.historyService.getCacheAnchorSeq() === snapshot.cacheAnchorSeq;
  if (!historyUntouched) {
    await restoreHistoryState(deps, snapshot, independent);
    return;
  }
  if (deps.getPromptTokenBaseline() !== snapshot.promptTokenBaseline) {
    deps.restorePromptTokenBaseline(snapshot.promptTokenBaseline);
  }
}
