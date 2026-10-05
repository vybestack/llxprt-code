/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { withBatchFixture } from './addbatch-stream-test-helpers.js';
import { exportSummaryRow, sha256 } from './export-summary-test-helpers.js';
import type { IContent } from './IContent.js';

describe('pending JSON export serialization', () => {
  it('preserves array-index toJSON keys, dates, undefined and non-finite tool values', async () => {
    await withBatchFixture(
      async ({ history, pauseWriter, releaseWriter, owners }) => {
        pauseWriter();
        const original = [0, 1].map(
          (index) =>
            ({
              ...exportSummaryRow(index),
              blocks: [
                {
                  type: 'tool_call',
                  id: `date-${index}`,
                  name: 'date',
                  parameters: {
                    date: new Date('2026-10-02T00:00:00.000Z'),
                    absent: undefined,
                    infinite: Infinity,
                    items: [undefined, Number.NaN],
                  },
                },
              ],
            }) satisfies IContent,
        );
        const rows = original.map((row) => ({
          ...row,
          toJSON(key: string): IContent {
            return { ...row, metadata: { ...row.metadata, turnId: key } };
          },
        }));
        await history.addBatch(rows);
        const hash = createHash('sha256');
        await history.writeJSON(async (chunk) => {
          hash.update(chunk);
        });
        expect(hash.digest('hex')).toBe(sha256(JSON.stringify(rows, null, 2)));
        releaseWriter();
        await history.waitForCommit();
        expect([
          owners.snapshot().liveRows,
          owners.snapshot().liveSerializedBytes,
        ]).toStrictEqual([0, 0]);
      },
    );
  });

  it('cleans up after a row serialization failure and remains usable', async () => {
    await withBatchFixture(
      async ({ history, pauseWriter, releaseWriter, owners }) => {
        pauseWriter();
        let fail = false;
        const original = exportSummaryRow(0);
        const row = {
          ...original,
          toJSON(): IContent {
            if (fail) throw new Error('export serialization failed');
            return original;
          },
        };
        await history.addBatch([row]);
        fail = true;
        await expect(history.writeJSON(async () => {})).rejects.toThrow(
          'export serialization failed',
        );
        expect(owners.snapshot().liveRows).toBe(0);
        fail = false;
        const hash = createHash('sha256');
        await history.writeJSON(async (chunk) => {
          hash.update(chunk);
        });
        expect(hash.digest('hex')).toBe(sha256(JSON.stringify([row], null, 2)));
        releaseWriter();
        await history.waitForCommit();
        expect([
          owners.snapshot().liveRows,
          owners.snapshot().liveSerializedBytes,
        ]).toStrictEqual([0, 0]);
      },
    );
  });
});
