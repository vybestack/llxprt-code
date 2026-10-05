/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { withBatchFixture } from './addbatch-stream-test-helpers.js';
import {
  exportSummaryRow,
  summaryRow,
  seedRows,
  assertOwnerBound,
  recordExportSummaryOwners,
} from './export-summary-test-helpers.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import type { IContent } from './IContent.js';

const sizes = [512, 8192];
describe('disk-row history summary', () => {
  it.each(sizes)(
    'summarizes %i real mixed rows and preserves the retained tail',
    async (size) => {
      await withBatchFixture(async ({ history, recorder, owners }) => {
        await seedRows(recorder, size);
        await history.recalculateTokens();
        const summary = summaryRow();
        await history.summarizeOldHistory(3, async (source) => {
          expect(Array.isArray(source)).toBe(false);
          expect(source.length).toBe(size - 3);
          let index = 0;
          for (const row of source) {
            expect(row).toStrictEqual(exportSummaryRow(index));
            index++;
          }
          expect(index).toBe(size - 3);
          return summary;
        });
        let index = 0;
        for await (const row of history.streamRawHistory()) {
          expect(row).toStrictEqual(
            index === 0 ? summary : exportSummaryRow(size - 4 + index),
          );
          index++;
        }
        expect(index).toBe(4);
        expect(summary.metadata?.chronology?.seq).toBe(size + 1);
        expect(history.getTotalTokens()).toBe(
          await history.estimateTokensForContents([
            summary,
            ...[size - 3, size - 2, size - 1].map((i) => exportSummaryRow(i)),
          ]),
        );
        recordExportSummaryOwners('summary', size, owners);
        assertOwnerBound(owners);
      });
    },
    180000,
  );

  it('normalizes keep counts and does not invoke the callback for a retained whole history', async () => {
    await withBatchFixture(async ({ history, recorder }) => {
      await seedRows(recorder, 2);
      await history.summarizeOldHistory(2.9, async () => {
        throw new Error('unnecessary callback');
      });
      expect(history.length()).toBe(2);
      await history.summarizeOldHistory(Number.NaN, async (source) => {
        expect(source.length).toBe(2);
        return summaryRow();
      });
      expect(history.length()).toBe(1);
    });
  });

  it('passes a valid greater-than-8-MiB row through the callback', async () => {
    await withBatchFixture(async ({ history, recorder, owners }) => {
      const row = exportSummaryRow(0, 9 * 1024 * 1024);
      await recorder.commit('content', { content: row });
      await history.summarizeOldHistory(0, async (source) => {
        for (const item of source) expect(item).toStrictEqual(row);
        return summaryRow();
      });
      expect(history.length()).toBe(1);
      expect(owners.snapshot().liveRows).toBe(0);
    });
  }, 180000);
});

describe('summary retaining controls', () => {
  it.each(
    sizes.flatMap((size) => [false, true].map((copy) => ({ size, copy }))),
  )(
    'charges $size retained callback rows copy=$copy',
    async ({ size, copy }) => {
      await withBatchFixture(async ({ history, recorder }) => {
        await seedRows(recorder, size);
        const retained: IContent[] = [];
        const owners = new RowOwnership();
        try {
          await history.summarizeOldHistory(3, async (source) => {
            for (const row of source) {
              const item = copy ? { ...row } : row;
              retained.push(item);
              owners.retain(item);
            }
            return summaryRow();
          });
          recordExportSummaryOwners(
            copy ? 'summary-retained-copy' : 'summary-retained-borrowed',
            size,
            owners,
          );
          expect(retained).toHaveLength(size - 3);
          expect(
            owners.within({ rows: 80, serializedBytes: 1024 * 1024 }),
          ).toBe(process.env.EXPORT_SUMMARY_RETAINING_TRAP === '1');
        } finally {
          for (const row of retained) owners.release(row);
          retained.length = 0;
          expect(owners.snapshot().liveRows).toBe(0);
        }
      });
    },
    180000,
  );
});
