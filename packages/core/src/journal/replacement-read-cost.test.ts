/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalSession } from '../services/history/journalSession.js';
import { detachedRows } from '../services/history/detached-rollback-test-helpers.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('replacement physical read scaling', () => {
  const directory = useTempDir('replacement-read-cost-');
  it('bounds fourfold history growth to one extra id-trie level per fact', async () => {
    const perRow: number[] = [];
    for (const size of [2048, 8192]) {
      const counter = { reads: 0, bytes: 0 };
      const session = await JournalSession.create(
        join(directory(), `${size}.llxj`),
        {
          journal: testJournalSeams({ readCounter: counter }, 1, false)
            .dependencies,
        },
      );
      try {
        counter.reads = 0;
        counter.bytes = 0;
        await session.store.commit([
          {
            kind: 'replace',
            rows: (async function* () {
              for await (const row of detachedRows(size))
                yield encodeContentRow(row, { owner: 0 });
            })(),
          },
        ]);
        perRow.push(counter.reads / size);
        process.stdout.write(
          `REPLACEMENT_READ_COST ${JSON.stringify({ size, ...counter, perRow: counter.reads / size })}\n`,
        );
        expect(session.store.published?.rows).toBe(size);
        let seen = 0;
        for await (const entry of session.store.rows()) {
          const row = await session.store.readRow(entry);
          expect(row.header.chronologySeq).toBe(BigInt(++seen));
        }
        expect(seen).toBe(size);
      } finally {
        await session.close();
      }
    }
    expect(perRow[1]).toBeLessThanOrEqual(perRow[0] + 4);
  }, 180000);
});
