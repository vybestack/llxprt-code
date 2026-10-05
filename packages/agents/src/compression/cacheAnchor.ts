/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { publishCompressionArrayValues } from './cache-anchor-array-values.js';

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
 * Capture the compression result as disk values, publish annotated entries,
 * then advance or reset the cache anchor after replacement succeeds
 * (#3070 Defects 3, 5).
 *
 * The anchor value is resolved BEFORE mutation so a throw cannot leave a
 * partially applied compression. When the prefix was destroyed
 * (`topPreserved <= 0`), the anchor is explicitly reset.
 */
export function applyCompressionWithAnchor(
  historyService: HistoryService,
  newHistory: readonly IContent[],
  topPreserved: number,
  model: string,
  signal?: AbortSignal,
): Promise<void> {
  try {
    resolveHeadAnchorSeq(newHistory, topPreserved);
  } catch (error) {
    return Promise.reject(error);
  }
  return publishCompressionArrayValues(
    historyService,
    newHistory,
    Math.max(0, topPreserved),
    model,
    signal,
  );
}
