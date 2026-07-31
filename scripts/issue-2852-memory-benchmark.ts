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
  readonly mallocEmptyResidentBytes: number;
  readonly webkitMallocDirtyBytes: number;
  readonly ioAcceleratorDirtyBytes: number;
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
    mallocEmptyResidentBytes: parseRegionDirty(output, 'MALLOC_SMALL (empty)'),
    webkitMallocDirtyBytes: parseRegionDirty(output, 'WebKit Malloc'),
    ioAcceleratorDirtyBytes:
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
  if (names.join(',') !== 'baseline,pre-gc,post-gc') {
    throw new Error('Invalid checkpoint order');
  }
  return true;
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
