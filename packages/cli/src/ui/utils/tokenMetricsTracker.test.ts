/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  shouldUpdateTokenMetrics,
  toTokenMetricsSnapshot,
} from './tokenMetricsTracker.js';

const baseMetrics = {
  tokensPerMinute: 12,
  throttleWaitTimeMs: 1200,
};

const baseUsage = {
  input: 10,
  output: 20,
  cache: 0,
  tool: 0,
  thought: 0,
  total: 30,
};

describe('tokenMetricsTracker', () => {
  it('should request update when there is no previous snapshot', () => {
    expect(shouldUpdateTokenMetrics(null, baseMetrics, baseUsage)).toBe(true);
  });

  it('should skip update when metrics and usage are unchanged', () => {
    const prevSnapshot = {
      tokensPerMinute: 12,
      throttleWaitTimeMs: 1200,
      sessionTokenTotal: 30,
      timeToFirstToken: null as number | null,
      tokensPerSecond: 0,
    };
    expect(shouldUpdateTokenMetrics(prevSnapshot, baseMetrics, baseUsage)).toBe(
      false,
    );
  });

  it('should update when tokens per minute change', () => {
    const prevSnapshot = {
      tokensPerMinute: 12,
      throttleWaitTimeMs: 1200,
      sessionTokenTotal: 30,
      timeToFirstToken: null as number | null,
      tokensPerSecond: 0,
    };
    expect(
      shouldUpdateTokenMetrics(
        prevSnapshot,
        { ...baseMetrics, tokensPerMinute: 18 },
        baseUsage,
      ),
    ).toBe(true);
  });

  it('should update when throttle wait time changes', () => {
    const prevSnapshot = {
      tokensPerMinute: 12,
      throttleWaitTimeMs: 1200,
      sessionTokenTotal: 30,
      timeToFirstToken: null as number | null,
      tokensPerSecond: 0,
    };
    expect(
      shouldUpdateTokenMetrics(
        prevSnapshot,
        { ...baseMetrics, throttleWaitTimeMs: 800 },
        baseUsage,
      ),
    ).toBe(true);
  });

  it('should update when session token total changes', () => {
    const prevSnapshot = {
      tokensPerMinute: 12,
      throttleWaitTimeMs: 1200,
      sessionTokenTotal: 30,
      timeToFirstToken: null as number | null,
      tokensPerSecond: 0,
    };
    expect(
      shouldUpdateTokenMetrics(prevSnapshot, baseMetrics, {
        ...baseUsage,
        total: 31,
      }),
    ).toBe(true);
  });

  describe('Issue #1805: timeToFirstToken and tokensPerSecond in snapshot', () => {
    it('should include timeToFirstToken in snapshot from metrics', () => {
      const snapshot = toTokenMetricsSnapshot(
        { ...baseMetrics, timeToFirstToken: 250 },
        baseUsage,
      );
      expect(snapshot.timeToFirstToken).toBe(250);
    });

    it('should default timeToFirstToken to null when not in metrics', () => {
      const snapshot = toTokenMetricsSnapshot(baseMetrics, baseUsage);
      expect(snapshot.timeToFirstToken).toBeNull();
    });

    it('should include tokensPerSecond in snapshot from metrics', () => {
      const snapshot = toTokenMetricsSnapshot(
        { ...baseMetrics, tokensPerSecond: 42.5 },
        baseUsage,
      );
      expect(snapshot.tokensPerSecond).toBe(42.5);
    });

    it('should default tokensPerSecond to 0 when not in metrics', () => {
      const snapshot = toTokenMetricsSnapshot(baseMetrics, baseUsage);
      expect(snapshot.tokensPerSecond).toBe(0);
    });

    it('should update when timeToFirstToken changes', () => {
      const prevSnapshot = {
        tokensPerMinute: 12,
        throttleWaitTimeMs: 1200,
        sessionTokenTotal: 30,
        timeToFirstToken: null as number | null,
        tokensPerSecond: 0,
      };
      expect(
        shouldUpdateTokenMetrics(
          prevSnapshot,
          { ...baseMetrics, timeToFirstToken: 500 },
          baseUsage,
        ),
      ).toBe(true);
    });

    it('should update when tokensPerSecond changes', () => {
      const prevSnapshot = {
        tokensPerMinute: 12,
        throttleWaitTimeMs: 1200,
        sessionTokenTotal: 30,
        timeToFirstToken: null as number | null,
        tokensPerSecond: 0,
      };
      expect(
        shouldUpdateTokenMetrics(
          prevSnapshot,
          { ...baseMetrics, tokensPerSecond: 100 },
          baseUsage,
        ),
      ).toBe(true);
    });

    it('should not update when timeToFirstToken and tokensPerSecond are unchanged', () => {
      const prevSnapshot = {
        tokensPerMinute: 12,
        throttleWaitTimeMs: 1200,
        sessionTokenTotal: 30,
        timeToFirstToken: null as number | null,
        tokensPerSecond: 0,
      };
      expect(
        shouldUpdateTokenMetrics(
          prevSnapshot,
          { ...baseMetrics, timeToFirstToken: null, tokensPerSecond: 0 },
          baseUsage,
        ),
      ).toBe(false);
    });

    it('should handle null metrics gracefully', () => {
      const snapshot = toTokenMetricsSnapshot(null, baseUsage);
      expect(snapshot.timeToFirstToken).toBeNull();
      expect(snapshot.tokensPerSecond).toBe(0);
    });

    it('should handle undefined metrics gracefully', () => {
      const snapshot = toTokenMetricsSnapshot(undefined, baseUsage);
      expect(snapshot.timeToFirstToken).toBeNull();
      expect(snapshot.tokensPerSecond).toBe(0);
    });
  });
});
