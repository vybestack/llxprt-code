/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { RETAINED_ALLOWANCE_BYTES } from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { bindingMemoryEstimate } from './__tests__/support/provider-binding-bridge-memory-probe.js';

describe('binding production route suspended after durable acknowledgement', () => {
  it('keeps five paired retained measurements below the unchanged one-MiB allowance', () => {
    const estimate = bindingMemoryEstimate(false);
    expect(estimate.pass).toBe(true);
    expect(estimate.bound.heap).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
    expect(estimate.bound.external).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
});
