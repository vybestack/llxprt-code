/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import {
  pair,
  recordClientProof,
} from './__tests__/support/retained-array-memory-probe.js';
describe('AgentClient deferred retained array suspended after durable acknowledgement', () => {
  it('fails the same estimator when the actual caller retains the original input', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(true)),
    );
    recordClientProof({ kind: 'memory-caller-trap', estimate });
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
});
