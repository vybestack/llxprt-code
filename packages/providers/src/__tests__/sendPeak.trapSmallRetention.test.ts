/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SEND_PEAK_BOUND_BYTES } from './support/sendPeakMeasurement.js';
import { shapeRun, sharedSendPeak } from './support/sendPeakRunner.js';

for (const trap of ['retain-row', 'retain-metadata'] satisfies ReadonlyArray<
  import('./support/sendPeakTraps.js').SendTrap
>) {
  const measured = sharedSendPeak('openai-responses', {
    source: 'rows',
    shapes: ['text-only'],
    rounds: 1,
    trap,
  });
  describe(`application retention control ${trap}`, () => {
    it('rejects a small per-send leak while preserving the exact request bytes', async () => {
      const { verdict } = shapeRun(await measured(), 'text-only');
      expect(verdict.bytesMatchOracle).toBe(true);
      expect(verdict.contentLengthMatchesBytes).toBe(true);
      expect(verdict.retainedGrowth).toBeLessThanOrEqual(SEND_PEAK_BOUND_BYTES);
      expect(verdict.retainedObjectsGrowth).toBeGreaterThan(0);
      expect(verdict.retainedGrowthWithinBound).toBe(false);
    }, 170000);
  });
}
