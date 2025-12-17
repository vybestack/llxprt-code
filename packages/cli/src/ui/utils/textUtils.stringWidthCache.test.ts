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

describe('textUtils string width cache', () => {
  it('evicts entries after exceeding the max cache size', () => {
    clearStringWidthCache();

    // Use non-ASCII strings so we actually hit the cache.
    // These are all distinct strings to force growth.
    for (let i = 0; i < 5000; i++) {
      getCachedStringWidth(`é${i}`);
    }

    expect(getStringWidthCacheSize()).toBeLessThanOrEqual(2048);
  });

  it('does not cache plain ASCII strings (fast path)', () => {
    clearStringWidthCache();

    getCachedStringWidth('hello');
    getCachedStringWidth('world');

    expect(getStringWidthCacheSize()).toBe(0);
  });
});
