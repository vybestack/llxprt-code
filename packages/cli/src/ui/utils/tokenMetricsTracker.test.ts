/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { shouldUpdateTokenMetrics } from './tokenMetricsTracker.js';

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
    };
    expect(
      shouldUpdateTokenMetrics(prevSnapshot, baseMetrics, {
        ...baseUsage,
        total: 31,
      }),
    ).toBe(true);
  });
});
