/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { rollbackMemoryPair } from './chronology-rollback-memory-probe.js';

describe('suspended chronology rollback transaction memory', () => {
  it('keeps 512/8192-row retained growth within the unchanged 1 MiB allowance', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => rollbackMemoryPair(false)),
    );
    expect(estimate.pass).toBe(true);
    expect(estimate.bound.heap).toBeLessThanOrEqual(RETAINED_ALLOWANCE_BYTES);
    expect(estimate.bound.external).toBeLessThanOrEqual(
      RETAINED_ALLOWANCE_BYTES,
    );
  }, 300_000);
});
