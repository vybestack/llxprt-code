/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { ChronologyFacts, CHRONOLOGY_INDEX_READY } from './chronologyFacts.js';
import { ID_NS, sha256KeyHash } from './idKeys.js';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { BoundedIdNodeCache, ID_NODE_CACHE_BYTES } from './idTrieCache.js';
import { ROW_FLAG } from './rowRecord.js';
import { JournalSession } from '../services/history/journalSession.js';
import type { IContent } from '../services/history/IContent.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';

function content(seq: number): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text: `seq ${seq}` }],
    metadata: { chronology: { seq, userTurn: 1, step: 0, recordedAt: 0 } },
  };
}

async function assertFacts(store: JournalStore): Promise<void> {
  const snapshot = await store.snapshot();
  try {
    const rows = [];
    for await (const entry of snapshot.entries()) rows.push(entry);
    const seqs = new Set(rows.map((entry) => entry.chronologySeq));
    const facts = new ChronologyFacts(snapshot.facts);
    for (const seq of seqs) {
      for (const curated of [false, true]) {
        const expected = rows.filter(
          (entry) =>
            entry.chronologySeq === seq &&
            (!curated || (entry.flags & ROW_FLAG.curated) !== 0),
        );
        expect(await facts.count(seq, curated)).toBe(expected.length);
        const labels = await Promise.all(
          expected.map((_entry, index) => facts.label(seq, curated, index + 1)),
        );
        expect(labels).toStrictEqual(expected.map((entry) => entry.label));
      }
    }
  } finally {
    await snapshot.close();
  }
}

describe('versioned chronology occurrence facts', () => {
  const directory = useTempDir('chronology-facts-');

  it.each([40, 4000])(
    'answers a selected query over %i duplicate sequences within a logarithmic read budget and fixed caches',
    async (size) => {
      const counter = { reads: 0 };
      const caches: BoundedIdNodeCache[] = [];
      const store = await JournalStore.create(
        join(directory(), 'cost.llxj'),
        storeDeps({
          seams: testJournalSeams({ readCounter: counter }, 1, false),
          createCache: () => {
            const cache = new BoundedIdNodeCache();
            caches.push(cache);
            return cache;
          },
        }),
      );
      try {
        await store.commit([
          {
            kind: 'append',
            rows: Array.from({ length: size }, () =>
              draftRow({ chronologySeq: 3n }),
            ),
          },
        ]);
        const snapshot = await store.snapshot();
        try {
          const from = (await snapshot.entryAt(size - 2)).label;
          const to = (await snapshot.entryAt(size - 1)).label;
          const facts = new ChronologyFacts(snapshot.facts);
          const before = snapshot.facts.lookups;
          counter.reads = 0;
          expect(await facts.inRange(3n, from, to)).toBe(true);
          const reads = counter.reads;
          const lookups = snapshot.facts.lookups - before;
          const depth = Math.ceil(Math.log2(size));
          expect(lookups).toBeLessThanOrEqual(depth + 2);
          expect(reads).toBeLessThanOrEqual(2 * 32 * (depth + 2));
          expect(
            caches.every(
              (cache) =>
                cache.capBytes === ID_NODE_CACHE_BYTES &&
                cache.bytes <= ID_NODE_CACHE_BYTES,
            ),
          ).toBe(true);
          process.stdout.write(
            `CHRONOLOGY_QUERY ${JSON.stringify({ size, reads, lookups, caches: caches.map((cache) => ({ bytes: cache.bytes, cap: cache.capBytes })) })}\n`,
          );
        } finally {
          await snapshot.close();
        }
      } finally {
        await store.close();
      }
    },
  );

  it('rebuilds ordered occurrences through insertion, chronology and curation rewrites, pop, restore and clone', async () => {
    const session = await JournalSession.create(
      join(directory(), 'mutations.llxj'),
    );
    try {
      await session.append([content(8), content(2), content(8), content(4)]);
      await assertFacts(session.store);
      const saved = await session.store.snapshot();
      try {
        const second = await saved.entryAt(1);
        await session.store.commit([
          {
            kind: 'insert',
            afterLabel: second.label,
            draft: encodeContentRow(content(8), { owner: 0 }),
          },
        ]);
        await assertFacts(session.store);
        await session.store.commit([
          {
            kind: 'purge',
            rows: [
              {
                label: second.label,
                draft: encodeContentRow(
                  { speaker: 'ai', blocks: [], metadata: content(3).metadata },
                  { owner: 0 },
                ),
              },
            ],
          },
        ]);
        await assertFacts(session.store);
        const current = await session.store.snapshot();
        try {
          const tail = await current.entryAt(current.rows - 1);
          await session.store.commit([
            { kind: 'pop', cutLabel: tail.label, expectedRemoved: 1 },
          ]);
        } finally {
          await current.close();
        }
        await assertFacts(session.store);
        const version = saved.version;
        if (version === undefined) throw new Error('Expected saved version');
        await session.store.commit([{ kind: 'restore', saved: version }]);
        await assertFacts(session.store);
        expect(await new ChronologyFacts(saved.facts).count(8n, false)).toBe(2);
        const cloned = await session.cloneUnlinked();
        try {
          await assertFacts(cloned.store);
        } finally {
          await cloned.close();
        }
      } finally {
        await saved.close();
      }
    } finally {
      await session.close();
    }
  });
  it('fills an absent chronology namespace on open once without changing source labels or owners', async () => {
    const file = join(directory(), 'absent-index.llxj');
    const deps = storeDeps();
    const before = await JournalStore.create(file, {
      ...deps,
      idDeps: {
        ...deps.idDeps,
        hasher: (namespace, key) =>
          sha256KeyHash(
            namespace,
            namespace === ID_NS.chronology ||
              new TextDecoder().decode(key) === CHRONOLOGY_INDEX_READY
              ? new Uint8Array([...key, 0])
              : key,
          ),
      },
    });
    await before.commit([
      {
        kind: 'append',
        rows: [
          encodeContentRow(content(7), { owner: 0 }),
          encodeContentRow(content(7), { owner: 0 }),
        ],
      },
    ]);
    const snapshot = await before.snapshot();
    const labels = [
      (await snapshot.entryAt(0)).label,
      (await snapshot.entryAt(1)).label,
    ];
    await snapshot.close();
    const sequence = before.published?.commitSeq ?? 0;
    await before.close();
    const reopened = await JournalSession.open(file);
    try {
      expect(reopened.store.published?.commitSeq).toBe(sequence + 1);
      await assertFacts(reopened.store);
      const current = await reopened.store.snapshot();
      try {
        expect([
          (await current.entryAt(0)).label,
          (await current.entryAt(1)).label,
        ]).toStrictEqual(labels);
        expect(await new ChronologyFacts(current.facts).count(7n, false)).toBe(
          2,
        );
      } finally {
        await current.close();
      }
    } finally {
      await reopened.close();
    }
    const warm = await JournalSession.open(file);
    try {
      expect(warm.store.published?.commitSeq).toBe(sequence + 1);
    } finally {
      await warm.close();
    }
  });

  it('publishes an explicit chronology rebuild once and preserves a ready index across reopen', async () => {
    const file = join(directory(), 'rebuild.llxj');
    const session = await JournalSession.create(file);
    await session.append([content(7), content(7), content(2)]);
    await session.store.commit([{ kind: 'chronology' }]);
    await assertFacts(session.store);
    const sequence = session.store.published?.commitSeq;
    await session.close();
    const reopened = await JournalSession.open(file);
    try {
      expect(reopened.store.published?.commitSeq).toBe(sequence);
      await assertFacts(reopened.store);
    } finally {
      await reopened.close();
    }
  });
});
