/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854 step A2: what the send-peak probe measures and how the test
 * judges the measurements of one route and shape (the small and the large body,
 * each sent for several rounds).
 */

import { median } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';

/** The growth and retention allowance, the same 1 MiB the other gates use. */
export const SEND_PEAK_BOUND_BYTES = 1024 * 1024;

export interface SendPeakMeasurement {
  readonly routeId: string;
  readonly trap: string | null;
  /** Body bytes the transport saw, and their sha-256. */
  readonly bytes: number;
  readonly sha256: string;
  /** The content-length header text, or null when the request had none. */
  readonly contentLength: string | null;
  readonly chunks: number;
  readonly modelRequests: number;
  /** Largest in-flight settled-heap growth over the baseline. */
  readonly peakHeap: number;
  /** Largest in-flight `arrayBuffers` growth over the baseline. */
  readonly peakArrayBuffers: number;
  readonly peakRss: number;
  readonly samples: number;
  /** Most of the newest 64 rows read that were alive at once at a sample. */
  readonly peakLive: number;
  /** Settled growth over the baseline after the send finished. */
  readonly retainedHeap: number;
  readonly retainedArrayBuffers: number;
}

const NUMBER_FIELDS = [
  'bytes',
  'chunks',
  'modelRequests',
  'peakHeap',
  'peakArrayBuffers',
  'peakRss',
  'samples',
  'peakLive',
  'retainedHeap',
  'retainedArrayBuffers',
] as const;

function isSendPeakMeasurement(value: unknown): value is SendPeakMeasurement {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  if (typeof record.routeId !== 'string') return false;
  if (typeof record.sha256 !== 'string') return false;
  if (record.trap !== null && typeof record.trap !== 'string') return false;
  if (record.contentLength !== null && typeof record.contentLength !== 'string')
    return false;
  return NUMBER_FIELDS.every((field) => typeof record[field] === 'number');
}

/** The measured rounds of one shape: every round sends small, then large. */
export interface SendPeakSeries {
  readonly small: readonly SendPeakMeasurement[];
  readonly large: readonly SendPeakMeasurement[];
}

function isMeasurementList(value: unknown): value is SendPeakMeasurement[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every(isSendPeakMeasurement)
  );
}

export function isSendPeakSeries(value: unknown): value is SendPeakSeries {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return isMeasurementList(record.small) && isMeasurementList(record.large);
}

/** Row counts of the two sizes of one shape. */
export interface ShapeCounts {
  readonly small: number;
  readonly large: number;
}

/** Which rows the provider is handed: a replayable selection or a one-shot stream. */
export type SendPeakSource = 'rows' | 'stream';

/** What the parent asks the child to measure. */
export interface SendPeakPlan {
  readonly source: SendPeakSource;
  /** Measured small/large pairs per shape, after one unmeasured warm-up. */
  readonly rounds: number;
  readonly shapes: Readonly<Record<string, ShapeCounts>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isShapeCounts(value: unknown): value is ShapeCounts {
  return (
    isRecord(value) &&
    typeof value.small === 'number' &&
    typeof value.large === 'number'
  );
}

export function isSendPeakPlan(value: unknown): value is SendPeakPlan {
  if (!isRecord(value)) return false;
  const { source, rounds, shapes } = value;
  if (source !== 'rows' && source !== 'stream') return false;
  if (typeof rounds !== 'number' || !isRecord(shapes)) return false;
  return Object.values(shapes).every(isShapeCounts);
}

export interface SendPeakBody {
  readonly bytes: number;
  readonly sha256: string;
}

export interface SendPeakOracles {
  readonly small: SendPeakBody;
  readonly large: SendPeakBody;
}

export interface SendPeakVerdict {
  /** Every round of both sizes sent exactly the bytes today's code produces. */
  readonly bytesMatchOracle: boolean;
  /** Where a content-length header was sent, it equals the body bytes. */
  readonly contentLengthMatchesBytes: boolean;
  /** Median settled-heap peak at the large size minus the one at the small. */
  readonly heapGrowth: number;
  readonly heapGrowthWithinBound: boolean;
  /** Median `arrayBuffers` peak at the large size minus the one at the small. */
  readonly arrayBufferGrowth: number;
  readonly arrayBufferGrowthWithinBound: boolean;
  /** Largest persistent (minimum over rounds) retained growth, over both sizes and signals. */
  readonly retained: number;
  readonly retainedWithinBound: boolean;
  /** Median peaks per size, kept for reporting. */
  readonly medians: {
    readonly peakHeap: { readonly small: number; readonly large: number };
    readonly peakArrayBuffers: {
      readonly small: number;
      readonly large: number;
    };
    readonly peakRss: { readonly small: number; readonly large: number };
    readonly peakLive: { readonly small: number; readonly large: number };
  };
}

function sameBody(
  measured: readonly SendPeakMeasurement[],
  oracle: SendPeakBody,
): boolean {
  return measured.every(
    (round) => round.bytes === oracle.bytes && round.sha256 === oracle.sha256,
  );
}

function contentLengthMatches(
  measured: readonly SendPeakMeasurement[],
): boolean {
  return measured.every(
    (round) =>
      round.contentLength === null || round.contentLength === `${round.bytes}`,
  );
}

function medianOf(
  rounds: readonly SendPeakMeasurement[],
  pick: (round: SendPeakMeasurement) => number,
): number {
  return median(rounds.map(pick));
}

function perSize(
  series: SendPeakSeries,
  pick: (round: SendPeakMeasurement) => number,
): { small: number; large: number } {
  return {
    small: medianOf(series.small, pick),
    large: medianOf(series.large, pick),
  };
}

/**
 * Retention is what stays after every round. Each send is baselined on the
 * quiet reading after the previous one, so allocator and code-cache jitter
 * moves the retained figure of the small and large sends in opposite
 * directions by a MiB or so. A real leak persists across rounds and survives
 * the minimum; the bound itself is not widened.
 */
function persistentRetained(
  rounds: readonly SendPeakMeasurement[],
  pick: (round: SendPeakMeasurement) => number,
): number {
  return Math.min(...rounds.map(pick));
}

export function judgeSendPeak(
  series: SendPeakSeries,
  oracles: SendPeakOracles,
): SendPeakVerdict {
  const peakHeap = perSize(series, (round) => round.peakHeap);
  const peakArrayBuffers = perSize(series, (round) => round.peakArrayBuffers);
  const heapGrowth = peakHeap.large - peakHeap.small;
  const arrayBufferGrowth = peakArrayBuffers.large - peakArrayBuffers.small;
  const retained = Math.max(
    ...[series.small, series.large].flatMap((rounds) => [
      persistentRetained(rounds, (round) => round.retainedHeap),
      persistentRetained(rounds, (round) => round.retainedArrayBuffers),
    ]),
  );
  return {
    bytesMatchOracle:
      sameBody(series.small, oracles.small) &&
      sameBody(series.large, oracles.large),
    contentLengthMatchesBytes:
      contentLengthMatches(series.small) && contentLengthMatches(series.large),
    heapGrowth,
    heapGrowthWithinBound: heapGrowth <= SEND_PEAK_BOUND_BYTES,
    arrayBufferGrowth,
    arrayBufferGrowthWithinBound: arrayBufferGrowth <= SEND_PEAK_BOUND_BYTES,
    retained,
    retainedWithinBound: retained <= SEND_PEAK_BOUND_BYTES,
    medians: {
      peakHeap,
      peakArrayBuffers,
      peakRss: perSize(series, (round) => round.peakRss),
      peakLive: perSize(series, (round) => round.peakLive),
    },
  };
}
