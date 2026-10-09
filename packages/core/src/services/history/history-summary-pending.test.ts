/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withBatchFixture, batchGate } from './addbatch-stream-test-helpers.js';
import {
  exportSummaryRow,
  summaryRow,
  recordExportSummaryOwners,
} from './export-summary-test-helpers.js';

describe('summary capture with a queued add', () => {
  it.each([512, 8192])(
    'summarizes %i durable inputs by value while a concurrent add queues behind it',
    async (size) => {
      await withBatchFixture(async ({ history, owners }) => {
        const input = Array.from({ length: size }, (_, index) =>
          exportSummaryRow(index),
        );
        owners.registerInput(input);
        await history.addBatch(input);
        const entered = batchGate();
        const release = batchGate();
        const summary = summaryRow();
        const operation = history.summarizeOldHistory(3, async (source) => {
          let index = 0;
          for (const row of source) {
            expect(row).toStrictEqual(input[index++]);
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
        await history.waitForCommit();
        let index = 0;
        for await (const row of history.streamRawHistory()) {
          const tail = index === 4 ? queued : input[size - 4 + index];
          const expected = index === 0 ? summary : tail;
          expect(row).toStrictEqual(expected);
          expect(row.metadata?.chronology).toStrictEqual(
            expected.metadata?.chronology,
          );
          index++;
        }
        expect(index).toBe(5);
        recordExportSummaryOwners('summary-pending', size, owners);
      });
    },
    180000,
  );
});
