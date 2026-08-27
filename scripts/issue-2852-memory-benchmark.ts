/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ExactProcess {
  readonly pid: number;
  readonly command: string;
}

export interface VmmapSummary {
  readonly physicalFootprintBytes: number;
  readonly mallocEmptyDirtyBytes: number;
  readonly webkitMallocDirtyBytes: number;
  readonly ioGraphicsDirtyBytes: number;
}

export function validateExactPid(pid: number, psOutput: string): ExactProcess {
  const fields = psOutput.trim().match(/^(\d+)\s+(\S.*)$/);
  if (fields === null || Number(fields[1]) !== pid) {
    throw new Error(`Expected exact PID ${pid}`);
  }
  return { pid, command: fields[2] };
}

export function parsePsRssBytes(output: string, pid: number): number {
  const fields = output.trim().match(/^(\d+)\s+(\d+)\s+(\S.*)$/);
  if (fields === null || Number(fields[1]) !== pid) {
    throw new Error(`Expected exact PID ${pid} in RSS sample`);
  }
  const rssKilobytes = Number(fields[2]);
  if (!Number.isFinite(rssKilobytes) || rssKilobytes < 0) {
    throw new Error(`Invalid RSS value: ${fields[2]}`);
  }
  return rssKilobytes * 1024;
}

export function parseVmmapSummary(output: string): VmmapSummary {
  return {
    physicalFootprintBytes: requireMetric(
      output,
      /Physical footprint:\s*(\d+(?:\.\d+)?\s*[KMG]?B?)/i,
      'physical footprint',
    ),
    mallocEmptyDirtyBytes: parseRegionDirty(output, 'MALLOC_SMALL (empty)'),
    webkitMallocDirtyBytes: parseRegionDirty(output, 'WebKit Malloc'),
    ioGraphicsDirtyBytes:
      parseRegionDirty(output, 'IOAccelerator') +
      parseRegionDirty(output, 'IOSurface'),
  };
}

export function parseFootprintBytes(output: string): number {
  return requireMetric(
    output,
    /phys_footprint:\s*(\d+(?:\.\d+)?\s*[KMG]?B)/i,
    'physical footprint total',
  );
}

export function validateCheckpointOrder(names: readonly string[]): boolean {
  const expected = expectedCheckpointNames(countTurns(names));
  if (names.join(',') !== expected.join(',')) {
    throw new Error('Invalid checkpoint order');
  }
  return true;
}

function countTurns(names: readonly string[]): number {
  return names.filter((name) => name.endsWith('-post-gc')).length;
}

export function expectedCheckpointNames(turns: number): string[] {
  const names = ['baseline'];
  for (let turn = 1; turn <= turns; turn += 1) {
    names.push(`turn-${turn}-pre-gc`, `turn-${turn}-post-gc`);
  }
  return names;
}

/**
 * Post-GC heap readings for equivalent repeated turns, oldest first.
 *
 * Issue #2852 requires that repeated equivalent turns reach a stable post-GC
 * plateau. Growth is measured against the first settled turn rather than the
 * very first, because the first turn also warms caches that legitimately
 * persist (tokenizers, regex compilation, module state).
 */
export interface PlateauResult {
  readonly settledBaselineBytes: number;
  readonly maxBytes: number;
  readonly growthRatio: number;
  readonly withinTolerance: boolean;
}

export interface CheckpointRecord {
  readonly name?: string;
  readonly jsc?: { readonly heapSize?: number };
  readonly processMemory?: { readonly external?: number };
}

/**
 * Parses the target's checkpoint JSONL and keeps the post-GC records.
 *
 * A parse failure names the 1-based line as it appears in the file, because a
 * bare SyntaxError identifies neither the file nor which of several hundred
 * records is malformed. Line numbers are captured before blank lines are
 * dropped, so the reported number survives blank lines anywhere in the file.
 * The error is re-thrown, never swallowed: a corrupt artifact must fail the run.
 */
export function parsePostGcRecords(
  path: string,
  contents: string,
): CheckpointRecord[] {
  return contents
    .split('\n')
    .map((line, index) => ({ line, lineNumber: index + 1 }))
    .filter(({ line }) => line.trim().length > 0)
    .map(({ line, lineNumber }) => {
      try {
        return JSON.parse(line) as CheckpointRecord;
      } catch (error) {
        throw new Error(
          `${path} line ${lineNumber} is not valid JSON: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    })
    .filter((record) => record.name?.endsWith('-post-gc') === true);
}

export function evaluatePostGcPlateau(
  postGcHeapBytes: readonly number[],
  tolerance: number,
): PlateauResult {
  if (postGcHeapBytes.length < 3) {
    throw new Error('Plateau needs at least three post-GC turns');
  }
  if (!(tolerance > 0)) {
    throw new Error('Tolerance must be positive');
  }
  const settled = postGcHeapBytes.slice(1);
  const settledBaselineBytes = settled[0];
  if (settledBaselineBytes <= 0) {
    throw new Error('Post-GC heap readings must be positive');
  }
  const maxBytes = settled.reduce(
    (highest, value) => (value > highest ? value : highest),
    settledBaselineBytes,
  );
  const growthRatio = maxBytes / settledBaselineBytes - 1;
  return {
    settledBaselineBytes,
    maxBytes,
    growthRatio,
    // Compared multiplicatively rather than against `growthRatio`: the
    // subtraction in the ratio loses precision, so growth of exactly the
    // tolerance would otherwise be reported as a leak.
    withinTolerance: maxBytes <= settledBaselineBytes * (1 + tolerance),
  };
}

/**
 * Post-GC memory readings for one turn, combining the three required metrics:
 * JSC heap size, process.memoryUsage().external, and dirty WebKit Malloc.
 */
export interface PostGcMetrics {
  readonly jscHeapBytes: number;
  readonly externalBytes: number;
  readonly webkitMallocDirtyBytes: number;
}

export const PLATEAU_METRIC_NAMES = [
  'jscHeap',
  'external',
  'webkitMallocDirty',
] as const;

export type PlateauMetricName = (typeof PLATEAU_METRIC_NAMES)[number];

export interface MetricPlateauResult extends PlateauResult {
  readonly name: PlateauMetricName;
  /** Whether this metric can fail the overall verdict. */
  readonly gatesVerdict: boolean;
}

export interface MultiMetricPlateauResult {
  readonly overallWithinTolerance: boolean;
  readonly metrics: readonly MetricPlateauResult[];
}

const METRIC_READERS: Readonly<
  Record<PlateauMetricName, (sample: PostGcMetrics) => number>
> = {
  jscHeap: (sample) => sample.jscHeapBytes,
  external: (sample) => sample.externalBytes,
  webkitMallocDirty: (sample) => sample.webkitMallocDirtyBytes,
};

/**
 * Evaluates the post-GC plateau of every metric independently and reports all
 * of them, failing the overall verdict only on the gating ones. The first
 * post-GC sample is warm-up for each metric.
 *
 * Reporting a metric that does not gate keeps the reading in the run artifact
 * for a human to look at, without a metric that is known not to plateau on a
 * given workload being able to condemn a build that is not leaking.
 */
export function evaluateMultiMetricPlateau(
  samples: readonly PostGcMetrics[],
  tolerance: number,
  gatingMetrics: readonly PlateauMetricName[] = PLATEAU_METRIC_NAMES,
): MultiMetricPlateauResult {
  if (samples.length < 3) {
    throw new Error('Plateau needs at least three post-GC turns');
  }
  if (!(tolerance > 0)) {
    throw new Error('Tolerance must be positive');
  }
  if (gatingMetrics.length === 0) {
    throw new Error('A verdict must gate at least one metric');
  }

  const metricResults = PLATEAU_METRIC_NAMES.map((name) => ({
    name,
    gatesVerdict: gatingMetrics.includes(name),
    ...evaluatePostGcPlateau(samples.map(METRIC_READERS[name]), tolerance),
  }));

  return {
    overallWithinTolerance: metricResults
      .filter((metric) => metric.gatesVerdict)
      .every((metric) => metric.withinTolerance),
    metrics: metricResults,
  };
}

function requireMetric(output: string, pattern: RegExp, name: string): number {
  const match = output.match(pattern);
  if (match === null) {
    throw new Error(`Missing ${name}`);
  }
  return parseBytes(match[1]);
}

function parseRegionDirty(output: string, region: string): number {
  const line = output
    .split('\n')
    .find(
      (candidate) =>
        candidate.startsWith(region) && !candidate.includes('(reserved)'),
    );
  if (line === undefined) {
    return 0;
  }
  // Region rows are `<region name> VIRTUAL RESIDENT DIRTY [SWAPPED ...]`.
  // Columns are read by position after stripping the known region prefix:
  // filtering on a K/M/G suffix drops a bare `0` column and silently shifts
  // every later column left, which would misreport dirty bytes.
  const columns = line.slice(region.length).trim().split(/\s+/);
  if (columns.length < 3) {
    throw new Error(`Invalid ${region} vmmap row`);
  }
  return parseBytes(columns[2]);
}

function parseBytes(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([KMG]?)(?:B)?$/i);
  if (match === null) {
    throw new Error(`Invalid byte value: ${value}`);
  }
  const multipliers: Record<string, number> = {
    '': 1,
    K: 1024,
    M: 1024 ** 2,
    G: 1024 ** 3,
  };
  return Math.round(Number(match[1]) * multipliers[match[2].toUpperCase()]);
}
