/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { rollbackMemoryPair } from './chronology-rollback-memory-probe.js';

describe('suspended chronology rollback transaction memory retaining control', () => {
  it('rejects a deliberately retained full-history array using the same allowance', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => rollbackMemoryPair(true)),
    );
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
});
