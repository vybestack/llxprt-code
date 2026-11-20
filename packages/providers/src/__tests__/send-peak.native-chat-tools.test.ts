/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { runNativeSendPeak } from './support/native-send-peak-runner.js';
import { SEND_PEAK_BOUND_BYTES } from './support/sendPeakMeasurement.js';

describe('native plain Chat journal-backed tool-heavy memory', () => {
  it('streams and estimates the original journal-backed tool-heavy 256/1536-row corpus within the one-row bounds', async () => {
    const { verdict } = await runNativeSendPeak('tool-heavy');
    expect(verdict.bytesMatchOracle).toBe(true);
    expect(verdict.contentLengthMatchesBytes).toBe(true);
    expect(verdict.heapGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
    expect(verdict.arrayBufferGrowth).toBeLessThanOrEqual(
      SEND_PEAK_BOUND_BYTES,
    );
    expect(verdict.retainedGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
    expect(verdict.retainedGrowthWithinBound).toBe(true);
  }, 180000);
});
