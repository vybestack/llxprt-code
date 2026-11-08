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
 * during the window are therefore independent of the rewrite, by identity,
 * whether or not the rewrite later removed them.
 */
export interface IndependentWrites {
  /**
   * Stops watching. Call once the rollback has run: writers queued before the
   * rollback commit before it starts, and must still be seen.
   */
  stop(): void;
  /** Every entry announced so far, in announcement order, without repeats. */
  announced(): IContent[];
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
    announced: () => [...announced],
  };
}

function restoreAnchorAndBaseline(
  deps: ProviderContentEnforcementDeps,
  snapshot: HistoryStateSnapshot,
): void {
  if (snapshot.cacheAnchorSeq === 0) {
    deps.historyService.resetCacheAnchorSeq();
  } else {
    deps.historyService.setCacheAnchorSeq(snapshot.cacheAnchorSeq);
  }
  deps.restorePromptTokenBaseline(snapshot.promptTokenBaseline);
}

/** Puts the snapshot back exactly. */
export async function restoreHistoryState(
  deps: ProviderContentEnforcementDeps,
  snapshot: HistoryStateSnapshot,
): Promise<void> {
  await deps.historyService.replaceAll(
    snapshot.history,
    deps.runtimeContext.state.model,
    { origin: deps.historyOrigin },
  );
  restoreAnchorAndBaseline(deps, snapshot);
}

function sameHistory(
  current: readonly IContent[],
  expected: readonly IContent[],
): boolean {
  return (
    current.length === expected.length &&
    current.every((content, index) => content === expected[index])
  );
}

/** The snapshot followed by every independent entry it does not hold. */
function snapshotWithIndependentWrites(
  snapshot: HistoryStateSnapshot,
  independent: readonly IContent[],
): IContent[] {
  const held = new Set(snapshot.history);
  return [
    ...snapshot.history,
    ...independent.filter((content) => !held.has(content)),
  ];
}

/** Thrown inside the queued transform to commit nothing. */
class HistoryUntouched extends Error {}

/**
 * Gives back the state a rewrite that did not complete may have left behind,
 * keeping what other writers committed meanwhile, including entries the failed
 * rewrite itself removed. The history is read, compared and replaced as ONE
 * operation inside the history's mutation queue, so a write queued before the
 * rollback has committed, and is visible to it, before it decides anything.
 * Nothing is written when the history already equals the snapshot plus the
 * independent entries, so a compression that was merely skipped never
 * re-stamps the history. The prompt-token baseline is restored on its own
 * because a rewrite can reset it without touching history.
 */
export async function rollbackHistoryState(
  deps: ProviderContentEnforcementDeps,
  snapshot: HistoryStateSnapshot,
  writes: IndependentWrites,
): Promise<void> {
  let untouched = false;
  try {
    await deps.historyService.transformAll(
      (current) => {
        const target = snapshotWithIndependentWrites(
          snapshot,
          writes.announced(),
        );
        if (
          sameHistory(current, target) &&
          deps.historyService.getCacheAnchorSeq() === snapshot.cacheAnchorSeq
        ) {
          throw new HistoryUntouched();
        }
        return target;
      },
      deps.runtimeContext.state.model,
      { origin: deps.historyOrigin },
    );
  } catch (error) {
    if (!(error instanceof HistoryUntouched)) throw error;
    untouched = true;
  }
  if (!untouched) {
    restoreAnchorAndBaseline(deps, snapshot);
    return;
  }
  if (deps.getPromptTokenBaseline() !== snapshot.promptTokenBaseline) {
    deps.restorePromptTokenBaseline(snapshot.promptTokenBaseline);
  }
}
