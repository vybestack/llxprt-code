/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { open } from 'node:fs/promises';
import { JournalSession } from '../services/history/journalSession.js';
import type { IContent } from '../services/history/IContent.js';
import { decodeStoredRow } from '../services/history/journalRowCodec.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

function row(index: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `${index}:${'x'.repeat(128)}` }],
  };
}

describe('whole-row scan physical reads', () => {
  const directory = useTempDir('row-scan-cost-');
  it('checks the body CRC when all row bytes arrive from one prefetched window', async () => {
    const file = join(directory(), 'corrupt.llxj');
    const seams = testJournalSeams();
    const session = await JournalSession.create(file, {
      journal: seams.dependencies,
    });
    try {
      await session.append([row(0)]);
      const snapshot = await session.store.snapshot();
      try {
        const entry = await snapshot.entryAt(0);
        const offset = entry.recordOffset + entry.recordLength - 1;
        const corrupt = await open(file, 'r+');
        try {
          const byte = new Uint8Array(1);
          await corrupt.read(byte, 0, 1, offset);
          byte[0] ^= 1;
          await corrupt.write(byte, 0, 1, offset);
        } finally {
          await corrupt.close();
        }
        await expect(snapshot.readRow(entry)).rejects.toThrow('body CRC');
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
  });
  it.each([128, 512])(
    'reads %i adjacent rows through the bounded row window',
    async (size) => {
      const counter = { reads: 0 };
      const seams = testJournalSeams({ readCounter: counter }, 1, false);
      const session = await JournalSession.create(
        join(directory(), `${size}.llxj`),
        { journal: seams.dependencies },
      );
      try {
        await session.append(
          Array.from({ length: size }, (_, index) => row(index)),
        );
        const snapshot = await session.store.snapshot();
        counter.reads = 0;
        let seen = 0;
        try {
          for await (const entry of snapshot.entries()) {
            expect(
              decodeStoredRow(await snapshot.readRow(entry)),
            ).toStrictEqual(row(seen++));
          }
          expect(seen).toBe(size);
          expect(counter.reads).toBeLessThan(size);
          process.stdout.write(
            `ROW_SCAN_COST ${JSON.stringify({ size, reads: counter.reads })}\n`,
          );
        } finally {
          await snapshot.close();
        }
      } finally {
        await session.close();
      }
    },
  );
});
