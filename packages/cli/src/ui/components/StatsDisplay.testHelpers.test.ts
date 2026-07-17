/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  withTokenTracking,
  defaultZeroMetrics,
  createMockRuntimeApi,
} from './StatsDisplay.testHelpers.js';

describe('StatsDisplay.testHelpers', () => {
  describe('withTokenTracking', () => {
    it('returns independent nested objects across calls (no shared mutation)', () => {
      const first = withTokenTracking({
        tokenTracking: { tokensPerMinute: 100 },
      });
      // Mutate the first result's nested object to prove the second call
      // is unaffected.
      first.tokenTracking.sessionTokenUsage.input = 999;

      const second = withTokenTracking({});
      expect(second.tokenTracking.sessionTokenUsage.input).toBe(0);
    });

    it('does not mutate the default tokenTracking when a partial override is provided', () => {
      const result = withTokenTracking({
        tokenTracking: { tokensPerMinute: 42 },
      });
      // The spread merge should not leak the override back into defaults.
      expect(result.tokenTracking.tokensPerMinute).toBe(42);
      expect(result.tokenTracking.sessionTokenUsage).toStrictEqual({
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      });

      // A fresh call should still see pristine defaults.
      const fresh = withTokenTracking({});
      expect(fresh.tokenTracking.tokensPerMinute).toBe(0);
    });
  });

  describe('defaultZeroMetrics', () => {
    it('returns a fresh deep-cloned object on every call', () => {
      const first = defaultZeroMetrics();
      first.tokenTracking.sessionTokenUsage.output = 500;
      first.cache.totalCacheReads = 100;

      const second = defaultZeroMetrics();
      expect(second.tokenTracking.sessionTokenUsage.output).toBe(0);
      expect(second.cache.totalCacheReads).toBe(0);
    });
  });

  describe('createMockRuntimeApi', () => {
    it('returns a RuntimeApi with stubbed methods that have safe defaults', () => {
      const api = createMockRuntimeApi();
      expect(api.getActiveProviderMetrics()).toStrictEqual({
        tokensPerMinute: 0,
        throttleWaitTimeMs: 0,
        totalTokens: 0,
        totalRequests: 0,
      });
      expect(api.getSessionTokenUsage()).toStrictEqual({
        input: 0,
        output: 0,
        cache: 0,
        tool: 0,
        thought: 0,
        total: 0,
      });
    });

    it('applies per-call overrides for specific methods', () => {
      const api = createMockRuntimeApi({
        getActiveProviderMetrics: () => ({
          tokensPerMinute: 1234,
          throttleWaitTimeMs: 0,
          totalTokens: 5000,
          totalRequests: 10,
        }),
      });
      expect(api.getActiveProviderMetrics().tokensPerMinute).toBe(1234);
    });
  });
});
