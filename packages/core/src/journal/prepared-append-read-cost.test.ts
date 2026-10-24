/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

const cases = [
  {
    count: 4096,
    reads: 31066,
    digest: '6ca6a3be344776b5b0feef86f31bb3da898c4d38c4bdb74a89fb5ddc9a7a8763',
  },
  {
    count: 8192,
    reads: 68201,
    digest: '4208bb94aab3e9d37f036554b2f76d5a93fc428f757e182a28cfb69f81f890eb',
  },
];

describe('prepared append descriptor read cost', () => {
  const directory = useTempDir('prepared-append-reads-');
  it.each(cases)(
    'bounds trie readback without changing durable bytes for $count rows',
    async ({ count, reads, digest }) => {
      const counter = { reads: 0 };
      const file = join(directory(), `${count}.llxj`);
      const store = await JournalStore.create(
        file,
        storeDeps({
          seams: testJournalSeams({ readCounter: counter }, 1, false),
        }),
      );
      try {
        await store.commit([
          {
            kind: 'prepared',
            admission: [],
            prepare: async (group) => {
              await group.append(
                (async function* () {
                  for (let index = 0; index < count; index++)
                    yield draftRow({
                      text: `row ${index}`,
                      chronologySeq: BigInt(index),
                    });
                })(),
                [],
              );
            },
          },
        ]);
        process.stdout.write(
          `PREPARED_APPEND_READS ${JSON.stringify({ count, reads: counter.reads })}\n`,
        );
        expect(store.published?.rows).toBe(count);
        expect(
          createHash('sha256')
            .update(await readFile(file))
            .digest('hex'),
        ).toBe(digest);
        expect(counter.reads).toBeLessThanOrEqual(reads);
      } finally {
        await store.close();
      }
    },
    180000,
  );
});
