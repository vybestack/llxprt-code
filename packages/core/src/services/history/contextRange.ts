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
import type { ContextRange, ContextSummaryInfo } from './historyEventTypes.js';

/**
 * Boundary of the curated history: chronology seqs of the first and last
 * entries, or zeros for an empty history.
 *
 * @plan PLAN-20260917-ISSUE854.P01
 * @requirement REQ-854-004
 */
export function computeContextRange(
  history: readonly IContent[],
): ContextRange {
  const first = history.at(0);
  const last = history.at(-1);
  if (first === undefined || last === undefined) {
    return { firstSeq: 0, lastSeq: 0, totalEntries: 0 };
  }
  return {
    firstSeq: first.metadata?.chronology?.seq ?? 0,
    lastSeq: last.metadata?.chronology?.seq ?? 0,
    totalEntries: history.length,
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
