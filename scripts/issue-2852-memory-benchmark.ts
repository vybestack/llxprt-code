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
  return Number(fields[2]) * 1024;
}

export function parseVmmapSummary(output: string): VmmapSummary {
  return {
    physicalFootprintBytes: requireMetric(
      output,
      /Physical footprint:\s*(\d+(?:\.\d+)?[KMG])/i,
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
  const maxBytes = Math.max(...settled);
  const growthRatio = maxBytes / settledBaselineBytes - 1;
  return {
    settledBaselineBytes,
    maxBytes,
    growthRatio,
    withinTolerance: growthRatio <= tolerance,
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
  const tokens = line.trim().split(/\s+/);
  const sizes = tokens.filter((token) => /[KMG]$/.test(token));
  if (sizes.length < 3) {
    throw new Error(`Invalid ${region} vmmap row`);
  }
  return parseBytes(sizes[2]);
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
