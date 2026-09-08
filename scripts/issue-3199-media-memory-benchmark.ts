/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Buffer } from 'node:buffer';
import type { MediaLifecycleMetricsSnapshot } from '../packages/core/src/storage/media-lifecycle-metrics.js';
import { evaluateBoundedPlateau } from './issue-2852-memory-benchmark.js';

export const MIN_MEDIA_PROBE_TURNS = 5;
export const MEDIA_CONTENT_ID_PATTERN = /^sha256:[0-9a-f]{64}$/;

export interface MediaProbeBounds {
  readonly storeQuotaBytes: number;
  readonly requestBudgetBytes: number;
  readonly recordingQueueBytes: number;
  readonly persistenceQueueBytes: number;
  readonly providerFileMaxFiles: number;
  readonly providerFileMaxBytes: number;
}

export interface MediaProbeTurnSample {
  readonly turn: number;
  readonly contentId: string;
  readonly uniqueContentCount: number;
  readonly active: MediaLifecycleMetricsSnapshot;
  readonly settled: MediaLifecycleMetricsSnapshot;
  readonly transportBytes: number;
  readonly settledActiveRequestCount: number;
  readonly settledReservedContentCount: number;
  readonly settledPendingReleaseCount: number;
  readonly settledStoreReadCount: number;
  readonly settledProviderFileCount: number;
  readonly settledHistoryContentCount: number;
  readonly settledSupersededHistoryOwnerCount: number;
  readonly bounds: MediaProbeBounds;
}

export interface MediaMetricPlateauVerdict {
  readonly name: string;
  readonly available: boolean;
  readonly observations: readonly number[];
  readonly baselineBytes: number | null;
  readonly maxBytes: number | null;
  readonly relativeTolerance: number;
  readonly absoluteAllowanceBytes: number;
  readonly withinTolerance: boolean;
  readonly boundBytes: number | null;
}

export interface MediaProbePlateauResult {
  readonly overallWithinTolerance: boolean;
  readonly warmupExcludedTurns: readonly number[];
  readonly metrics: readonly MediaMetricPlateauVerdict[];
}

const KIBIBYTE = 1024;
const MEBIBYTE = 1024 * KIBIBYTE;

const VALID_ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl7sAAAAASUVORK5CYII=',
    'base64',
  ),
);

/**
 * Deterministic per-turn image payload for the media memory probe. The valid PNG remains
 * intact at the start of the payload, while trailing bytes carry a distinct turn marker
 * and fill value so each turn has a different SHA-256 identity at the same byte length.
 */
export function mediaProbeImageBytes(
  turn: number,
  byteLength: number,
): Uint8Array {
  if (!Number.isSafeInteger(turn) || turn <= 0) {
    throw new Error('Media probe turn must be a positive safe integer');
  }
  if (
    !Number.isSafeInteger(byteLength) ||
    byteLength < VALID_ONE_PIXEL_PNG.byteLength + 4
  ) {
    throw new Error(
      `Media probe image byte length must be at least ${VALID_ONE_PIXEL_PNG.byteLength + 4} bytes`,
    );
  }
  const fill = 0x6d ^ (turn & 0xff);
  const bytes = new Uint8Array(byteLength).fill(fill);
  bytes.set(VALID_ONE_PIXEL_PNG, 0);
  bytes.set(
    [turn & 0xff, (turn >> 8) & 0xff, (turn >> 16) & 0xff, (turn >> 24) & 0xff],
    VALID_ONE_PIXEL_PNG.byteLength,
  );
  return bytes;
}

type MetricKind = 'plateau' | 'bounded-growth';

interface MetricSpec {
  readonly name: string;
  readonly relativeTolerance: number;
  readonly absoluteAllowanceBytes: number;
  readonly optional: boolean;
  readonly kind: MetricKind;
  readonly bound?: (bounds: MediaProbeBounds) => number;
  read(sample: MediaProbeTurnSample): number | null;
}

const METRIC_SPECS: readonly MetricSpec[] = [
  {
    name: 'localRetainedBlobBytes',
    relativeTolerance: 0,
    absoluteAllowanceBytes: 0,
    optional: false,
    kind: 'bounded-growth',
    read: (sample) => sample.settled.localRetainedBlobBytes,
  },
  {
    name: 'residentEncodedBytes',
    relativeTolerance: 0,
    absoluteAllowanceBytes: 0,
    optional: false,
    kind: 'plateau',
    read: (sample) => sample.settled.residentEncodedBytes,
  },
  {
    name: 'activeRequestMaterializationBytes',
    relativeTolerance: 0.05,
    absoluteAllowanceBytes: 64 * KIBIBYTE,
    optional: false,
    kind: 'bounded-growth',
    bound: (bounds) => bounds.requestBudgetBytes,
    read: (sample) => sample.active.activeRequestMaterializationBytes,
  },
  {
    name: 'recordingQueueBytes',
    relativeTolerance: 0.25,
    absoluteAllowanceBytes: 64 * KIBIBYTE,
    optional: false,
    kind: 'plateau',
    bound: (bounds) => bounds.recordingQueueBytes,
    read: (sample) => sample.active.recordingQueueBytes,
  },
  {
    name: 'persistenceQueueBytes',
    relativeTolerance: 0.25,
    absoluteAllowanceBytes: 64 * KIBIBYTE,
    optional: false,
    kind: 'plateau',
    bound: (bounds) => bounds.persistenceQueueBytes,
    read: (sample) => sample.active.persistenceQueueBytes,
  },
  {
    name: 'diskSpoolBytes',
    relativeTolerance: 0,
    absoluteAllowanceBytes: 0,
    optional: false,
    kind: 'bounded-growth',
    read: (sample) => sample.settled.diskSpoolBytes,
  },
  {
    name: 'decodedImageCacheEntries',
    relativeTolerance: 0,
    absoluteAllowanceBytes: 0,
    optional: true,
    kind: 'plateau',
    read: (sample) => sample.settled.decodedImageCache.entries,
  },
  {
    name: 'decodedImageCacheBytes',
    relativeTolerance: 0,
    absoluteAllowanceBytes: 0,
    optional: true,
    kind: 'plateau',
    read: (sample) => sample.settled.decodedImageCache.bytes,
  },
  {
    name: 'providerFileRetainedBytes',
    relativeTolerance: 0,
    absoluteAllowanceBytes: 0,
    optional: false,
    kind: 'plateau',
    bound: (bounds) => bounds.providerFileMaxBytes,
    read: (sample) => sample.settled.providerFileRetainedBytes,
  },
  {
    name: 'heapUsed',
    relativeTolerance: 0.15,
    absoluteAllowanceBytes: 32 * MEBIBYTE,
    optional: false,
    kind: 'plateau',
    read: (sample) => sample.settled.process.heapUsed,
  },
  {
    name: 'external',
    relativeTolerance: 0.15,
    absoluteAllowanceBytes: 4 * MEBIBYTE,
    optional: false,
    kind: 'plateau',
    read: (sample) => sample.settled.process.external,
  },
  {
    name: 'arrayBuffers',
    relativeTolerance: 0.15,
    absoluteAllowanceBytes: 4 * MEBIBYTE,
    optional: false,
    kind: 'plateau',
    read: (sample) => sample.settled.process.arrayBuffers,
  },
  {
    name: 'rss',
    relativeTolerance: 0.15,
    absoluteAllowanceBytes: 32 * MEBIBYTE,
    optional: false,
    kind: 'plateau',
    read: (sample) => sample.settled.process.rss,
  },
  {
    name: 'osPeakFootprintBytes',
    relativeTolerance: 0.15,
    absoluteAllowanceBytes: 32 * MEBIBYTE,
    optional: true,
    kind: 'plateau',
    read: (sample) => sample.settled.osPeakFootprintBytes,
  },
];

function requireMeasurement(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Media probe is missing required measurement ${name}`);
  }
  return value;
}

function assertNewContentId(sample: MediaProbeTurnSample): void {
  if (!MEDIA_CONTENT_ID_PATTERN.test(sample.contentId)) {
    throw new Error(`Media probe content ID is malformed: ${sample.contentId}`);
  }
}

function sameBounds(left: MediaProbeBounds, right: MediaProbeBounds): boolean {
  const pairs: ReadonlyArray<readonly [number, number]> = [
    [left.storeQuotaBytes, right.storeQuotaBytes],
    [left.requestBudgetBytes, right.requestBudgetBytes],
    [left.recordingQueueBytes, right.recordingQueueBytes],
    [left.persistenceQueueBytes, right.persistenceQueueBytes],
    [left.providerFileMaxFiles, right.providerFileMaxFiles],
    [left.providerFileMaxBytes, right.providerFileMaxBytes],
  ];
  return pairs.every(([leftValue, rightValue]) => leftValue === rightValue);
}

function validateSample(sample: MediaProbeTurnSample): void {
  requireMeasurement('turn', sample.turn);
  assertNewContentId(sample);
  requireMeasurement('uniqueContentCount', sample.uniqueContentCount);
  requireMeasurement('transportBytes', sample.transportBytes);
  requireMeasurement(
    'settledActiveRequestCount',
    sample.settledActiveRequestCount,
  );
  requireMeasurement(
    'settledReservedContentCount',
    sample.settledReservedContentCount,
  );
  requireMeasurement(
    'settledPendingReleaseCount',
    sample.settledPendingReleaseCount,
  );
  requireMeasurement('settledStoreReadCount', sample.settledStoreReadCount);
  requireMeasurement(
    'settledProviderFileCount',
    sample.settledProviderFileCount,
  );
  requireMeasurement(
    'settledHistoryContentCount',
    sample.settledHistoryContentCount,
  );
  requireMeasurement(
    'settledSupersededHistoryOwnerCount',
    sample.settledSupersededHistoryOwnerCount,
  );
  for (const [name, value] of Object.entries(sample.bounds)) {
    requireMeasurement(`bounds.${name}`, value);
  }
  for (const spec of METRIC_SPECS) {
    const value = spec.read(sample);
    if (value === null) {
      if (!spec.optional) {
        throw new Error(
          `Media probe is missing required measurement ${spec.name}`,
        );
      }
      continue;
    }
    requireMeasurement(spec.name, value);
  }
}

function enforceBound(
  name: string,
  value: number,
  bound: number,
  turn: number,
): void {
  if (value > bound) {
    throw new Error(
      `Media probe ${name} bound on turn ${turn} exceeded: ${value} > ${bound}`,
    );
  }
}

function validateLifecyclePaths(
  samples: readonly MediaProbeTurnSample[],
): void {
  const requiredPathsObserved = [
    samples.some(
      (sample) => sample.active.activeRequestMaterializationBytes > 0,
    ),
    samples.some((sample) => sample.active.recordingQueueBytes > 0),
    samples.some((sample) => sample.active.persistenceQueueBytes > 0),
    samples.some((sample) => sample.settled.localRetainedBlobBytes > 0),
    samples.some((sample) => sample.settled.diskSpoolBytes > 0),
    samples.some((sample) => sample.settled.providerFileRetainedBytes > 0),
    samples.some((sample) => sample.transportBytes > 0),
    samples.some((sample) => sample.settledStoreReadCount > 0),
  ];
  if (requiredPathsObserved.includes(false)) {
    throw new Error(
      'Media probe did not exercise every required lifecycle path',
    );
  }
}

function validateUniqueContent(samples: readonly MediaProbeTurnSample[]): void {
  const seen = new Set<string>();
  const expectedUniqueCounts: number[] = [];
  for (const sample of samples) {
    if (seen.has(sample.contentId)) {
      throw new Error(
        `Media probe reused content ID ${sample.contentId} on turn ${sample.turn}`,
      );
    }
    seen.add(sample.contentId);
    expectedUniqueCounts.push(seen.size);
  }
  if (
    samples.some(
      (sample, index) =>
        sample.uniqueContentCount !== expectedUniqueCounts[index],
    )
  ) {
    throw new Error(
      'Media probe unique content count does not match observed content IDs',
    );
  }
}

function validateTurnBounds(
  sample: MediaProbeTurnSample,
  bounds: MediaProbeBounds,
): void {
  const measurements: ReadonlyArray<readonly [string, number, number]> = [
    ['store quota', sample.settled.diskSpoolBytes, bounds.storeQuotaBytes],
    [
      'store quota',
      sample.settled.localRetainedBlobBytes,
      bounds.storeQuotaBytes,
    ],
    [
      'request budget',
      sample.active.activeRequestMaterializationBytes,
      bounds.requestBudgetBytes,
    ],
    [
      'recording queue',
      sample.active.recordingQueueBytes,
      bounds.recordingQueueBytes,
    ],
    [
      'persistence queue',
      sample.active.persistenceQueueBytes,
      bounds.persistenceQueueBytes,
    ],
    [
      'provider file max bytes',
      sample.settled.providerFileRetainedBytes,
      bounds.providerFileMaxBytes,
    ],
    [
      'provider file max files',
      sample.settledProviderFileCount,
      bounds.providerFileMaxFiles,
    ],
  ];
  for (const [name, value, bound] of measurements) {
    enforceBound(name, value, bound, sample.turn);
  }
}

function validateTurnSettlement(sample: MediaProbeTurnSample): void {
  if (
    sample.settledActiveRequestCount !== 0 ||
    sample.settledReservedContentCount !== 0 ||
    sample.settledPendingReleaseCount !== 0
  ) {
    throw new Error(
      `Media probe turn ${sample.turn} did not settle its request: ` +
        `${sample.settledActiveRequestCount} active, ` +
        `${sample.settledReservedContentCount} reserved, ` +
        `${sample.settledPendingReleaseCount} pending releases`,
    );
  }
  if (
    sample.settled.activeRequestMaterializationBytes !== 0 ||
    sample.settled.recordingQueueBytes !== 0 ||
    sample.settled.persistenceQueueBytes !== 0
  ) {
    throw new Error(
      `Media probe turn ${sample.turn} did not release request and queue bytes`,
    );
  }
  if (sample.settledHistoryContentCount !== 1) {
    throw new Error(
      `Media probe turn ${sample.turn} retained ${sample.settledHistoryContentCount} history entries instead of one`,
    );
  }
  if (sample.settledSupersededHistoryOwnerCount !== 0) {
    throw new Error(
      `Media probe turn ${sample.turn} retained ${sample.settledSupersededHistoryOwnerCount} superseded history owners`,
    );
  }
}

function validateWorkload(samples: readonly MediaProbeTurnSample[]): void {
  validateLifecyclePaths(samples);
  validateUniqueContent(samples);
  const first = samples[0];
  if (first === undefined) {
    throw new Error('Media probe requires at least one sample');
  }
  const bounds = first.bounds;
  if (samples.some((sample) => !sameBounds(sample.bounds, bounds))) {
    throw new Error('Media probe configured bounds changed between turns');
  }
  for (const sample of samples) {
    validateTurnBounds(sample, bounds);
    validateTurnSettlement(sample);
  }
}

function evaluateMetric(
  spec: MetricSpec,
  samples: readonly MediaProbeTurnSample[],
): MediaMetricPlateauVerdict {
  const values = samples.map((sample) => spec.read(sample));
  const availableValues = values.filter(
    (value): value is number => value !== null,
  );
  const unavailableResult: MediaMetricPlateauVerdict = {
    name: spec.name,
    available: false,
    observations: [],
    baselineBytes: null,
    maxBytes: null,
    relativeTolerance: spec.relativeTolerance,
    absoluteAllowanceBytes: spec.absoluteAllowanceBytes,
    withinTolerance: true,
    boundBytes: null,
  };
  if (availableValues.length === 0 && spec.optional) {
    return unavailableResult;
  }
  if (availableValues.length !== values.length) {
    throw new Error(`Media probe is missing required measurement ${spec.name}`);
  }
  const settledValues = availableValues.slice(1);
  if (spec.kind === 'bounded-growth') {
    const bounds = samples[0].bounds;
    const bound = spec.bound?.(bounds) ?? bounds.storeQuotaBytes;
    const withinTolerance = availableValues.every((value) => value <= bound);
    return {
      name: spec.name,
      available: true,
      observations: availableValues,
      baselineBytes: availableValues[0] ?? null,
      maxBytes:
        availableValues.length === 0 ? null : Math.max(...availableValues),
      relativeTolerance: spec.relativeTolerance,
      absoluteAllowanceBytes: spec.absoluteAllowanceBytes,
      withinTolerance,
      boundBytes: bound,
    };
  }
  const plateau = evaluateBoundedPlateau(
    settledValues,
    spec.relativeTolerance,
    spec.absoluteAllowanceBytes,
  );
  const bound = spec.bound?.(samples[0].bounds) ?? null;
  let withinTolerance = plateau.withinTolerance;
  if (bound !== null) {
    withinTolerance &&= availableValues.every((value) => value <= bound);
  }
  if (
    spec.name === 'activeRequestMaterializationBytes' ||
    spec.name === 'recordingQueueBytes' ||
    spec.name === 'persistenceQueueBytes'
  ) {
    withinTolerance &&= samples.every(
      (sample) =>
        sample.settled.activeRequestMaterializationBytes === 0 &&
        sample.settled.recordingQueueBytes === 0 &&
        sample.settled.persistenceQueueBytes === 0,
    );
  }
  return {
    name: spec.name,
    available: true,
    observations: settledValues,
    baselineBytes: plateau.baselineBytes,
    maxBytes: plateau.maxBytes,
    relativeTolerance: spec.relativeTolerance,
    absoluteAllowanceBytes: spec.absoluteAllowanceBytes,
    withinTolerance,
    boundBytes: bound,
  };
}

/**
 * Excludes the first turn as warm-up, then evaluates each production metric
 * independently while retaining all settled observations in the result. Unique spool
 * metrics are verified against their configured store quota rather than a flat plateau;
 * process metrics must plateau.
 */
export function evaluateMediaProbePlateaus(
  samples: readonly MediaProbeTurnSample[],
): MediaProbePlateauResult {
  if (samples.length < MIN_MEDIA_PROBE_TURNS) {
    throw new Error(
      `Media plateau needs at least ${MIN_MEDIA_PROBE_TURNS} turns including warm-up`,
    );
  }
  for (const sample of samples) validateSample(sample);
  if (
    samples[0].turn !== 1 ||
    samples.some(
      (sample, index) => index > 0 && sample.turn <= samples[index - 1].turn,
    )
  ) {
    throw new Error(
      'Media probe samples must be ordered by increasing turn starting at turn 1',
    );
  }
  validateWorkload(samples);
  const metrics = METRIC_SPECS.map((spec) => evaluateMetric(spec, samples));
  return {
    overallWithinTolerance: metrics.every((metric) => metric.withinTolerance),
    warmupExcludedTurns: samples.slice(1).map((sample) => sample.turn),
    metrics,
  };
}
