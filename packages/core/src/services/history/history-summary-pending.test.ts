/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withBatchFixture, batchGate } from './addbatch-stream-test-helpers.js';
import {
  exportSummaryRow,
  summaryRow,
  recordExportSummaryOwners,
} from './export-summary-test-helpers.js';

describe('pending summary capture and queued add identities', () => {
  it.each([512, 8192])(
    'preserves %i pending inputs without excusing their ownership charge',
    async (size) => {
      await withBatchFixture(
        async ({
          history,
          owners,
          pauseWriter,
          waitForPausedWrite,
          releaseWriter,
        }) => {
          const input = Array.from({ length: size }, (_, index) =>
            exportSummaryRow(index),
          );
          owners.registerInput(input);
          pauseWriter();
          await history.addBatch(input);
          await waitForPausedWrite;
          const entered = batchGate();
          const release = batchGate();
          const summary = summaryRow();
          const operation = history.summarizeOldHistory(3, async (source) => {
            let index = 0;
            for (const row of source) {
              expect(row).toBe(input[index++]);
            }
            expect(index).toBe(size - 3);
            entered.resolve();
            await release.promise;
            return summary;
          });
          await entered.promise;
          const queued = exportSummaryRow(size);
          history.add(queued);
          release.resolve();
          await operation;
          await history.waitForTokenUpdates();
          let index = 0;
          for await (const row of history.streamRawHistory()) {
            const tail = index === 4 ? queued : input[size - 4 + index];
            const expected = index === 0 ? summary : tail;
            expect(row).toBe(expected);
            expect(row.metadata?.chronology).toBe(
              expected.metadata?.chronology,
            );
            index++;
          }
          expect(index).toBe(5);
          recordExportSummaryOwners('summary-pending', size, owners);
          expect(owners.snapshot().peakRows).toBeGreaterThanOrEqual(size);
          try {
            expect(
              owners.within({ rows: 440, serializedBytes: 8 * 1024 * 1024 }),
            ).toBe(process.env.EXPORT_SUMMARY_PENDING_TRAP === '1');
          } finally {
            releaseWriter();
            await history.waitForCommit();
            expect([
              owners.snapshot().liveRows,
              owners.snapshot().liveSerializedBytes,
            ]).toStrictEqual([0, 0]);
          }
        },
      );
    },
    180000,
  );
});
