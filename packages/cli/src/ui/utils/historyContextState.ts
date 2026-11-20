/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3
 *
 * Context-membership classification for history rows (issue-854-design.md
 * §5 rev 3 membership paragraph): a row's badge state is the curated
 * survivor set expressed as seq intervals, never a single
 * `seq >= firstSeq` comparison. A seq is `purged` when a removed-interior
 * span covers it, `in-context` when the curated boundary contains it
 * outside every span, and `n/a` when membership cannot be stated at all
 * (approximate legacy history, an empty history, or an unclaimed seq
 * outside the boundary).
 */

import type { RemovedInteriorSpan } from '@vybestack/llxprt-code-core';

/**
 * Read-only structural view of core's ContextRange (from the
 * @vybestack/llxprt-code-core barrel); both core's snapshots and test
 * fixtures satisfy it (the classifier only reads).
 */
export type ContextRangeView = {
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly totalEntries: number;
  readonly removedInterior: readonly RemovedInteriorSpan[];
  readonly approximate: boolean;
};

export type HistoryContextState = 'in-context' | 'purged' | 'n/a';

export function classifyContextState(
  seq: number,
  range: ContextRangeView,
): HistoryContextState {
  if (range.approximate) return 'n/a';
  if (range.totalEntries === 0) return 'n/a';
  for (const span of range.removedInterior) {
    if (seq >= span.start && seq <= span.end) {
      return 'purged';
    }
  }
  if (seq >= range.firstSeq && seq <= range.lastSeq) {
    return 'in-context';
  }
  return 'n/a';
}
