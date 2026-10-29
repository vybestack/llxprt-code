/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { ROW_SPEAKER } from './rowRecord.js';

describe('committed node read cost', () => {
  const directory = useTempDir('committed-node-cost-');
  it('keeps small tool-pair commits from rereading their freshly written trie paths', async () => {
    const counter = { reads: 0 };
    const store = await JournalStore.create(
      join(directory(), 'pairs.llxj'),
      storeDeps({
        seams: testJournalSeams({ readCounter: counter }, 1, false),
      }),
    );
    const pairs = 128;
    try {
      for (let index = 0; index < pairs; index++) {
        const id = `call-${index}`;
        await store.commit([
          {
            kind: 'append',
            rows: [
              draftRow({ text: `question ${index}` }),
              draftRow({ speaker: ROW_SPEAKER.ai, calls: [id] }),
              draftRow({ speaker: ROW_SPEAKER.tool, responses: [id] }),
            ],
          },
        ]);
      }
      const reads = counter.reads;
      process.stdout.write(
        `COMMITTED_NODE_READS ${JSON.stringify({ pairs, reads })}\n`,
      );
      expect(store.published?.rows).toBe(3 * pairs);
      expect(reads).toBeLessThanOrEqual(12 * pairs);
      const facts = await store.idFacts();
      try {
        for (let index = 0; index < pairs; index++) {
          const fact = await facts.fact(`call-${index}`);
          expect(fact?.callCount).toBe(1);
          expect(fact?.respCount).toBe(1);
        }
      } finally {
        await facts.close();
      }
    } finally {
      await store.close();
    }
  });
});
