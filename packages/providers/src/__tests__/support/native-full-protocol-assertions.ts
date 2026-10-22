/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { expect } from 'bun:test';
import { SEND_PEAK_BOUND_BYTES } from './sendPeakMeasurement.js';
import type { SendPeakRun } from './sendPeakRunner.js';

export function assertNativeFullProtocol(
  { series, oracles, verdict }: SendPeakRun,
  hashes: readonly [string, string],
): void {
  expect(series.small).toHaveLength(3);
  expect(series.large).toHaveLength(3);
  expect(series.accumulation).toHaveLength(6);
  expect(oracles.small.sha256).toBe(hashes[0]);
  expect(oracles.large.sha256).toBe(hashes[1]);
  expect(verdict.bytesMatchOracle).toBe(true);
  expect(verdict.contentLengthMatchesBytes).toBe(true);
  for (const round of [...series.small, ...series.large]) {
    expect(round.modelRequests).toBe(1);
    expect(round.contentLength).toBe(String(round.bytes));
    expect(round.nativeRoute).toMatchObject({
      streams: 1,
      estimates: 1,
      spools: 0,
      estimatorFiles: 0,
    });
    expect(round.nativeRoute?.tokens).toBeGreaterThan(0);
    expect(round.chunks).toBeGreaterThan(0);
  }
  expect(verdict.heapGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
  expect(verdict.arrayBufferGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
  expect(verdict.retainedGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
}
