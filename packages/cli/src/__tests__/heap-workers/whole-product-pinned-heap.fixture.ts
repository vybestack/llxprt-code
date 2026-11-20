/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { beforeAll, describe, expect, it } from 'bun:test';
import { wholeProductHeap } from '../../__tests__/support/whole-product-heap.js';
import { measurementMode } from '../../__tests__/support/whole-product-measurement.js';

describe('pinned-code-v1 whole-product retained heap', () => {
  let measurement: Promise<boolean>;
  let releaseMeasurement: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseMeasurement = resolve;
  });

  beforeAll(async () => {
    let warmed: () => void;
    const ready = new Promise<void>((resolve) => {
      warmed = resolve;
    });
    measurement = wholeProductHeap(
      process.env.W24_RETAINING_TRAP === '1',
      async () => {
        warmed();
        await gate;
      },
    );
    await Promise.race([ready, measurement]);
    if (process.env.W24_PHASE_IPC === '1') {
      if (process.send === undefined)
        throw new Error('Missing heap worker IPC');
      process.send('w24-warmed');
    }
  }, 290000);

  it('releases history under the unchanged unfiltered heap bounds', async () => {
    expect(measurementMode()).toBe('pinned-code-v1');
    releaseMeasurement();
    expect(await measurement).toBe(true);
  }, 290000);
});
