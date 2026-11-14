/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { pairedMeasurement } from './__tests__/support/token-accounting-memory-probe.js';

describe('suspended token accounting retained growth', () => {
  it('rejects legacy 512/8192-row growth with the unchanged 1 MiB allowance', () => {
    const deltas = Array.from({ length: 5 }, () =>
      pairedMeasurement('legacy', true),
    );
    const estimate = pairedEstimate(deltas);
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
});
