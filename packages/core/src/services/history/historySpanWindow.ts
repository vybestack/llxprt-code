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
 * @plan PLAN-20260917-ISSUE854.P05b3
 * @requirement G6
 *
 * Capped standing-state window for removed-interior spans. The journal is the
 * system of record for history contents, but membership spans for density,
 * rewind, and clear mutations are only statable at mutation time (the fold
 * shows the result, not what it destroyed), so they are captured as they
 * happen and kept in a bounded window. The cap evicts the oldest spans and is
 * far above any realistic span count between context resets: spans coalesce
 * as they accumulate and the window resets whenever history is emptied and
 * refilled (first-add) or subsumed by a clear.
 */

import type { RemovedInteriorSpan } from './historyEventTypes.js';

/** Maximum retained spans; eviction drops the oldest (lowest-start) first. */
export const SPAN_WINDOW_CAPACITY = 1024;

export class SpanWindow {
  private spans: RemovedInteriorSpan[] = [];

  /** A defensive copy of the current spans, oldest first. */
  get(): RemovedInteriorSpan[] {
    return [...this.spans];
  }

  /** Replace the window's contents, evicting the oldest past the capacity. */
  set(spans: readonly RemovedInteriorSpan[]): void {
    this.spans =
      spans.length > SPAN_WINDOW_CAPACITY
        ? spans.slice(spans.length - SPAN_WINDOW_CAPACITY).map((span) => ({ ...span }))
        : spans.map((span) => ({ ...span }));
  }
}
