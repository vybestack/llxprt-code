/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for buildUsageUpdate (issue #1607): the usage_update
 * notification must report `used` = tokens now in context (the response's
 * cumulative totalTokenCount) against `size` = the configured context-window
 * limit — not the pre-#1607 shape where size merely mirrored used, which told
 * the client nothing about remaining headroom.
 */

import { describe, it, expect } from 'vitest';
import { buildUsageUpdate } from './zed-helpers.js';

describe('buildUsageUpdate (issue #1607: usage_update size/used semantics)', () => {
  it('reports used = totalTokenCount against size = the context-window limit', () => {
    expect(
      buildUsageUpdate(
        { totalTokenCount: 1200, candidatesTokenCount: 300 },
        128000,
      ),
    ).toStrictEqual({
      sessionUpdate: 'usage_update',
      used: 1200,
      size: 128000,
    });
  });

  it('falls back to candidatesTokenCount for used when totalTokenCount is absent', () => {
    expect(
      buildUsageUpdate({ candidatesTokenCount: 450 }, 64000),
    ).toStrictEqual({
      sessionUpdate: 'usage_update',
      used: 450,
      size: 64000,
    });
  });

  it('treats an explicit zero totalTokenCount as authoritative (no fallback to candidates)', () => {
    // `??` intentionally distinguishes absent from zero: a provider explicitly
    // reporting total=0 wins, even if it also supplies a candidate count.
    expect(
      buildUsageUpdate(
        { totalTokenCount: 0, candidatesTokenCount: 450 },
        64000,
      ),
    ).toBeNull();
  });

  it('returns null when the event carries no usable token counts (nothing to report)', () => {
    expect(buildUsageUpdate({}, 128000)).toBeNull();
    expect(
      buildUsageUpdate({ totalTokenCount: 0, candidatesTokenCount: 0 }, 128000),
    ).toBeNull();
  });

  it('clamps size up to used so used can never exceed size on the wire', () => {
    // A mid-flight context-limit reduction (or a model swap to a smaller
    // window) must not produce used > size — the update degrades to a full
    // window rather than an impossible ratio.
    expect(buildUsageUpdate({ totalTokenCount: 200000 }, 128000)).toStrictEqual(
      {
        sessionUpdate: 'usage_update',
        used: 200000,
        size: 200000,
      },
    );
  });
});
