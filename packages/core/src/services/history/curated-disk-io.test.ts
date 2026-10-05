/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import { batchRow, withBatchFixture } from './addbatch-stream-test-helpers.js';
import { expectTicketDiskContents } from './ticket-disk-contract-test-helpers.js';
import { withCuratedHistoryForTest } from '../../test-utils/curated-history-fixture.js';
import type { IContent } from './IContent.js';

function observeDiskOperations(): {
  snapshot(): { opens: number; truncates: number };
  restore(): void;
} {
  let opens = 0;
  let truncates = 0;
  const originalOpen = fs.openSync;
  const originalTruncate = fs.ftruncateSync;
  const open = spyOn(fs, 'openSync').mockImplementation((file, flags, mode) => {
    const fd = originalOpen(file, flags, mode);
    opens++;
    return fd;
  });
  const truncate = spyOn(fs, 'ftruncateSync').mockImplementation((fd, size) => {
    originalTruncate(fd, size);
    truncates++;
  });
  return {
    snapshot: () => ({ opens, truncates }),
    restore: () => {
      truncate.mockRestore();
      open.mockRestore();
    },
  };
}

async function expectFullRows(
  rows: AsyncIterable<IContent>,
  expected: readonly IContent[],
): Promise<void> {
  let index = 0;
  for await (const row of rows) {
    expect(row).toStrictEqual(expected[index]);
    expect(JSON.stringify(row)).toBe(JSON.stringify(expected[index]));
    index++;
  }
  expect(index).toBe(expected.length);
}

describe('curated queries over real disk with bounded I/O', () => {
  it('publishes complete values without reopening ticket storage per acknowledgement', async () => {
    await withBatchFixture(async ({ history, recorder }) => {
      const rows = Array.from({ length: 512 }, (_, index) => batchRow(index));
      const disk = observeDiskOperations();
      try {
        await history.addBatch(rows);
        expectTicketDiskContents(recorder, rows.length, (index) => rows[index]);
        await expectFullRows(history.streamRawHistory(), rows);
        expect(history.getTotalTokens()).toBe(4 * rows.length);
        expect(disk.snapshot().opens).toBeLessThanOrEqual(32);
      } finally {
        disk.restore();
      }
    });
  });

  it('preserves the full eager oracle without truncating empty scratch indexes per row', async () => {
    await withBatchFixture(async ({ history, recorder, reads }) => {
      const rows = Array.from({ length: 512 }, (_, index) => batchRow(index));
      await history.addBatch(rows);
      expectTicketDiskContents(recorder, rows.length, (index) => rows[index]);
      await withCuratedHistoryForTest(history, async (oracle) => {
        const disk = observeDiskOperations();
        try {
          await expectFullRows(history.streamCuratedHistory(), oracle);
          expect(await history.countCuratedRows()).toBe(oracle.length);
          expect(await history.matchingCuratedPrefix(oracle)).toBe(
            oracle.length,
          );
          expect(disk.snapshot().truncates).toBeLessThanOrEqual(16);
          expect(reads.snapshot().peakDecodedRows).toBe(1);
          expect(history.getTotalTokens()).toBe(4 * rows.length);
        } finally {
          disk.restore();
        }
      });
    });
  });
});
