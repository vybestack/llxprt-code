/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import {
  pair,
  recordArrayProof,
} from './__tests__/support/conversation-array-memory-probe.js';
describe('ConversationManager array caller suspended after durable ack', () => {
  it('fails the same estimator when the actual caller keeps its submitted array', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(true)),
    );
    recordArrayProof({ kind: 'memory-caller-trap', estimate });
    expect(estimate.pass).toBe(false);
    expect(estimate.median.heap).toBeGreaterThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
});
