/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SEND_PEAK_BOUND_BYTES } from './support/sendPeakMeasurement.js';
import { runNativeSendPeak } from './support/native-send-peak-runner.js';
import type { SendPeakRun } from './support/sendPeakRunner.js';

let pending: Promise<SendPeakRun> | undefined;
function measured(): Promise<SendPeakRun> {
  return (pending ??= runNativeSendPeak());
}

describe('native plain Chat journal-backed 256/1536-row send and estimate', () => {
  it('matches the original converter bytes and declared Content-Length', async () => {
    const { verdict, oracles, series } = await measured();
    expect(verdict.bytesMatchOracle).toBe(true);
    expect(verdict.contentLengthMatchesBytes).toBe(true);
    expect(oracles.small.sha256).toBe(
      'fd1da2829bf565ba22514d4285ab453c288b96c592bd3d68f007b800c210c4ee',
    );
    expect(oracles.large.sha256).toBe(
      '4d698ae799b5f64601724064d43a0f2ab4da8757130b13731ffce3eb15f5b948',
    );
    for (const round of [...series.small, ...series.large]) {
      expect(round.nativeRoute).toMatchObject({
        streams: 1,
        estimates: 1,
        fileCreates: 0,
        estimatorFiles: 0,
      });
      expect(round.nativeRoute?.tokens).toBeGreaterThan(0);
      expect(round.nativeCost?.journalBytesAdded).toBe(0);
      expect(round.chunks).toBeGreaterThan(0);
    }
  }, 180000);
  it('bounds peak growth and repeated-send retention by the original 1 MiB allowance', async () => {
    const { verdict } = await measured();
    expect(verdict.heapGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
    expect(verdict.arrayBufferGrowth).toBeLessThanOrEqual(
      SEND_PEAK_BOUND_BYTES,
    );
    expect(verdict.retainedGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
  }, 180000);
});
