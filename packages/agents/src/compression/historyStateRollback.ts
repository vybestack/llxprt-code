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
 * whether or not the rewrite later removed them. A batch the history announced
 * and then reverted itself (`contentBatchRolledBack`) never committed, so its
 * entries are dropped again: restoring them would resurrect a write that
 * failed. In-place tool-response truncations by other writers
 * (`toolResponseReplaced`) are tracked the same way: they rewrite entries the
 * snapshot holds, and the rollback keeps them.
 */
export interface IndependentWrites {
  /**
   * Stops watching. Call once the rollback has run: writers queued before the
   * rollback commit before it starts, and must still be seen.
   */
  stop(): void;
  /** Every entry announced so far, in announcement order, without repeats. */
  announced(): IContent[];
  /**
   * The entry as other writers left it: an entry whose tool response another
   * writer truncated in place (`replaceToolResponseBlock`) maps to its
   * replacement, through any number of such edits; any other entry maps to
   * itself.
   */
  current(content: IContent): IContent;
}

export function watchIndependentWrites(
  historyService: HistoryService,
): IndependentWrites {
  const announced = new Set<IContent>();
  const replacements = new Map<IContent, IContent>();
  const single = (content: IContent): void => {
    announced.add(content);
  };
  const batch = (contents: readonly IContent[]): void => {
    contents.forEach((content) => announced.add(content));
  };
  const reverted = (contents: readonly IContent[]): void => {
    contents.forEach((content) => announced.delete(content));
  };
  const replaced = (
    previous: readonly IContent[],
    next: readonly IContent[],
  ): void => {
    previous.forEach((entry, index) => {
      if (next[index] !== entry) replacements.set(entry, next[index]);
    });
  };
  historyService.on('contentAdded', single);
  historyService.on('contentBatchAdded', batch);
  historyService.on('contentBatchRolledBack', reverted);
  historyService.on('toolResponseReplaced', replaced);
  return {
    stop: () => {
      historyService.off('contentAdded', single);
      historyService.off('contentBatchAdded', batch);
      historyService.off('contentBatchRolledBack', reverted);
      historyService.off('toolResponseReplaced', replaced);
    },
    announced: () => [...announced],
    current: (content) => {
      let entry = content;
      for (
        let next = replacements.get(entry);
        next !== undefined;
        next = replacements.get(entry)
      ) {
        entry = next;
      }
      return entry;
    },
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

function sameHistory(
  current: readonly IContent[],
  expected: readonly IContent[],
): boolean {
  return (
    current.length === expected.length &&
    current.every((content, index) => content === expected[index])
  );
}

/**
 * The snapshot followed by every independent entry it does not hold, each as
 * other writers left it.
 */
function snapshotWithIndependentWrites(
  snapshot: HistoryStateSnapshot,
  writes: IndependentWrites,
): IContent[] {
  const held = new Set(snapshot.history);
  return [
    ...snapshot.history,
    ...writes.announced().filter((content) => !held.has(content)),
  ].map((content) => writes.current(content));
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
        const target = snapshotWithIndependentWrites(snapshot, writes);
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
