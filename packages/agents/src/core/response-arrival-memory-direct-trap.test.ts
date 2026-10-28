/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RETAINED_ALLOWANCE_BYTES } from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { responseArrivalMemoryEstimate } from './response-arrival-memory-probe.js';

describe('production arrival retained bytes through publication and token accounting', () => {
  it('direct: rejects an accumulating source with the same estimator', () => {
    const estimate = responseArrivalMemoryEstimate('direct', true);
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 180000);
});
