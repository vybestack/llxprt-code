/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 *
 * Behavioral contract for the context-membership classifier
 * (issue-854-design.md §5 rev 3 membership paragraph). Membership is the
 * fold's survivor set expressed as seq intervals, never a single
 * `seq >= firstSeq` comparison: a seq is `in-context` only when it sits
 * inside the curated boundary and outside every removed-interior span,
 * `purged` when a span covers it, and `n/a` when membership cannot be
 * stated (approximate legacy history, empty history, or a seq outside the
 * snapshot's boundary that no span claims).
 *
 * Range fixtures are built structurally here, mirroring core's ContextRange
 * (packages/core/src/services/history/historyEventTypes.ts), whose type is
 * not yet re-exported from the @vybestack/llxprt-code-core barrel; the
 * classifier accepts core's type and these literals satisfy it
 * structurally.
 */

import { describe, expect, it } from 'bun:test';
import { classifyContextState } from './historyContextState.js';

type RemovedReason =
  | 'compressed'
  | 'density-replaced'
  | 'density-removed'
  | 'rewound'
  | 'cleared';

interface RangeFixture {
  readonly firstSeq: number;
  readonly lastSeq: number;
  readonly totalEntries: number;
  readonly removedInterior: ReadonlyArray<{
    readonly start: number;
    readonly end: number;
    readonly reason: RemovedReason;
  }>;
  readonly approximate: boolean;
}

function makeRange(
  firstSeq: number,
  lastSeq: number,
  spans: RangeFixture['removedInterior'] = [],
  overrides: Partial<RangeFixture> = {},
): RangeFixture {
  const boundarySize = lastSeq - firstSeq + 1;
  const removed = spans.reduce(
    (sum, span) => sum + (span.end - span.start + 1),
    0,
  );
  return {
    firstSeq,
    lastSeq,
    totalEntries: overrides.totalEntries ?? boundarySize - removed,
    removedInterior: spans,
    approximate: overrides.approximate ?? false,
  };
}

describe('classifyContextState', () => {
  it('middle-out compression (topPreserved): head, summary, and newest stay in-context while the interior span is purged as compressed', () => {
    // History 1..9 compressed to [head(1), summary(8), recent(9)]; the
    // destroyed interior 2..7 is recorded as one compressed span.
    const range = makeRange(1, 9, [{ start: 2, end: 7, reason: 'compressed' }]);
    expect(classifyContextState(1, range)).toBe('in-context');
    expect(classifyContextState(8, range)).toBe('in-context');
    expect(classifyContextState(9, range)).toBe('in-context');
    expect(classifyContextState(4, range)).toBe('purged');
  });

  it('density-replaced single-seq span purges exactly that seq and leaves its neighbours in-context', () => {
    const range = makeRange(1, 10, [
      { start: 5, end: 5, reason: 'density-replaced' },
    ]);
    expect(classifyContextState(5, range)).toBe('purged');
    expect(classifyContextState(4, range)).toBe('in-context');
    expect(classifyContextState(6, range)).toBe('in-context');
  });

  it('density-removed span purges every seq it covers and nothing outside it', () => {
    const range = makeRange(1, 12, [
      { start: 6, end: 8, reason: 'density-removed' },
    ]);
    expect(classifyContextState(6, range)).toBe('purged');
    expect(classifyContextState(7, range)).toBe('purged');
    expect(classifyContextState(8, range)).toBe('purged');
    expect(classifyContextState(5, range)).toBe('in-context');
    expect(classifyContextState(9, range)).toBe('in-context');
  });

  it('rewind suffix span purges the rewound seqs, keeps survivors in-context, and reports n/a for a seq beyond the snapshot boundary', () => {
    // History 1..10 rewound to 1..5; seq 11 does not exist in this
    // snapshot (post-rewind turn not yet folded in) and no span claims it.
    // totalEntries is pinned to the curated history's 5 entries: makeRange's
    // derived value would subtract the 6..10 span even though it lies
    // outside the 1..5 boundary, and core's ContextRange.totalEntries counts
    // entries of the curated history (a rewind to 1..5 has 5, never 0).
    const range = makeRange(1, 5, [{ start: 6, end: 10, reason: 'rewound' }], {
      totalEntries: 5,
    });
    expect(classifyContextState(3, range)).toBe('in-context');
    expect(classifyContextState(7, range)).toBe('purged');
    expect(classifyContextState(11, range)).toBe('n/a');
  });

  it('cleared span purges the cleared seqs while post-clear entries stay in-context', () => {
    // History 1..10 cleared, then 11..12 landed; the cleared seqs are
    // remembered as a span so they never resurrect as in-context.
    const range = makeRange(11, 12, [{ start: 1, end: 10, reason: 'cleared' }]);
    expect(classifyContextState(5, range)).toBe('purged');
    expect(classifyContextState(10, range)).toBe('purged');
    expect(classifyContextState(11, range)).toBe('in-context');
    expect(classifyContextState(12, range)).toBe('in-context');
  });

  it('approximate range (unmarked legacy history) is n/a for every seq regardless of position', () => {
    const range = makeRange(
      3,
      8,
      [{ start: 5, end: 6, reason: 'compressed' }],
      { approximate: true, totalEntries: 6 },
    );
    expect(classifyContextState(4, range)).toBe('n/a');
    expect(classifyContextState(5, range)).toBe('n/a');
    expect(classifyContextState(8, range)).toBe('n/a');
    expect(classifyContextState(100, range)).toBe('n/a');
  });

  it('empty history range is n/a (nothing curated yet, not purged)', () => {
    // Core emits {firstSeq:0, lastSeq:0, totalEntries:0, no spans} for an
    // empty history (contextRange.ts computeContextRange). No curated
    // context exists, so no seq can be a member or a purge victim.
    const range = makeRange(0, 0, [], { totalEntries: 0 });
    expect(classifyContextState(0, range)).toBe('n/a');
    expect(classifyContextState(1, range)).toBe('n/a');
  });

  it('span edges are inclusive for purged and boundary edges are inclusive for in-context', () => {
    const range = makeRange(2, 9, [
      { start: 4, end: 7, reason: 'density-removed' },
    ]);
    expect(classifyContextState(2, range)).toBe('in-context');
    expect(classifyContextState(9, range)).toBe('in-context');
    expect(classifyContextState(4, range)).toBe('purged');
    expect(classifyContextState(7, range)).toBe('purged');
    expect(classifyContextState(3, range)).toBe('in-context');
    expect(classifyContextState(8, range)).toBe('in-context');
  });
});
