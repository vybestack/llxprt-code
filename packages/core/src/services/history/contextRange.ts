/**
 * Copyright 2026 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-004
 * Pure derivations of the curated context boundary and compression summary
 * projections from a history array. HistoryServiceCore delegates to these so
 * the boundary truth stays derived, never cached.
 */

import type { IContent } from './IContent.js';
import type { DensityResult } from '../../core/compression/types.js';
import type {
  ContextRange,
  ContextSummaryInfo,
  RemovedInteriorSpan,
} from './historyEventTypes.js';

/**
 * Merge removed-interior spans into the canonical well-formed form: sorted by
 * start, strictly disjoint, adjacent (or overlapping) same-reason spans
 * coalesced. Overlapping spans with different reasons collapse into the
 * earlier-starting span's reason — the disjointness invariant leaves no other
 * representation for a seq removed by two differently-reasoned mutations.
 *
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 */
export function mergeRemovedInteriorSpans(
  spans: readonly RemovedInteriorSpan[],
): RemovedInteriorSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  const merged: RemovedInteriorSpan[] = [];
  let current: RemovedInteriorSpan | undefined;
  for (const span of sorted) {
    if (
      current !== undefined &&
      span.start <= current.end + 1 &&
      (span.reason === current.reason || span.start <= current.end)
    ) {
      current.end = Math.max(current.end, span.end);
      continue;
    }
    current = { ...span };
    merged.push(current);
  }
  return merged;
}

/**
 * The rewound span for a strict seq-prefix truncation: when the committed
 * history is a positional prefix of the previous one (same seqs, shorter),
 * every seq above the new tail was rewound away.
 *
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 */
function deriveRewoundSpan(
  previousHistory: readonly IContent[],
  nextHistory: readonly IContent[],
): RemovedInteriorSpan | undefined {
  if (nextHistory.length >= previousHistory.length) {
    return undefined;
  }
  for (let index = 0; index < nextHistory.length; index++) {
    const previousSeq = previousHistory[index].metadata?.chronology?.seq ?? 0;
    const nextSeq = nextHistory[index].metadata?.chronology?.seq ?? 0;
    if (previousSeq !== nextSeq) {
      return undefined;
    }
  }
  const newLastSeq =
    nextHistory.length > 0
      ? (nextHistory[nextHistory.length - 1].metadata?.chronology?.seq ?? 0)
      : 0;
  const prevLastSeq =
    previousHistory[previousHistory.length - 1].metadata?.chronology?.seq ?? 0;
  if (prevLastSeq <= newLastSeq) {
    return undefined;
  }
  return { start: newLastSeq + 1, end: prevLastSeq, reason: 'rewound' };
}

/**
 * Boundary of the curated history: chronology seqs of the first and last
 * entries, or zeros for an empty history; plus the v2 membership projection —
 * compressed interior spans re-derived from each summary entry's
 * `chronologyReplaced` metadata, and `approximate` set when any entry lacks a
 * chronology marker (unmarked legacy history, membership not exactly
 * statable, `removedInterior` left empty).
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-004
 */
export function computeContextRange(
  history: readonly IContent[],
): ContextRange {
  const first = history.length > 0 ? history[0] : undefined;
  const last = history.length > 0 ? history[history.length - 1] : undefined;
  if (first === undefined || last === undefined) {
    return {
      firstSeq: 0,
      lastSeq: 0,
      totalEntries: 0,
      removedInterior: [],
      approximate: false,
    };
  }
  const approximate = history.some(
    (entry) => entry.metadata?.chronology === undefined,
  );
  const removedInterior: RemovedInteriorSpan[] = approximate
    ? []
    : mergeRemovedInteriorSpans(
        history.flatMap((entry) => {
          const replaced = entry.metadata?.chronologyReplaced;
          if (replaced === undefined) {
            return [];
          }
          return [
            {
              start: replaced.fromSeq,
              end: replaced.toSeq,
              reason: 'compressed' as const,
            },
          ];
        }),
      );
  return {
    firstSeq: first.metadata?.chronology?.seq ?? 0,
    lastSeq: last.metadata?.chronology?.seq ?? 0,
    totalEntries: history.length,
    removedInterior,
    approximate,
  };
}

/**
 * One projection per summary entry carrying a `chronologyReplaced` span.
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-004
 */
export function computeContextSummaries(
  history: readonly IContent[],
): ContextSummaryInfo[] {
  const summaries: ContextSummaryInfo[] = [];
  for (const entry of history) {
    const replaced = entry.metadata?.chronologyReplaced;
    if (replaced === undefined) {
      continue;
    }
    let text = '';
    for (const block of entry.blocks) {
      if (block.type === 'text') {
        text += block.text;
      }
    }
    summaries.push({
      seq: entry.metadata?.chronology?.seq ?? 0,
      replacedFromSeq: replaced.fromSeq,
      replacedToSeq: replaced.toSeq,
      itemCount: replaced.toSeq - replaced.fromSeq + 1,
      text,
    });
  }
  return summaries;
}

/**
 * The context-range payload for the first entry landing in an empty history:
 * boundary collapses onto the single just-stamped entry (which always carries
 * a chronology marker, so membership is exact), interior empty.
 *
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 */
export function firstEntryContextRange(content: IContent): ContextRange {
  const seq = content.metadata?.chronology?.seq ?? 0;
  return {
    firstSeq: seq,
    lastSeq: seq,
    totalEntries: 1,
    removedInterior: [],
    approximate: false,
  };
}

/**
 * The v2 snapshot a settled service reports: boundary fields derived from the
 * history array, joined with the cumulative accumulated spans plus the
 * compressed spans re-derived from summary metadata. Deterministic in its two
 * inputs, so a snapshot equals the last emitted `contextRangeChanged` payload
 * at every settle point.
 *
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 */
export function buildContextRangeSnapshot(
  history: readonly IContent[],
  accumulatedSpans: readonly RemovedInteriorSpan[],
): ContextRange {
  const derived = computeContextRange(history);
  return {
    firstSeq: derived.firstSeq,
    lastSeq: derived.lastSeq,
    totalEntries: derived.totalEntries,
    removedInterior: mergeRemovedInteriorSpans([
      ...accumulatedSpans,
      ...derived.removedInterior,
    ]),
    approximate: derived.approximate,
  };
}

/**
 * Span state after a committed batch mutation: the accumulated spans joined
 * with the mutation's own removals — density spans passed in pre-derived, a
 * strict seq-prefix truncation derived as `rewound`.
 *
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 */
export function mergeCommitSpans(
  accumulatedSpans: readonly RemovedInteriorSpan[],
  extraSpans: readonly RemovedInteriorSpan[] | undefined,
  previousHistory: readonly IContent[],
  nextHistory: readonly IContent[],
): RemovedInteriorSpan[] {
  const mutationSpans: RemovedInteriorSpan[] = [...(extraSpans ?? [])];
  const rewound = deriveRewoundSpan(previousHistory, nextHistory);
  if (rewound !== undefined) {
    mutationSpans.push(rewound);
  }
  return mergeRemovedInteriorSpans([...accumulatedSpans, ...mutationSpans]);
}

/**
 * Membership spans of the entries a validated density pass destroys: a
 * removal leaves its seq gone; a replacement leaves the ORIGINAL seq's entry
 * gone even though the replacement inherits the same seq position. Indices
 * must already be validated against `history` (validateDensityResult).
 *
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 */
export function collectDensitySpans(
  history: readonly IContent[],
  result: DensityResult,
): RemovedInteriorSpan[] {
  const spans: RemovedInteriorSpan[] = [];
  for (const index of result.removals) {
    const seq = history[index].metadata?.chronology?.seq;
    if (seq !== undefined) {
      spans.push({ start: seq, end: seq, reason: 'density-removed' });
    }
  }
  for (const index of result.replacements.keys()) {
    const seq = history[index].metadata?.chronology?.seq;
    if (seq !== undefined) {
      spans.push({ start: seq, end: seq, reason: 'density-replaced' });
    }
  }
  return spans;
}

/**
 * Span state after a clear: a `cleared` span covers the full boundary of the
 * history being dropped; accumulated spans entirely above it survive, the
 * rest are subsumed.
 *
 * @plan PLAN-20260917-ISSUE854.P03
 * @requirement G3,G4
 */
export function recordClearedSpan(
  accumulatedSpans: readonly RemovedInteriorSpan[],
  previousHistory: readonly IContent[],
): RemovedInteriorSpan[] {
  if (previousHistory.length === 0) {
    return mergeRemovedInteriorSpans(accumulatedSpans);
  }
  const firstSeq = previousHistory[0].metadata?.chronology?.seq ?? 0;
  const lastSeq =
    previousHistory[previousHistory.length - 1].metadata?.chronology?.seq ?? 0;
  const surviving = accumulatedSpans.filter((span) => span.start > lastSeq);
  return mergeRemovedInteriorSpans([
    ...surviving,
    { start: firstSeq, end: lastSeq, reason: 'cleared' },
  ]);
}
