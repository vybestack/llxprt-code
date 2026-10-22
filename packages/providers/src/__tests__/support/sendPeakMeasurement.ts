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

import type { NativeRouteCounts } from './native-route-observer.js';
import type { nativeProbeCost } from './native-probe-cost.js';
import { median } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';

/** The growth and retention allowance, the same 1 MiB the other gates use. */
export const SEND_PEAK_BOUND_BYTES = 1024 * 1024;

/** How many times the probe sends the same large history to measure retention. */
export const SEND_PEAK_ACCUMULATION_SENDS = 6;

/**
 * Settled memory after one send of the accumulation run, each figure the
 * median of three settled readings. The absolute level carries a one-time
 * offset from collection timing; only the change between sends means anything.
 */
export interface AccumulationReading {
  readonly heap: number;
  readonly arrayBuffers: number;
}

export interface SendPeakMeasurement {
  readonly nativeRoute?: NativeRouteCounts;
  readonly nativeCost?: ReturnType<ReturnType<typeof nativeProbeCost>>;
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

/**
 * The measurements of one shape: every round sends small, then large, and the
 * accumulation run sends the large history repeatedly with a settled reading
 * after each send.
 */
export interface SendPeakSeries {
  readonly small: readonly SendPeakMeasurement[];
  readonly large: readonly SendPeakMeasurement[];
  readonly accumulation: readonly AccumulationReading[];
}

function isAccumulationReading(value: unknown): value is AccumulationReading {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return (
    typeof record.heap === 'number' && typeof record.arrayBuffers === 'number'
  );
}

function isAccumulationList(value: unknown): value is AccumulationReading[] {
  return (
    Array.isArray(value) &&
    value.length === SEND_PEAK_ACCUMULATION_SENDS &&
    value.every(isAccumulationReading)
  );
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
  return (
    isMeasurementList(record.small) &&
    isMeasurementList(record.large) &&
    isAccumulationList(record.accumulation)
  );
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
  readonly protocol?: 'original-three-pair';
  /** Measured small/large pairs per shape, after one unmeasured warm-up. */
  readonly rounds: number;
  /**
   * Project and estimate the prompt before each send, inside the measured
   * window, and send with the projection's transport token.
   */
  readonly estimate: boolean;
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
  const { source, rounds, estimate, shapes, protocol } = value;
  if (protocol !== undefined && protocol !== 'original-three-pair')
    return false;
  if (protocol === 'original-three-pair' && rounds !== 3) return false;
  if (source !== 'rows' && source !== 'stream') return false;
  if (typeof estimate !== 'boolean') return false;
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
  /**
   * Growth over the sends of the accumulation run that the Theil-Sen trend of
   * the settled readings implies (slope times sends minus one), the larger of
   * the heap and the `arrayBuffers` figure. This is what the gate judges.
   */
  readonly retainedGrowth: number;
  readonly retainedGrowthWithinBound: boolean;
  /**
   * Settled growth between the first and the last send of the accumulation
   * run, larger of heap and `arrayBuffers`. Reported next to the trend value
   * for comparison; the gate does not judge it.
   */
  readonly retainedEndpointGrowth: number;
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
 * Theil-Sen slope of a series read at equally spaced sends: the median of the
 * slopes between every pair of readings. A steady per-send leak makes most
 * pairs agree on a positive slope, while one noisy reading only spoils the
 * pairs that include it and cannot move the median far.
 */
export function theilSenSlope(readings: readonly number[]): number {
  if (readings.length < 2) {
    throw new Error('a trend needs at least two readings');
  }
  const slopes: number[] = [];
  for (let first = 0; first < readings.length - 1; first++) {
    for (let second = first + 1; second < readings.length; second++) {
      slopes.push((readings[second] - readings[first]) / (second - first));
    }
  }
  return median(slopes);
}

/**
 * Growth over the sends of one series that its Theil-Sen trend implies.
 */
export function trendGrowth(readings: readonly number[]): number {
  return theilSenSlope(readings) * (readings.length - 1);
}

/**
 * Retention is what each further send leaves behind. A settled reading after
 * one send carries a one-time offset from collection timing (about -0.8 to
 * +1.7 MiB seen with no growth at all) and loaded machines add noise of their
 * own, so neither a single reading nor the two endpoints of the run can be
 * judged against a fixed bound. The same history sent again must not add to
 * the settled level: the trend across every reading is the retention, and a
 * real per-send leak adds up across the sends while an offset or an outlier
 * does not.
 */
function retainedGrowthOf(accumulation: readonly AccumulationReading[]): {
  trend: number;
  endpoints: number;
} {
  const first = accumulation[0];
  const last = accumulation[accumulation.length - 1];
  return {
    trend: Math.max(
      trendGrowth(accumulation.map((reading) => reading.heap)),
      trendGrowth(accumulation.map((reading) => reading.arrayBuffers)),
    ),
    endpoints: Math.max(
      last.heap - first.heap,
      last.arrayBuffers - first.arrayBuffers,
    ),
  };
}

export function judgeSendPeak(
  series: SendPeakSeries,
  oracles: SendPeakOracles,
): SendPeakVerdict {
  const peakHeap = perSize(series, (round) => round.peakHeap);
  const peakArrayBuffers = perSize(series, (round) => round.peakArrayBuffers);
  const heapGrowth = peakHeap.large - peakHeap.small;
  const arrayBufferGrowth = peakArrayBuffers.large - peakArrayBuffers.small;
  const retained = retainedGrowthOf(series.accumulation);
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
    retainedGrowth: retained.trend,
    retainedGrowthWithinBound: retained.trend <= SEND_PEAK_BOUND_BYTES,
    retainedEndpointGrowth: retained.endpoints,
    medians: {
      peakHeap,
      peakArrayBuffers,
      peakRss: perSize(series, (round) => round.peakRss),
      peakLive: perSize(series, (round) => round.peakLive),
    },
  };
}
