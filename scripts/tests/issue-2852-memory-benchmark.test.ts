/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  evaluatePostGcPlateau,
  expectedCheckpointNames,
  parseFootprintBytes,
  parsePsRssBytes,
  parseVmmapSummary,
  validateCheckpointOrder,
  validateExactPid,
} from '../issue-2852-memory-benchmark.js';

describe('issue 2852 memory benchmark parsing', () => {
  it('accepts only the requested Bun foreground PID', () => {
    expect(validateExactPid(1234, ' 1234 /opt/bun')).toEqual({
      pid: 1234,
      command: '/opt/bun',
    });
    expect(() => validateExactPid(1234, ' 1235 /opt/bun')).toThrow('exact PID');
  });

  it('parses RSS without treating it as heap memory', () => {
    expect(parsePsRssBytes(' 1234 2048 /opt/bun', 1234)).toBe(2_097_152);
  });

  it('rejects a non-numeric RSS sample instead of propagating NaN', () => {
    expect(() => parsePsRssBytes(' 1234 notanumber /opt/bun', 1234)).toThrow(
      'Expected exact PID',
    );
  });

  it('reads a bare zero dirty column without shifting later columns', () => {
    // vmmap emits a bare `0` (no K/M/G suffix) for an empty category. Filtering
    // columns by suffix would drop it and misreport the dirty bytes.
    const vmmap = parseVmmapSummary(
      `Physical footprint: 1.5G\nMALLOC_SMALL (empty) 4.0G 3.0G 0\nWebKit Malloc 800M 700M 600M\nIOAccelerator 300M 275M 250M\nIOSurface 20M 15M 10M`,
    );
    expect(vmmap.mallocEmptyDirtyBytes).toBe(0);
  });

  it('parses a footprint reported in bare bytes or with a B suffix', () => {
    expect(
      parseVmmapSummary(
        `Physical footprint: 1.5 GB\nMALLOC_SMALL (empty) 2.0G 1.0G 1.0G\nWebKit Malloc 800M 700M 600M\nIOAccelerator 300M 275M 250M\nIOSurface 20M 15M 10M`,
      ).physicalFootprintBytes,
    ).toBe(1_610_612_736);
  });

  it('parses footprint, allocator, and IOAccelerator categories separately', () => {
    const vmmap = parseVmmapSummary(
      `Physical footprint: 1.5G\nMALLOC_SMALL (empty) 2.0G 1.0G 1.0G\nWebKit Malloc 800M 700M 600M\nIOAccelerator 300M 275M 250M\nIOSurface 20M 15M 10M`,
    );
    expect(vmmap).toEqual({
      physicalFootprintBytes: 1_610_612_736,
      mallocEmptyDirtyBytes: 1_073_741_824,
      webkitMallocDirtyBytes: 629_145_600,
      ioGraphicsDirtyBytes: 272_629_760,
    });
    expect(parseFootprintBytes('phys_footprint: 512 MB')).toBe(536_870_912);
  });

  it('requires a baseline followed by a pre-GC and post-GC pair per turn', () => {
    expect(validateCheckpointOrder(expectedCheckpointNames(3))).toBe(true);
    expect(() =>
      validateCheckpointOrder(['baseline', 'turn-1-post-gc', 'turn-1-pre-gc']),
    ).toThrow('checkpoint order');
    expect(() =>
      validateCheckpointOrder(['baseline', 'pre-gc', 'post-gc']),
    ).toThrow('checkpoint order');
  });

  describe('post-GC plateau across repeated equivalent turns', () => {
    it('accepts a heap that settles after the first warm-up turn', () => {
      const result = evaluatePostGcPlateau(
        [40_000_000, 50_000_000, 50_500_000, 50_200_000, 50_400_000],
        0.05,
      );
      expect({
        settledBaselineBytes: result.settledBaselineBytes,
        withinTolerance: result.withinTolerance,
      }).toStrictEqual({
        settledBaselineBytes: 50_000_000,
        withinTolerance: true,
      });
    });

    it('rejects a heap that keeps climbing turn over turn', () => {
      const result = evaluatePostGcPlateau(
        [40_000_000, 50_000_000, 60_000_000, 70_000_000, 80_000_000],
        0.05,
      );
      expect({
        withinTolerance: result.withinTolerance,
        growthRatio: Math.round(result.growthRatio * 100) / 100,
      }).toStrictEqual({ withinTolerance: false, growthRatio: 0.6 });
    });

    it('treats growth exactly at the tolerance as a plateau', () => {
      // settled = [50M, 52.5M] -> growthRatio === 0.05 === tolerance.
      const result = evaluatePostGcPlateau(
        [40_000_000, 50_000_000, 52_500_000, 50_000_000],
        0.05,
      );
      expect(result.withinTolerance).toBe(true);
    });

    it('refuses to judge a plateau from too few turns', () => {
      expect(() => evaluatePostGcPlateau([1, 2], 0.05)).toThrow(
        'at least three post-GC turns',
      );
    });

    it('rejects a non-positive tolerance', () => {
      expect(() => evaluatePostGcPlateau([1_000, 1_000, 1_000], 0)).toThrow(
        'Tolerance must be positive',
      );
    });
  });
});
