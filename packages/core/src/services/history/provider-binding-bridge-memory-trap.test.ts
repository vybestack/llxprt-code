/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RETAINED_ALLOWANCE_BYTES } from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { bindingMemoryEstimate } from './provider-binding-bridge-memory-probe.js';

describe('binding production route suspended after durable acknowledgement', () => {
  it('rejects the retaining participant with the same paired estimator', () => {
    const estimate = bindingMemoryEstimate(true);
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
});
