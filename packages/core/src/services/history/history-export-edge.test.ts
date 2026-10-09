/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { withBatchFixture } from './addbatch-stream-test-helpers.js';
import { exportSummaryRow, sha256 } from './export-summary-test-helpers.js';
import type { IContent } from './IContent.js';

describe('JSON export serialization', () => {
  it('exports admitted detached values with dates, undefined and non-finite tool values normalized', async () => {
    await withBatchFixture(async ({ history, owners }) => {
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
      const stored = await Array.fromAsync(history.streamRawHistory());
      expect(hash.digest('hex')).toBe(sha256(JSON.stringify(stored, null, 2)));
      expect(stored.map((row) => row.metadata?.turnId)).toStrictEqual([
        'turn-0',
        'turn-1',
      ]);
      expect(stored[0].blocks[0]).toStrictEqual({
        type: 'tool_call',
        id: 'date-0',
        name: 'date',
        parameters: {
          date: '2026-10-02T00:00:00.000Z',
          infinite: null,
          items: [null, null],
        },
      });
      await history.waitForCommit();
      expect([
        owners.snapshot().liveRows,
        owners.snapshot().liveSerializedBytes,
      ]).toStrictEqual([0, 0]);
    });
  });

  it('rejects a row whose serialization fails at admission and remains usable', async () => {
    await withBatchFixture(async ({ history, owners }) => {
      let fail = true;
      const original = exportSummaryRow(0);
      const row = {
        ...original,
        toJSON(): IContent {
          if (fail) throw new Error('export serialization failed');
          return original;
        },
      };
      expect(() => history.addBatch([row])).toThrow(
        'export serialization failed',
      );
      expect(history.length()).toBe(0);
      expect(owners.snapshot().liveRows).toBe(0);
      fail = false;
      await history.addBatch([row]);
      const hash = createHash('sha256');
      await history.writeJSON(async (chunk) => {
        hash.update(chunk);
      });
      const stored = await Array.fromAsync(history.streamRawHistory());
      expect(stored).toHaveLength(1);
      expect(hash.digest('hex')).toBe(sha256(JSON.stringify(stored, null, 2)));
      await history.waitForCommit();
      expect([
        owners.snapshot().liveRows,
        owners.snapshot().liveSerializedBytes,
      ]).toStrictEqual([0, 0]);
    });
  });
});
