/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { storeDeps } from '../../journal/__tests__/support/storeFixtures.js';
import { JournalStore } from '../../journal/journalStore.js';
import { rowAlgebra } from '../../journal/rowAlgebra.js';
import {
  BoundedIdNodeCache,
  ID_NODE_CACHE_BYTES,
} from '../../journal/idTrieCache.js';
import { JournalSession } from './journalSession.js';
import { JournalDumpSnapshot } from './journalDumpSnapshot.js';
import { encodeContentRow } from './journalRowCodec.js';
import type { IContent } from './IContent.js';

async function assertCuts(
  session: JournalSession,
  expected: readonly number[],
): Promise<void> {
  const snapshot = await session.store.snapshot();
  try {
    expect(snapshot.version?.aggregate.humanRows).toBe(expected.length);
    for (let index = 0; index < expected.length; index++) {
      expect(await snapshot.humanCut(index + 1, false)).toBe(expected[index]);
      expect(await snapshot.humanCut(expected.length - index, true)).toBe(
        expected[index],
      );
    }
    expect(await snapshot.humanCut(expected.length + 1, true)).toBe(0);
    expect(await snapshot.humanCut(expected.length + 1, false)).toBe(
      snapshot.rows,
    );
  } finally {
    await snapshot.close();
  }
}

describe('native prefix indexed human selection', () => {
  const directory = useTempDir('indexed-human-cut-');
  for (const size of [40, 4000]) {
    it(`selects a human cut from speaker subtree counts at ${size} rows`, async () => {
      const counter = { reads: 0 };
      const caches: BoundedIdNodeCache[] = [];
      const store = await JournalStore.create(`${directory()}/source.llxj`, {
        ...storeDeps({
          seams: testJournalSeams({ readCounter: counter }),
          createCache: () => {
            const cache = new BoundedIdNodeCache();
            caches.push(cache);
            return cache;
          },
        }),
        algebra: rowAlgebra,
      });
      await store.commit([
        {
          kind: 'append',
          rows: Array.from({ length: size }, (_, index) =>
            encodeContentRow(
              { speaker: index % 2 === 0 ? 'human' : 'ai', blocks: [] },
              { owner: 0 },
            ),
          ),
        },
      ]);
      const dump = new JournalDumpSnapshot(await store.snapshot());
      try {
        counter.reads = 0;
        expect(await dump.humanCut(size / 4, true)).toBe(size / 2);
        expect(await dump.humanCut(size + 1, true)).toBe(0);
        expect(await dump.humanCut(2, false)).toBe(2);
        expect(counter.reads).toBeLessThan(40);
        expect(counter.reads).toBeLessThanOrEqual(
          4 * (Math.ceil(Math.log2(size)) + 1),
        );
        expect(caches.length).toBeGreaterThan(0);
        expect(
          caches.every(
            (cache) =>
              cache.capBytes === ID_NODE_CACHE_BYTES &&
              cache.bytes <= 64 * 1024,
          ),
        ).toBe(true);
        process.stdout.write(
          `CLI_PREFIX_QUERY ${JSON.stringify({ size, reads: counter.reads, caches: caches.map((cache) => ({ bytes: cache.bytes, cap: cache.capBytes })) })}\n`,
        );
      } finally {
        await dump.close();
        await store.close();
      }
    });
  }

  it('counts raw human speakers through ignored AI rows, insert, rewrite, pop, restore, copy and reopen', async () => {
    const path = `${directory()}/mutations.llxj`;
    const session = await JournalSession.create(path);
    const rows: IContent[] = [
      { speaker: 'tool', blocks: [] },
      { speaker: 'ai', blocks: [] },
      { speaker: 'human', blocks: [] },
      { speaker: 'ai', blocks: [{ type: 'text', text: '' }] },
      { speaker: 'human', blocks: [{ type: 'text', text: 'human two' }] },
      { speaker: 'human', blocks: [] },
    ];
    try {
      await session.append(rows);
      await assertCuts(session, [2, 4, 5]);
      const saved = await session.store.snapshot();
      try {
        const first = await saved.entryAt(0);
        await session.store.commit([
          {
            kind: 'insert',
            afterLabel: first.label,
            draft: encodeContentRow(
              { speaker: 'human', blocks: [] },
              { owner: 0 },
            ),
          },
        ]);
        await assertCuts(session, [1, 3, 5, 6]);
        const oldHuman = await saved.entryAt(2);
        await session.store.commit([
          {
            kind: 'purge',
            rows: [
              {
                label: oldHuman.label,
                draft: encodeContentRow(
                  { speaker: 'ai', blocks: [] },
                  { owner: 0 },
                ),
              },
            ],
          },
        ]);
        await assertCuts(session, [1, 5, 6]);
        const current = await session.store.snapshot();
        try {
          await session.store.commit([
            {
              kind: 'pop',
              cutLabel: (await current.entryAt(6)).label,
              expectedRemoved: 1,
            },
          ]);
        } finally {
          await current.close();
        }
        await assertCuts(session, [1, 5]);
        const version = saved.version;
        if (version === undefined) throw new Error('Missing original version');
        await session.store.commit([{ kind: 'restore', saved: version }]);
        await assertCuts(session, [2, 4, 5]);
        expect(await saved.humanCut(2, false)).toBe(4);
        const copy = await session.cloneUnlinked();
        try {
          await assertCuts(copy, [2, 4, 5]);
        } finally {
          await copy.close();
        }
      } finally {
        await saved.close();
      }
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(path);
    try {
      await assertCuts(reopened, [2, 4, 5]);
    } finally {
      await reopened.close();
    }
  });
});
