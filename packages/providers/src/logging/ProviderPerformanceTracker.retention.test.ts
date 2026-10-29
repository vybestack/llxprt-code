/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import {
  MIB,
  RETAINED_BOUND,
  bigText,
} from '../__tests__/support/retainedText.js';
import { ProviderPerformanceTracker } from './ProviderPerformanceTracker.js';

describe('ProviderPerformanceTracker error retention', () => {
  it('keeps none of a long error message alive through the excerpt it stores', async () => {
    const tracker = new ProviderPerformanceTracker('retention');
    const baseline = await settledHeap();
    const record = (): void => {
      tracker.recordError(10, bigText(40 * MIB));
    };
    record();
    const afterRecord = await settledHeap();

    const stored = tracker.getLatestMetrics().errors;
    expect(stored).toHaveLength(1);
    expect(stored[0].error).toHaveLength(200);
    expect(afterRecord - baseline).toBeLessThan(RETAINED_BOUND);
  });
});
