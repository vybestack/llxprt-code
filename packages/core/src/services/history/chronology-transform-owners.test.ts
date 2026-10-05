/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { pausedDensity } from './chronology-rollback-owner-helpers.js';

describe('public transform rollback full transaction owner bounds', () => {
  for (const size of [512, 8192]) {
    it(`bounds the public transform row and marker owners at ${size} rows`, async () => {
      const result = await pausedDensity(size, false, 'transform');
      expect(result.traversed).toBe(size);
      expect(result.transaction.liveRows).toBeGreaterThan(0);
      expect(result.transaction.liveRows).toBeLessThanOrEqual(440);
    }, 120_000);
  }
  it('bounds the public transform serialized owners at the accepted full fixture scale', async () => {
    const result = await pausedDensity(8192, false, 'transform');
    expect(result.bytes).toBeGreaterThan(8192 * 2048);
    expect(result.transaction.liveSerializedBytes).toBeGreaterThan(0);
    expect(result.transaction.liveSerializedBytes).toBeLessThanOrEqual(
      8 * 1024 * 1024,
    );
  }, 120_000);
});
