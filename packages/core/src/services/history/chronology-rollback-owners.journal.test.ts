/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { pausedNativeRollback } from './__tests__/support/native-rollback-owner-fixture.js';

const ROW_BOUND = 440;
const BYTE_BOUND = 8 * 1024 * 1024;
const kinds: Array<'density' | 'transform'> = ['density', 'transform'];

describe.each(kinds)(
  'native %s rollback previous-version and media owners',
  (kind) => {
    for (const size of [512, 8192]) {
      it(`traverses and restores every ${size} media/tool row with bounded previous and transaction owners`, async () => {
        const result = await pausedNativeRollback(size, false, kind);
        expect(result.traversed).toBe(size);
        expect(result.bytes).toBeGreaterThan(size * 2048);
        expect(result.previous.peakRows).toBeGreaterThan(0);
        expect(result.previous.peakRows).toBeLessThanOrEqual(ROW_BOUND);
        expect(result.previous.peakSerializedBytes).toBeLessThanOrEqual(
          BYTE_BOUND,
        );
        expect(result.transaction.liveRows).toBeGreaterThan(0);
        expect(result.transaction.liveRows).toBeLessThanOrEqual(ROW_BOUND);
        expect(result.transaction.liveSerializedBytes).toBeGreaterThan(0);
        expect(result.transaction.liveSerializedBytes).toBeLessThanOrEqual(
          BYTE_BOUND,
        );
      }, 120_000);
    }

    it('rejects an explicitly retained previous version at both unchanged ownership bounds', async () => {
      const result = await pausedNativeRollback(8192, true, kind);
      expect(result.traversed).toBe(8192);
      expect(result.previous.peakRows).toBeGreaterThan(ROW_BOUND);
      expect(result.previous.peakSerializedBytes).toBeGreaterThan(BYTE_BOUND);
      expect(result.transaction.liveRows).toBeGreaterThan(ROW_BOUND);
      expect(result.transaction.liveSerializedBytes).toBeGreaterThan(
        BYTE_BOUND,
      );
    }, 120_000);
  },
);
