/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RETAINED_ALLOWANCE_BYTES } from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { responseArrivalMemoryEstimate } from './response-arrival-memory-probe.js';

describe('production arrival retained bytes through publication and token accounting', () => {
  it('streaming: bounds five paired production-turn measurements below one MiB', () => {
    const estimate = responseArrivalMemoryEstimate('streaming', false);
    expect(estimate.pass).toBe(true);
    expect(estimate.bound.heap).toBeLessThanOrEqual(RETAINED_ALLOWANCE_BYTES);
    expect(estimate.bound.external).toBeLessThanOrEqual(
      RETAINED_ALLOWANCE_BYTES,
    );
  }, 180000);
});
