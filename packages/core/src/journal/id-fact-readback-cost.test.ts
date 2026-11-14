/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { FactFixture, realDeps } from './__tests__/support/idFactFixture.js';
import {
  occurrencesOf,
  randomRows,
} from './__tests__/support/idHistoryModel.js';
import { createFileHandleReader } from './positionalFile.js';
import { createRecordAccess } from './recordAccess.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { IdFactBatch } from './idFactBatch.js';
import { IdTrieFixture, hex } from './__tests__/support/idTrieHarness.js';
import { BoundedIdNodeCache } from './idTrieCache.js';

describe('fact spill readback', () => {
  const directory = useTempDir('fact-readback-');
  it('does not reread freshly encoded facts while the live trie fits the node cache', async () => {
    const counter = { reads: 0 };
    const file = join(directory(), 'spilled.llxj');
    const trie = await IdTrieFixture.create(file);
    const handle = await open(file, 'r');
    const reader = createFileHandleReader({
      read: async (...args) => {
        counter.reads++;
        return handle.read(...args);
      },
    });
    const expected = await FactFixture.create(join(directory(), 'whole.llxj'));
    const occurrences = occurrencesOf(randomRows(307, 16));
    try {
      await expected.bulk(occurrences);
      await trie.commit(async (appender) => {
        const batch = new IdFactBatch(undefined, 0, realDeps(), 0, {
          appender,
          readGroup: (end) =>
            createRecordAccess(file, reader, {
              selfOffset: 0,
              durableEnd: end,
            }),
          capBytes: 1,
        });
        for (const occurrence of occurrences) await batch.apply(occurrence);
        return (await batch.commit(appender)).root;
      });
      process.stdout.write(`FACT_READBACK ${counter.reads}\n`);
      expect(counter.reads).toBe(0);
      const cache = new BoundedIdNodeCache();
      const actual: string[] = [];
      for await (const entry of trie.reader(cache).entries(trie.root))
        actual.push(`${hex(entry.hash)}=${hex(entry.value)}`);
      const wanted: string[] = [];
      for await (const entry of expected.entries())
        wanted.push(`${hex(entry.hash)}=${hex(entry.value)}`);
      expect(wanted.length).toBeGreaterThan(0);
      expect(actual).toStrictEqual(wanted);
      expect(cache.bytes).toBeLessThanOrEqual(64 * 1024);
    } finally {
      await handle.close();
      await trie.close();
      await expected.close();
    }
  });
});
