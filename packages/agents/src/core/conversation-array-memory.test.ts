/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { pair, recordArrayProof } from './conversation-array-memory-probe.js';
describe('ConversationManager array caller suspended after durable ack', () => {
  it('keeps five paired retained growth measurements below one MiB', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(false)),
    );
    recordArrayProof({ kind: 'memory-positive', estimate });
    expect(estimate.pass).toBe(true);
    expect(estimate.bound.heap).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
    expect(estimate.bound.external).toBeLessThan(RETAINED_ALLOWANCE_BYTES);
  }, 300_000);
});
