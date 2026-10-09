/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  suffixRow,
  withSuffixFixture,
} from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

for (const size of [512, 8192]) {
  describe(`raw chronology marker over ${size} real journal rows`, () => {
    it('returns the newest marked row, skipping an unmarked tail without retaining rows', async () => {
      await withSuffixFixture(
        size,
        async (service, ownership, counters) => {
          expect(await service.getCurrentTurnMarker()).toStrictEqual({
            turnId: `turn:${size - 2}`,
            userTurn: size - 1,
            step: 0,
            seq: size - 1,
          });
          expect(counters.snapshot().rowsDecoded).toBe(size);
          expect(ownership.snapshot().peakRows).toBe(1);
          expect(ownership.snapshot().liveRows).toBe(0);
        },
        0,
        (index) => ({
          ...suffixRow(index),
          metadata:
            index === size - 1
              ? undefined
              : {
                  ...suffixRow(index).metadata,
                  turnId: `turn:${index}`,
                },
        }),
      );
    }, 120_000);
  });
}

describe('empty raw chronology', () => {
  it('reports an unknown turn on an empty journal', async () => {
    await withSuffixFixture(0, async (service, ownership) => {
      expect(await service.getCurrentTurnMarker()).toBeNull();
      expect(ownership.snapshot().acquisitions).toBe(0);
    });
  });
});
