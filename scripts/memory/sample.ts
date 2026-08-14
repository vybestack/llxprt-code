/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * JSC heap sample shape shared by the probe (writer) and the report (reader).
 *
 * Kept dependency-free so it can be exercised by behavioral tests without
 * touching bun:jsc or the filesystem.
 */

/** The subset of bun:jsc's HeapStats the probe records. */
export interface JscHeapStats {
  readonly heapSize: number;
  readonly heapCapacity: number;
  readonly extraMemorySize: number;
  readonly objectCount: number;
  readonly protectedObjectCount: number;
  readonly objectTypeCounts: Readonly<Record<string, number>>;
}

/**
 * One newline-delimited sample written to samples.jsonl.
 *
 * `types` is the JSC object-type histogram, truncated to the top entries so a
 * single sample stays small even when the heap is enormous.
 */
export interface Sample {
  readonly t: string;
  readonly tag: string;
  readonly pid: number;
  readonly rss: number;
  readonly heapSize: number;
  readonly heapCapacity: number;
  readonly extraMemorySize: number;
  readonly objectCount: number;
  readonly protectedObjectCount: number;
  readonly types: ReadonlyArray<readonly [string, number]>;
  /**
   * Request ID when this sample was produced by a request (sample or
   * post-snapshot). Absent for periodic/startup/exit samples. Used to make
   * request processing idempotent across process restarts.
   */
  readonly requestId?: string;
}

/** Default number of object-type entries retained per sample. */
export const DEFAULT_TOP_TYPES = 25;

export interface CollectSampleInput {
  readonly tag: string;
  readonly pid: number;
  readonly rss: number;
  readonly stats: JscHeapStats;
  readonly nowMs: number;
  readonly topTypes?: number;
  readonly requestId?: string;
}

/**
 * Normalizes an injectable `topTypes`: undefined becomes the default; a
 * nonfinite or nonpositive value falls back to the default rather than
 * producing an empty or enormous histogram; otherwise it is clamped to a
 * positive integer.
 */
export function normalizeTopTypes(topTypes: number | undefined): number {
  if (topTypes === undefined) {
    return DEFAULT_TOP_TYPES;
  }
  if (!Number.isFinite(topTypes) || topTypes < 1) {
    return DEFAULT_TOP_TYPES;
  }
  return Math.floor(topTypes);
}

function topTypes(
  counts: Readonly<Record<string, number>>,
  limit: number,
): ReadonlyArray<readonly [string, number]> {
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map((entry) => {
      const [type, count] = entry;
      return [type, count] as const;
    });
}

/** Builds a Sample from a JSC heap snapshot reading. Pure and injectable. */
export function collectSample(input: CollectSampleInput): Sample {
  const limit = normalizeTopTypes(input.topTypes);
  return {
    t: new Date(input.nowMs).toISOString(),
    tag: input.tag,
    pid: input.pid,
    rss: input.rss,
    heapSize: input.stats.heapSize,
    heapCapacity: input.stats.heapCapacity,
    extraMemorySize: input.stats.extraMemorySize,
    objectCount: input.stats.objectCount,
    protectedObjectCount: input.stats.protectedObjectCount,
    types: topTypes(input.stats.objectTypeCounts, limit),
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  };
}

/** Serializes a Sample as one JSONL line. */
export function formatSample(sample: Sample): string {
  return JSON.stringify(sample);
}

function isFiniteNonnegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isStringNumberPair(value: unknown): value is [string, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    isFiniteNonnegativeNumber(value[1])
  );
}

/**
 * Parses a single JSONL line into a Sample, or returns null when the line is
 * blank/corrupt. Validation fails safely: the timestamp must parse, every
 * numeric field must be a finite nonnegative number, and the types array
 * must be ENTIRELY well-formed — a partially invalid array (any malformed
 * entry) rejects the whole line rather than silently shrinking the histogram,
 * which would fabricate a false "type disappeared" signal in reports.
 */
export function parseSampleLine(line: string): Sample | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.t !== 'string' || Number.isNaN(Date.parse(record.t))) {
    return null;
  }
  if (typeof record.tag !== 'string') {
    return null;
  }
  if (
    !isFiniteNonnegativeNumber(record.pid) ||
    !isFiniteNonnegativeNumber(record.rss) ||
    !isFiniteNonnegativeNumber(record.heapSize)
  ) {
    return null;
  }
  if (
    !isFiniteNonnegativeNumber(record.heapCapacity) ||
    !isFiniteNonnegativeNumber(record.extraMemorySize)
  ) {
    return null;
  }
  if (
    !isFiniteNonnegativeNumber(record.objectCount) ||
    !isFiniteNonnegativeNumber(record.protectedObjectCount)
  ) {
    return null;
  }
  const rawTypes = record.types;
  if (!Array.isArray(rawTypes)) {
    return null;
  }
  // An all-or-nothing check: one malformed entry rejects the line.
  const types: Array<readonly [string, number]> = [];
  for (const entry of rawTypes) {
    if (!isStringNumberPair(entry)) {
      return null;
    }
    types.push(entry);
  }
  const requestId =
    typeof record.requestId === 'string' ? record.requestId : undefined;
  return {
    t: record.t,
    tag: record.tag,
    pid: record.pid,
    rss: record.rss,
    heapSize: record.heapSize,
    heapCapacity: record.heapCapacity,
    extraMemorySize: record.extraMemorySize,
    objectCount: record.objectCount,
    protectedObjectCount: record.protectedObjectCount,
    types,
    ...(requestId !== undefined ? { requestId } : {}),
  };
}

/** Parses an entire samples.jsonl blob into Samples, skipping corrupt lines. */
export function parseSamples(text: string): Sample[] {
  const samples: Sample[] = [];
  for (const line of text.split('\n')) {
    const sample = parseSampleLine(line);
    if (sample !== null) {
      samples.push(sample);
    }
  }
  return samples;
}
