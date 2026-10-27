/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { IdFactRuns } from './id-fact-runs.js';
import { sha256KeyHash } from './idKeys.js';
import { compareIdHashes } from './idTrieNode.js';
import type { IdTrieReader } from './idTrieReader.js';
import {
  CountingAppender,
  IdTrieFixture,
} from './__tests__/support/idTrieHarness.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

async function nodeCount(reader: IdTrieReader, root: number): Promise<number> {
  const node = await reader.readNode(root);
  let count = 1;
  if (node.kind === 'internal')
    for (const child of node.children) count += await nodeCount(reader, child);
  return count;
}

describe('fact run settlement write amplification', () => {
  const directory = useTempDir('fact-run-settlement-');
  it('settles all runs in one pass and preserves newest facts', async () => {
    const trie = await IdTrieFixture.create(join(directory(), 'facts.llxj'));
    let writes = 0;
    const shared = sha256KeyHash(0, new TextEncoder().encode('shared'));
    try {
      await trie.commit(async (target) => {
        const appender = new CountingAppender(target);
        const runs = new IdFactRuns({
          appender,
          readGroup: (end) => trie.accessTo(end),
        });
        for (let batch = 0; batch < 31; batch++) {
          const entries = Array.from({ length: 32 }, (_, index) => ({
            hash: sha256KeyHash(
              0,
              new TextEncoder().encode(`${batch}:${index}`),
            ),
            value: Uint8Array.of(batch, index),
          }));
          entries.push({ hash: shared, value: Uint8Array.of(batch) });
          entries.sort((a, b) => compareIdHashes(a.hash, b.hash));
          await runs.append(entries);
        }
        const before = appender.records;
        const root = await runs.commit();
        writes = appender.records - before;
        return root;
      });
      const reader = trie.reader();
      const nodes = await nodeCount(reader, trie.root);
      let facts = 0;
      let newest: Uint8Array | undefined;
      for await (const entry of reader.entries(trie.root)) {
        const sharedEntry = compareIdHashes(entry.hash, shared) === 0;
        if (sharedEntry) newest = entry.value;
        expect(entry.value.length).toBe(sharedEntry ? 1 : 2);
        facts++;
      }
      expect(newest).toStrictEqual(Uint8Array.of(30));
      expect(facts).toBe(31 * 32 + 1);
      process.stdout.write(
        `FACT_RUN_SETTLEMENT ${JSON.stringify({ writes, nodes })}\n`,
      );
      expect(writes).toBeLessThan(2 * nodes);
    } finally {
      await trie.close();
    }
  });
});
