/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  pairedEstimate,
  RETAINED_ALLOWANCE_BYTES,
} from '@vybestack/llxprt-code-test-utils/core/retained-growth.js';
import { pair } from './__tests__/support/semantic-purge-memory-test-helpers.js';

describe('semantic purge detached candidate retained growth', () => {
  it('keeps 512/8192 candidate retention within the unchanged 1 MiB allowance', () => {
    const estimate = pairedEstimate(
      Array.from({ length: 5 }, () => pair(false)),
    );
    expect(estimate.pass).toBe(true);
    expect(estimate.bound.heap).toBeLessThanOrEqual(RETAINED_ALLOWANCE_BYTES);
    expect(estimate.bound.external).toBeLessThanOrEqual(
      RETAINED_ALLOWANCE_BYTES,
    );
  }, 300_000);
});
