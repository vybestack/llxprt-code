/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type { Sample } from '../../memory/sample.ts';
import { assertBoundedPostClearRetention } from './retention-checkpoints.ts';

function sample(
  tag: string,
  heapSize: number,
  rss: number,
  objectCount: number,
): Sample {
  return {
    t: '2026-08-28T00:00:00.000Z',
    tag,
    pid: 1,
    rss,
    heapSize,
    heapCapacity: heapSize,
    extraMemorySize: 0,
    objectCount,
    protectedObjectCount: 0,
    types: [],
  };
}

describe('issue #3386 post-clear retention checkpoints', () => {
  it('accepts the measured bounded profile', () => {
    expect(() =>
      assertBoundedPostClearRetention([
        sample('startup', 1, 1, 1),
        sample('manual', 191_850_000, 536_360_000, 826_348),
        sample('manual', 188_740_000, 361_790_000, 982_400),
        sample('manual', 191_510_000, 364_660_000, 924_538),
        sample('exit', 1, 1, 1),
      ]),
    ).not.toThrow();
  });

  it('accepts measured Linux allocator variance when retained heap and objects stay bounded', () => {
    expect(() =>
      assertBoundedPostClearRetention([
        sample('manual', 185_569_059, 511_705_088, 796_561),
        sample('manual', 186_916_503, 440_328_192, 841_568),
        sample('manual', 186_591_120, 583_221_248, 831_772),
      ]),
    ).not.toThrow();
  });

  it('rejects the measured stock profile', () => {
    expect(() =>
      assertBoundedPostClearRetention([
        sample('manual', 188_790_000, 558_470_000, 812_330),
        sample('manual', 192_330_000, 625_950_000, 1_075_479),
        sample('manual', 195_240_000, 626_290_000, 1_019_053),
      ]),
    ).toThrow('post-clear retention exceeded');
  });

  it('requires exactly three forced-GC manual checkpoints', () => {
    expect(() =>
      assertBoundedPostClearRetention([
        sample('manual', 1, 1, 1),
        sample('manual', 1, 1, 1),
      ]),
    ).toThrow('expected exactly 3 manual forced-GC samples, found 2');
  });
});
