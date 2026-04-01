/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';

import {
  clearStringWidthCache,
  getCachedStringWidth,
  getStringWidthCacheSize,
} from './textUtils.js';
import { LRU_BUFFER_PERF_CACHE_LIMIT } from '../constants.js';

describe('textUtils string width cache', () => {
  it('evicts entries after exceeding the max cache size', () => {
    clearStringWidthCache();

    // Use non-ASCII strings so we actually hit the cache.
    // These are all distinct strings to force growth.
    for (let i = 0; i < LRU_BUFFER_PERF_CACHE_LIMIT + 1000; i++) {
      getCachedStringWidth(`é${i}`);
    }

    expect(getStringWidthCacheSize()).toBeLessThanOrEqual(
      LRU_BUFFER_PERF_CACHE_LIMIT,
    );
  });

  it('does not cache single ASCII chars (fast path)', () => {
    clearStringWidthCache();

    getCachedStringWidth('a');
    getCachedStringWidth('z');

    expect(getStringWidthCacheSize()).toBe(0);
  });
});
