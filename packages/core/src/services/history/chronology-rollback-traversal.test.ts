/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withSuffixFixture } from './history-suffix-test-helpers.js';
import { rollbackRow } from './chronology-rollback-test-helpers.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';

function fixtureRow(index: number, bytes: number): IContent {
  return {
    ...rollbackRow(index, bytes),
    metadata: {
      chronology: {
        seq: index + 1,
        userTurn: index + 1,
        step: 0,
        recordedAt: 0,
      },
    },
  };
}

const bounds = { rows: 440, serializedBytes: 8 * 1024 * 1024 };

describe('incremental traversal of accepted rollback media/tool input', () => {
  for (const size of [512, 8192]) {
    it(`reads every ${size} valid media/tool row with bounded borrowed payload`, async () => {
      await withSuffixFixture(
        size,
        async (service, ownership, counters) => {
          let visited = 0;
          let serializedBytes = 0;
          for await (const row of service.getRecent(0)) {
            expect(row).toStrictEqual(fixtureRow(visited, 2048));
            serializedBytes += Buffer.byteLength(JSON.stringify(row));
            visited++;
          }
          expect(visited).toBe(size);
          expect(serializedBytes).toBeGreaterThan(size * 2048);
          expect(ownership.within(bounds)).toBe(true);
          expect(ownership.snapshot().peakRows).toBe(1);
          expect(ownership.snapshot().liveRows).toBe(0);
          expect(ownership.snapshot().liveSerializedBytes).toBe(0);
          expect(counters.snapshot().peakDecodedRows).toBe(1);
        },
        2048,
        fixtureRow,
      );
    }, 120_000);
  }

  it('detects whole-fixture borrowing without rejecting any of the accepted rows', async () => {
    await withSuffixFixture(
      8192,
      async (service) => {
        const ownership = new RowOwnership();
        const retained: IContent[] = [];
        try {
          for await (const row of service.getRecent(0)) {
            ownership.retain(row);
            retained.push(row);
          }
          expect(retained).toHaveLength(8192);
          expect(ownership.within(bounds)).toBe(false);
          expect(ownership.snapshot().peakRows).toBeGreaterThan(bounds.rows);
          expect(ownership.snapshot().peakSerializedBytes).toBeGreaterThan(
            bounds.serializedBytes,
          );
        } finally {
          for (const row of retained) ownership.release(row);
        }
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(ownership.snapshot().liveSerializedBytes).toBe(0);
      },
      2048,
      fixtureRow,
    );
  }, 120_000);
});
