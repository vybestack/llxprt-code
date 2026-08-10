/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Canonical read-time memory slope derivation (P10/P11, AC-10).
 *
 * This is the SINGLE owner of the generic memory slope algorithm and its
 * types. It lives below the CLI layer (in telemetry) so both the longitudinal
 * report and the CLI live view (`/perf`) import one shared implementation
 * instead of maintaining parallel copies.
 *
 * Two axes separate legitimate growth (tracks work) from a leak (tracks
 * uptime):
 *  - per-operation: least-squares of each memory column on
 *    `session_operation_index` using operation records.
 *  - per-minute: least-squares of each memory column on `uptime_ms` using
 *    `memory_sample` rows, scaled to bytes/min.
 *
 * P11 invokes these once per run/file so memory slopes are per run/file,
 * never accidentally pooled across process uptimes / session indices.
 *
 * Robustness: requires >=2 usable points and nonzero x variance; otherwise
 * returns null (never NaN/Infinity). Negative slopes are preserved.
 */

import type {
  PerfOperationRecord,
  PerfMemorySampleRecord,
} from './perfRecords.js';

/** The per-operation slope for each of the four memory values. */
export interface PerOperationMemorySlope {
  readonly rss_bytes_per_operation: number | null;
  readonly heap_used_bytes_per_operation: number | null;
  readonly external_bytes_per_operation: number | null;
  readonly array_buffers_bytes_per_operation: number | null;
}

/** The per-minute slope for each of the four memory values. */
export interface PerMinuteMemorySlope {
  readonly rss_bytes_per_minute: number | null;
  readonly heap_used_bytes_per_minute: number | null;
  readonly external_bytes_per_minute: number | null;
  readonly array_buffers_bytes_per_minute: number | null;
}

const MS_PER_MINUTE = 60_000;

/**
 * Ordinary-least-squares slope of y on x. Returns null when fewer than 2 points
 * or the x variance is zero. Also returns null for any non-finite result.
 */
function leastSquaresSlope(
  points: ReadonlyArray<readonly [number, number]>,
): number | null {
  if (points.length < 2) return null;

  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  for (const [x, y] of points) {
    sumX += x;
    sumY += y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let numerator = 0;
  let denominator = 0;
  for (const [x, y] of points) {
    const dx = x - meanX;
    numerator += dx * (y - meanY);
    denominator += dx * dx;
  }

  if (denominator === 0) return null;

  const slope = numerator / denominator;
  if (!Number.isFinite(slope)) return null;
  return slope;
}

function slopeFromOps(
  operations: readonly PerfOperationRecord[],
  getMem: (op: PerfOperationRecord) => number | undefined,
): number | null {
  const points: Array<[number, number]> = [];
  for (const op of operations) {
    const mem = getMem(op);
    if (mem !== undefined) {
      points.push([op.session_operation_index, mem]);
    }
  }
  return leastSquaresSlope(points);
}

/**
 * Derives the per-operation memory slope from operation records (P10 parity).
 * Only records carrying the specific memory column contribute. Invoked once
 * per run/file.
 */
export function derivePerOperationMemorySlope(
  operations: readonly PerfOperationRecord[],
): PerOperationMemorySlope {
  return {
    rss_bytes_per_operation: slopeFromOps(operations, (o) => o.rss_bytes),
    heap_used_bytes_per_operation: slopeFromOps(
      operations,
      (o) => o.heap_used_bytes,
    ),
    external_bytes_per_operation: slopeFromOps(
      operations,
      (o) => o.external_bytes,
    ),
    array_buffers_bytes_per_operation: slopeFromOps(
      operations,
      (o) => o.array_buffers_bytes,
    ),
  };
}

/**
 * Derives the per-minute memory slope from memory_sample records (P10 parity).
 * Regression on uptime_ms, scaled to bytes/min. Invoked once per run/file.
 */
export function derivePerMinuteMemorySlope(
  samples: readonly PerfMemorySampleRecord[],
): PerMinuteMemorySlope {
  const slope = (
    getMem: (s: PerfMemorySampleRecord) => number,
  ): number | null => {
    const points: Array<[number, number]> = samples.map((s) => [
      s.uptime_ms,
      getMem(s),
    ]);
    const bytesPerMs = leastSquaresSlope(points);
    if (bytesPerMs === null) return null;
    return bytesPerMs * MS_PER_MINUTE;
  };

  return {
    rss_bytes_per_minute: slope((s) => s.rss_bytes),
    heap_used_bytes_per_minute: slope((s) => s.heap_used_bytes),
    external_bytes_per_minute: slope((s) => s.external_bytes),
    array_buffers_bytes_per_minute: slope((s) => s.array_buffers_bytes),
  };
}
