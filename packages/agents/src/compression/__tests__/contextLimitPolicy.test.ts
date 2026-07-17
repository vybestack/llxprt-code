/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for the centralized context-limit margin policy
 * (contextLimitPolicy.ts).
 *
 * The shared helper is used by BOTH the pending-token enforcement path and the
 * provider-content enforcement path. The pending path historically produced a
 * marginAdjustedLimit of 0 for limits at or below TOKEN_SAFETY_MARGIN (the
 * safety-adjusted value floors to 0, and the cushion adds nothing). The
 * provider-only path previously clamped to at least 1, but that provider-only
 * drift must NOT silently alter the shared pending policy. Therefore the shared
 * helper preserves the pending semantics: positive limits <= safety margin
 * produce 0, not 1.
 */

import { describe, it, expect } from 'vitest';
import {
  TOKEN_SAFETY_MARGIN,
  CONTEXT_LIMIT_FUDGE_FACTOR,
  INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD,
  computeMarginAdjustedLimit,
} from '../contextLimitPolicy.js';

describe('contextLimitPolicy constants', () => {
  it('exports the expected safety margin', () => {
    expect(TOKEN_SAFETY_MARGIN).toBe(1000);
  });

  it('exports the expected fudge factor', () => {
    expect(CONTEXT_LIMIT_FUDGE_FACTOR).toBe(0.005);
  });

  it('exports the expected ineffective threshold', () => {
    expect(INEFFECTIVE_COMPRESSION_REDUCTION_THRESHOLD).toBe(0.05);
  });
});

describe('computeMarginAdjustedLimit — realistic windows', () => {
  it('applies the visible 0.5% cushion for a 200000-token window (cushion not capped)', () => {
    // For 200000 the cushion does NOT hit the cap, so the arithmetic is
    // directly observable: the adjusted value is strictly less than the limit.
    const limit = 200_000;
    const safetyAdjusted = limit - TOKEN_SAFETY_MARGIN; // 199000
    const cushion = Math.floor(safetyAdjusted * CONTEXT_LIMIT_FUDGE_FACTOR); // 995
    const expected = safetyAdjusted + cushion; // 199995 (< 200000, not capped)
    const adjustedLimit = computeMarginAdjustedLimit(limit);
    expect(adjustedLimit).toBe(expected);
    expect(adjustedLimit).toBeLessThan(limit);
  });

  it('caps the adjusted limit at the original limit when the cushion would exceed it (262144 window)', () => {
    // For 262144 the safety-adjusted + cushion (262449) exceeds the limit, so
    // the result is capped at the original limit (262144).
    const limit = 262_144;
    expect(computeMarginAdjustedLimit(limit)).toBe(limit);
  });
});

describe('computeMarginAdjustedLimit — tiny / degenerate limits (pending semantics preserved)', () => {
  it('returns 0 for positive limits at or below TOKEN_SAFETY_MARGIN (preserves pending policy)', () => {
    // The shared helper must NOT apply the old provider-only Math.max(1, ...)
    // floor. Positive limits <= safety margin produce 0 because the
    // safety-adjusted value floors to 0 and the cushion adds nothing.
    for (const limit of [1, 100, 500, 999, 1_000]) {
      const result = computeMarginAdjustedLimit(limit);
      expect(
        result,
        `expected marginAdjustedLimit 0 for limit=${limit}, got ${result}`,
      ).toBe(0);
    }
  });

  it('returns 0 for a limit of exactly TOKEN_SAFETY_MARGIN', () => {
    expect(computeMarginAdjustedLimit(TOKEN_SAFETY_MARGIN)).toBe(0);
  });

  it('returns a positive adjusted value once the limit exceeds TOKEN_SAFETY_MARGIN', () => {
    // limit=1001: safetyAdjusted=1, cushion=floor(1*0.005)=0, adjusted=1
    expect(computeMarginAdjustedLimit(1_001)).toBe(1);
    // limit=2000: safetyAdjusted=1000, cushion=floor(1000*0.005)=5, adjusted=1005
    expect(computeMarginAdjustedLimit(2_000)).toBe(1_005);
  });

  it('returns 0 for a zero limit', () => {
    expect(computeMarginAdjustedLimit(0)).toBe(0);
  });

  it('returns 0 for negative limits (defensive nonnegative clamp)', () => {
    expect(computeMarginAdjustedLimit(-500)).toBe(0);
    expect(computeMarginAdjustedLimit(-1)).toBe(0);
  });
});
