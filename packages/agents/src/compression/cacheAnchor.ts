/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { invalidateResponsesStatefulChain } from '@vybestack/llxprt-code-core/services/history/IContent.js';

/**
 * Resolve the chronology `seq` that should become the new cache anchor after a
 * successful compression, using the strategy-reported preserved-head length.
 *
 * `topPreserved` is the exact number of preserved head entries the strategy
 * kept in front of its synthetic summary/continuation. The new anchor is the
 * `seq` of the last preserved head entry — `newHistory[topPreserved - 1]` —
 * which is the highest position that must survive every later compression, so
 * the provider-visible prefix stays byte-identical (#3070).
 *
 * Returns `undefined` when there is no preserved head (`topPreserved <= 0`),
 * meaning the prefix was destroyed (e.g. a truncation strategy). In that case
 * the caller must explicitly reset the anchor rather than hold a stale one.
 *
 * Searching the output for the summary entry is intentionally avoided: from
 * the second compression onward the previous compression's summary sits inside
 * the preserved head and still carries its `compression-state-snapshot`
 * metadata, so a summary search would pin the anchor to the same stale seq
 * forever (#3070 Defect 1).
 */
export function resolveHeadAnchorSeq(
  newHistory: readonly IContent[],
  topPreserved: number,
): number | undefined {
  if (topPreserved <= 0) {
    return undefined;
  }
  if (topPreserved > newHistory.length) {
    throw new Error(
      `Invalid compression metadata: topPreserved ${topPreserved} exceeds history length ${newHistory.length}`,
    );
  }
  return extractSeq(newHistory[topPreserved - 1]);
}

function extractSeq(entry: IContent): number {
  const seq = entry.metadata?.chronology?.seq;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq <= 0) {
    throw new Error('Preserved cache-anchor entry has no valid chronology seq');
  }
  return seq;
}

/**
 * Apply the compression result to the history service: clear, re-add the
 * annotated entries, then advance or reset the cache anchor atomically
 * (#3070 Defects 3, 5).
 *
 * The anchor value is resolved BEFORE mutation so a throw cannot leave a
 * partially applied compression. When the prefix was destroyed
 * (`topPreserved <= 0`), the anchor is explicitly reset.
 */
export async function applyCompressionWithAnchor(
  historyService: {
    replaceAll(contents: readonly IContent[], model?: string): Promise<void>;
    resetCacheAnchorSeq(): void;
    setCacheAnchorSeq(seq: number): void;
    getRawHistory(): readonly IContent[];
  },
  newHistory: readonly IContent[],
  topPreserved: number,
  model: string,
  annotate: (
    oldHistory: readonly IContent[],
    newHist: readonly IContent[],
  ) => IContent[],
): Promise<void> {
  const anchorSeq = resolveHeadAnchorSeq(newHistory, topPreserved);
  const isPrefixDestroyed = topPreserved <= 0;
  // #3134 Fix 3: compression rewrites history behind the head, invalidating
  // the Responses stateful chain. Strip responsesStored from retained AI
  // entries so the next turn finds no parent and sends full history.
  const annotated = invalidateResponsesStatefulChain(
    stampCacheAnchorMarker(
      annotate(historyService.getRawHistory(), newHistory),
      isPrefixDestroyed ? 0 : topPreserved,
    ),
  );

  // Exactly one preserved-head entry — the last one — carries the marker, so
  // explicit-cache providers can place a breakpoint at the head boundary. The
  // marker travels with the history; a wholesale replacement drops it.

  await historyService.replaceAll(annotated, model);
  if (isPrefixDestroyed) {
    historyService.resetCacheAnchorSeq();
  } else if (anchorSeq !== undefined) {
    historyService.setCacheAnchorSeq(anchorSeq);
  }
}

/**
 * Ensure exactly one entry (or none) carries `metadata.cacheAnchor`.
 *
 * `anchorCount` is the number of preserved-head entries (`topPreserved`); the
 * anchor entry is `entries[anchorCount - 1]`. A non-positive `anchorCount`
 * means the prefix was destroyed, so every marker is cleared and none is set.
 */
function stampCacheAnchorMarker(
  entries: readonly IContent[],
  anchorCount: number,
): IContent[] {
  return entries.map((entry, index) => {
    const metadata = { ...entry.metadata };
    delete metadata.cacheAnchor;
    if (index === anchorCount - 1) {
      metadata.cacheAnchor = true;
    }
    return { ...entry, metadata };
  });
}
