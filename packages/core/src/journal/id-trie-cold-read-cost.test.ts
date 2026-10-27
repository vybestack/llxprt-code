/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'bun:test';
import { BoundedIdNodeCache } from './idTrieCache.js';
import {
  IdTrieFixture,
  sortedByHash,
} from './__tests__/support/idTrieHarness.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('cold id fact lookup read cost', () => {
  it('leaves room for a leaf after shallow nodes from old roots accumulate', () => {
    const cache = new BoundedIdNodeCache();
    for (let index = 0; index < 512; index++)
      cache.put(index, new Uint8Array(132), true);
    cache.put(1000, new Uint8Array(100));
    expect(cache.get(1000)).toStrictEqual(new Uint8Array(100));
    expect(cache.bytes).toBeLessThanOrEqual(64 * 1024);
  });
  const directory = useTempDir('id-cold-read-');
  it.each([8192, 16384])(
    'keeps shallow paths resident across %i facts',
    async (size) => {
      const fixture = await IdTrieFixture.create(
        join(directory(), `${size}.llxj`),
      );
      const facts = Array.from({ length: size }, (_, index) => ({
        hash: createHash('sha256')
          .update(`fact-${index}`)
          .digest()
          .subarray(0, 16),
        value: new Uint8Array(100).fill(index % 256),
      }));
      try {
        await fixture.bulk(sortedByHash(facts));
        const cache = new BoundedIdNodeCache();
        const reader = fixture.reader(cache);
        fixture.reads.reads = 0;
        fixture.reads.bytes = 0;
        for (const fact of facts.slice(0, 2048)) {
          expect(await reader.lookup(fixture.root, fact.hash)).toStrictEqual(
            fact.value,
          );
          expect(cache.bytes).toBeLessThanOrEqual(64 * 1024);
        }
        process.stdout.write(
          `COLD_ID_READS ${JSON.stringify({ size, reads: fixture.reads.reads, bytes: fixture.reads.bytes })}\n`,
        );
        expect(fixture.reads.reads).toBeLessThanOrEqual(2048 * 1.5 + 273);
        expect(fixture.reads.bytes).toBeLessThanOrEqual((2048 + 273) * 1024);
      } finally {
        await fixture.close();
      }
    },
  );
});
