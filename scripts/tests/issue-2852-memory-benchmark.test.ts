/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
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

  it('parses footprint, allocator, and IOAccelerator categories separately', () => {
    const vmmap = parseVmmapSummary(
      `Physical footprint: 1.5G\nMALLOC_SMALL (empty) 2.0G 1.0G 1.0G\nWebKit Malloc 800M 700M 600M\nIOAccelerator 300M 275M 250M\nIOSurface 20M 15M 10M`,
    );
    expect(vmmap).toEqual({
      physicalFootprintBytes: 1_610_612_736,
      mallocEmptyResidentBytes: 1_073_741_824,
      webkitMallocDirtyBytes: 629_145_600,
      ioAcceleratorDirtyBytes: 272_629_760,
    });
    expect(parseFootprintBytes('phys_footprint: 512 MB')).toBe(536_870_912);
  });

  it('requires baseline, pre-GC, and exactly one post-GC checkpoint in order', () => {
    expect(validateCheckpointOrder(['baseline', 'pre-gc', 'post-gc'])).toBe(
      true,
    );
    expect(() =>
      validateCheckpointOrder(['baseline', 'post-gc', 'post-gc']),
    ).toThrow('checkpoint order');
  });
});
