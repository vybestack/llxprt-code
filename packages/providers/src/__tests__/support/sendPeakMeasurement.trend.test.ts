/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #854: the retained-growth gate of the send-peak probe judges the
 * Theil-Sen trend of the settled readings, so one noisy reading cannot decide
 * it while a steady per-send leak still breaks the bound.
 */

import { describe, expect, it } from 'bun:test';
import {
  SEND_PEAK_ACCUMULATION_SENDS,
  SEND_PEAK_BOUND_BYTES,
  theilSenSlope,
  trendGrowth,
} from './sendPeakMeasurement.js';

const SENDS = SEND_PEAK_ACCUMULATION_SENDS;
const BASE = 50 * 1024 * 1024;

describe('Theil-Sen retained growth trend', () => {
  it('computes the median of the pairwise slopes of a known series', () => {
    // Pairwise slopes of [0, 4, 4, 10]: 4, 2, 10/3, 0, 3, 6 -> sorted
    // 0, 2, 3, 10/3, 4, 6 -> median (3 + 10/3) / 2.
    expect(theilSenSlope([0, 4, 4, 10])).toBeCloseTo((3 + 10 / 3) / 2, 10);
    expect(theilSenSlope([5, 5, 5])).toBe(0);
    expect(theilSenSlope([0, 3, 6, 9])).toBe(3);
  });

  it('rejects a series too short for a trend', () => {
    expect(() => theilSenSlope([1])).toThrow(
      'a trend needs at least two readings',
    );
  });

  it('keeps at least six sends', () => {
    expect(SENDS).toBeGreaterThanOrEqual(6);
  });

  it('passes a flat series with one large outlier', () => {
    for (let outlier = 0; outlier < SENDS; outlier++) {
      const readings = Array.from({ length: SENDS }, () => BASE);
      readings[outlier] += 8 * SEND_PEAK_BOUND_BYTES;
      expect(trendGrowth(readings)).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
    }
  });

  it('fails a steady leak of bound/(sends-2) per send', () => {
    const perSend = SEND_PEAK_BOUND_BYTES / (SENDS - 2);
    const readings = Array.from(
      { length: SENDS },
      (_, send) => BASE + send * perSend,
    );
    expect(trendGrowth(readings)).toBeGreaterThan(SEND_PEAK_BOUND_BYTES);
  });

  it('still fails a steady leak when one reading is noisy', () => {
    const perSend = SEND_PEAK_BOUND_BYTES / (SENDS - 2);
    const readings = Array.from(
      { length: SENDS },
      (_, send) => BASE + send * perSend,
    );
    readings[2] -= 3 * SEND_PEAK_BOUND_BYTES;
    expect(trendGrowth(readings)).toBeGreaterThan(SEND_PEAK_BOUND_BYTES);
  });
});
