/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { pausedDensity } from './chronology-rollback-owner-test-helpers.js';

describe('density rollback previous-owner disk migration', () => {
  for (const size of [512, 8192]) {
    it(`traverses and restores every ${size} media/tool row without retaining the previous projection`, async () => {
      const result = await pausedDensity(size, false);
      expect(result.traversed).toBe(size);
      expect(result.bytes).toBeGreaterThan(size * 2048);
      expect(result.previous.peakRows).toBeLessThanOrEqual(440);
      expect(result.previous.peakSerializedBytes).toBeLessThanOrEqual(
        8 * 1024 * 1024,
      );
    }, 120_000);
  }
  it('rejects an explicitly eager previous owner at both fixed-fixture bounds', async () => {
    const result = await pausedDensity(8192, true);
    expect(result.traversed).toBe(8192);
    expect(result.previous.peakRows).toBeGreaterThan(440);
    expect(result.previous.peakSerializedBytes).toBeGreaterThan(
      8 * 1024 * 1024,
    );
  }, 120_000);
});

describe('density rollback full transaction owner bounds', () => {
  for (const size of [512, 8192]) {
    it(`bounds every transaction and caller-owned replacement object at ${size} rows during the publication pause`, async () => {
      const result = await pausedDensity(size, false);
      expect(result.transaction.liveRows).toBeGreaterThan(0);
      expect(result.transaction.liveRows).toBeLessThanOrEqual(440);
    }, 120_000);
  }
  it('bounds transaction and caller-owned serialized payload at the full fixture scale', async () => {
    const result = await pausedDensity(8192, false);
    expect(result.transaction.liveSerializedBytes).toBeGreaterThan(0);
    expect(result.transaction.liveSerializedBytes).toBeLessThanOrEqual(
      8 * 1024 * 1024,
    );
  }, 120_000);
});
