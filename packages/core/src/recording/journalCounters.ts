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

import type { RowOwnership } from './rowOwnership.js';
/**
 * @plan PLAN-20260917-ISSUE854.P05d
 * @requirement G5
 *
 * Peak decoded-row counters for the journal read path (issue #854, resume
 * without materialization). Production read paths — replay, cursor, resolver,
 * bounded discovery — call an injected counters object at their own decode and
 * release points; nothing wraps internals. The counters are optional on every
 * options surface: absent means uninstrumented, with zero behavior change.
 *
 * `peakDecodedRows` covers reader ownership only. A paging read path releases
 * its charge at handoff even when a consumer still holds the row. The optional
 * ownership context measures explicitly registered consumer lifetimes separately;
 * neither counter discovers arbitrary references.
 */

/** Observe the journal read path. Production code calls these; nothing wraps internals. */
export interface JournalReadCounters {
  readonly ownership?: RowOwnership;
  /** Any journal envelope JSON-decoded by the instrumented read path. */
  recordDecoded(): void;
  /** An IContent row materialized into reader-retained state. */
  rowDecoded(): void;
  /** A previously materialized row released by the read path. */
  rowReleased(): void;
}

export interface JournalReadStats {
  readonly recordsDecoded: number;
  readonly rowsDecoded: number;
  /** High-water of (rowsDecoded - rowsReleased): rows simultaneously held by the read path. */
  readonly peakDecodedRows: number;
}

/** A counters object plus a live snapshot of its accumulated stats. */
export interface RowCounters {
  readonly counters: JournalReadCounters;
  snapshot(): JournalReadStats;
}

/**
 * Build a fresh counters object. Counter calls are sync, cheap, and
 * failure-free; the snapshot is a pure fold of the calls received so far.
 */
export function createRowCounters(): RowCounters {
  let recordsDecoded = 0;
  let rowsDecoded = 0;
  let rowsReleased = 0;
  let peakDecodedRows = 0;
  const counters: JournalReadCounters = {
    recordDecoded: () => {
      recordsDecoded += 1;
    },
    rowDecoded: () => {
      rowsDecoded += 1;
      peakDecodedRows = Math.max(peakDecodedRows, rowsDecoded - rowsReleased);
    },
    rowReleased: () => {
      rowsReleased += 1;
    },
  };
  return {
    counters,
    snapshot: () => ({
      recordsDecoded,
      rowsDecoded,
      peakDecodedRows,
    }),
  };
}
