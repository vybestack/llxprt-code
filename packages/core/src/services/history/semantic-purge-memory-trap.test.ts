/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { pair } from './__tests__/support/semantic-purge-memory-test-helpers.js';

describe('semantic purge detached candidate retained growth', () => {
  it('rejects an explicitly retained whole-array row and marker trap against the same allowance', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(true)),
    );
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
    expect(estimate.bound.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
});
