/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { settledHeap } from '@vybestack/llxprt-code-test-utils/core/settled-heap.js';
import {
  MIB,
  RETAINED_BOUND,
  bigText,
} from '../__tests__/support/retainedText.js';
import { ProviderPerformanceTracker } from './ProviderPerformanceTracker.js';

async function measureRetention(retaining: boolean): Promise<{
  growth: number;
  retained: readonly string[];
}> {
  const tracker = new ProviderPerformanceTracker('retention');
  const retained: string[] = [];
  const baseline = await settledHeap();
  const record = (): void => {
    const message = bigText(40 * MIB).padEnd(40 * MIB, 'x');
    tracker.recordError(10, message);
    if (retaining) retained.push(message);
  };
  record();
  const afterRecord = await settledHeap();

  const stored = tracker.getLatestMetrics().errors;
  expect(stored).toHaveLength(1);
  expect(stored[0].error).toHaveLength(200);
  return { growth: afterRecord - baseline, retained };
}

describe('ProviderPerformanceTracker error retention', () => {
  it('keeps none of a long error message alive through the excerpt it stores', async () => {
    const measured = await measureRetention(false);
    expect(measured.growth).toBeLessThan(RETAINED_BOUND);
    expect(measured.retained).toHaveLength(0);
  });

  it('control: retaining the full error exceeds three times the same heap gate', async () => {
    const measured = await measureRetention(true);
    expect(measured.growth).toBeGreaterThan(3 * RETAINED_BOUND);
    expect(measured.retained[0]).toHaveLength(40 * MIB);
  });
});
