/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { IdTrieReader } from './idTrieReader.js';
import { encodeIdTrieNode } from './idTrieNode.js';
import { frameLength } from './frame.js';

async function liveIndexBytes(
  reader: IdTrieReader,
  offset: number,
): Promise<number> {
  if (offset === 0) return 0;
  const node = await reader.readNode(offset);
  let bytes = frameLength(encodeIdTrieNode(node).kindHeader.length, 0);
  if (node.kind === 'internal') {
    for (const child of node.children)
      bytes += await liveIndexBytes(reader, child);
  }
  return bytes;
}
import { JournalInputError } from './errors.js';
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { stat } from 'node:fs/promises';
import { JournalSession } from '../services/history/journalSession.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import {
  DENSITY_PRUNED_POINTER,
  DENSITY_RECENCY_REVISION,
  densityRecencyFactPolicy,
} from '../services/history/densityRecencyFacts.js';
import type { IContent } from '../services/history/IContent.js';
import { JournalStore } from './journalStore.js';
import { RECENCY_INDEX_READY } from './recencyFacts.js';
import { storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { BoundedIdNodeCache, ID_NODE_CACHE_BYTES } from './idTrieCache.js';
import { sha256KeyHash } from './idKeys.js';

function response(index: number, pruned = false): IContent {
  return {
    speaker: 'tool',
    blocks: [
      { type: 'text', text: 'side' },
      {
        type: 'tool_response',
        callId: `id-${index}`,
        toolName: index % 2 !== 0 ? 'odd' : 'even',
        result: pruned ? DENSITY_PRUNED_POINTER : `value-${index}`,
      },
    ],
  };
}
async function counts(session: JournalSession): Promise<readonly number[]> {
  const snapshot = await session.store.snapshot();
  try {
    const facts = await snapshot.recencyFacts(DENSITY_RECENCY_REVISION);
    return [
      await facts.maximum(),
      await facts.count('even'),
      await facts.count('odd'),
    ];
  } finally {
    await snapshot.close();
  }
}

describe('native continuous recency facts', () => {
  const directory = useTempDir('native-recency-facts-');
  it('keeps ordinal and bucket identity across append, density, insert, pop, restore, clone, compaction and reopen', async () => {
    const file = join(directory(), 'mutations.llxj');
    const session = await JournalSession.create(file);
    try {
      await session.append(
        Array.from({ length: 8 }, (_, index) => response(index)),
      );
      expect(await counts(session)).toStrictEqual([4, 4, 4]);
      const saved = await session.store.snapshot();
      try {
        const facts = await saved.recencyFacts(DENSITY_RECENCY_REVISION);
        const first = await saved.entryAt(0);
        const second = await saved.entryAt(1);
        expect(await facts.ordinal(first.label, 1)).toBe(1);
        expect(await facts.count('even')).toBe(4);
        expect(await facts.count('odd')).toBe(4);
        await session.append([response(8), response(9, true)]);
        expect(await counts(session)).toStrictEqual([5, 5, 4]);
        await session.store.commit([
          {
            kind: 'density',
            removed: [second.label],
            replacements: [
              {
                label: first.label,
                draft: encodeContentRow(response(0, true), { owner: 0 }),
              },
            ],
          },
        ]);
        expect(await counts(session)).toStrictEqual([4, 4, 3]);
        await session.store.commit([
          {
            kind: 'insert',
            afterLabel: first.label,
            draft: encodeContentRow(response(11), { owner: 0 }),
          },
        ]);
        expect(await counts(session)).toStrictEqual([4, 4, 4]);
        const current = await session.store.snapshot();
        try {
          await session.store.commit([
            {
              kind: 'pop',
              cutLabel: (await current.entryAt(current.rows - 2)).label,
              expectedRemoved: 2,
            },
          ]);
        } finally {
          await current.close();
        }
        expect(await counts(session)).toStrictEqual([4, 3, 4]);
        expect(await facts.count('even')).toBe(4);
        expect(await facts.count('odd')).toBe(4);
        if (saved.version === undefined)
          throw new Error('Missing saved version');
        await session.store.commit([{ kind: 'restore', saved: saved.version }]);
        expect(await counts(session)).toStrictEqual([4, 4, 4]);
        const clone = await session.cloneUnlinked();
        try {
          expect(await counts(clone)).toStrictEqual([4, 4, 4]);
        } finally {
          await clone.close();
        }
      } finally {
        await saved.close();
      }
      expect(await session.store.compact()).toBe('swapped');
      expect(await counts(session)).toStrictEqual([4, 4, 4]);
      const snapshot = await session.store.snapshot();
      try {
        await session.store.commit([
          {
            kind: 'compress',
            summary: encodeContentRow(
              { speaker: 'human', blocks: [{ type: 'text', text: 'summary' }] },
              { owner: 0 },
            ),
            retainFromLabel: (await snapshot.entryAt(6)).label,
            expectedReplaced: 6,
          },
        ]);
      } finally {
        await snapshot.close();
      }
      expect(await counts(session)).toStrictEqual([1, 1, 1]);
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(file);
    try {
      expect(await counts(reopened)).toStrictEqual([1, 1, 1]);
      await reopened.store.commit([{ kind: 'clear' }]);
      expect(await counts(reopened)).toStrictEqual([0, 0, 0]);
    } finally {
      await reopened.close();
    }
  });

  it('fills missing revision once on open, rejects a wrong revision and reuses warm facts without writes', async () => {
    const file = join(directory(), 'fill.llxj');
    const deps = storeDeps();
    const old = await JournalStore.create(file, {
      ...deps,
      idDeps: {
        ...deps.idDeps,
        hasher: (namespace, key) =>
          sha256KeyHash(
            namespace,
            new TextDecoder().decode(key) === RECENCY_INDEX_READY
              ? new Uint8Array([...key, 0])
              : key,
          ),
      },
    });
    await old.commit([
      { kind: 'append', rows: [encodeContentRow(response(0), { owner: 0 })] },
    ]);
    const before = old.published?.commitSeq ?? 0;
    await old.close();
    const session = await JournalSession.open(file);
    const sequence = session.store.published?.commitSeq;
    expect(sequence).toBe(before + 1);
    try {
      expect(await counts(session)).toStrictEqual([1, 1, 0]);
      const snapshot = await session.store.snapshot();
      try {
        await expect(snapshot.recencyFacts('wrong-revision')).rejects.toThrow(
          'requires a fill',
        );
      } finally {
        await snapshot.close();
      }
    } finally {
      await session.close();
    }
    const bytes = (await stat(file)).size;
    const warm = await JournalSession.open(file);
    try {
      expect(warm.store.published?.commitSeq).toBe(sequence);
      for (let index = 0; index < 40; index++)
        expect(await counts(warm)).toStrictEqual([1, 1, 0]);
      expect((await stat(file)).size - bytes).toBe(0);
    } finally {
      await warm.close();
    }
  });

  it.each([40, 4000])(
    'reads counts and one ordinal without walking %i history rows',
    async (size) => {
      const counter = { reads: 0 };
      const caches: BoundedIdNodeCache[] = [];
      const store = await JournalStore.create(join(directory(), 'cost.llxj'), {
        ...storeDeps({
          seams: testJournalSeams({ readCounter: counter }, 1, false),
          createCache: () => {
            const cache = new BoundedIdNodeCache();
            caches.push(cache);
            return cache;
          },
        }),
        recencyFactPolicy: densityRecencyFactPolicy,
      });
      try {
        await store.commit([
          {
            kind: 'replace',
            rows: (function* () {
              for (let index = 0; index < size; index++)
                yield encodeContentRow(response(index), { owner: 0 });
            })(),
          },
        ]);
        const snapshot = await store.snapshot();
        try {
          const label = (await snapshot.entryAt(size - 1)).label;
          const facts = await snapshot.recencyFacts(DENSITY_RECENCY_REVISION);
          counter.reads = 0;
          const lookups = snapshot.facts.lookups;
          expect(await facts.maximum()).toBe(size / 2);
          expect(await facts.count('odd')).toBe(size / 2);
          expect(await facts.ordinal(label, 1)).toBe(size / 2);
          expect(snapshot.facts.lookups - lookups).toBe(3);
          expect(counter.reads).toBeLessThanOrEqual(
            3 * Math.ceil(Math.log2(size)) + 8,
          );
          expect(
            caches.every(
              (cache) =>
                cache.capBytes === ID_NODE_CACHE_BYTES &&
                cache.bytes <= ID_NODE_CACHE_BYTES,
            ),
          ).toBe(true);
          process.stdout.write(
            `RECENCY_QUERY ${JSON.stringify({ size, reads: counter.reads, lookups: snapshot.facts.lookups - lookups, caches: caches.map((cache) => ({ bytes: cache.bytes, cap: cache.capBytes })) })}\n`,
          );
          const read = await store.openRead();
          try {
            const live = await liveIndexBytes(
              new IdTrieReader(read.access, new BoundedIdNodeCache()),
              read.version?.roots.idRoot ?? 0,
            );
            const payload = 4 * (size + 3);
            const total = (await stat(store.path)).size;
            expect(live).toBeGreaterThan(payload);
            expect(live).toBeLessThan(total);
            process.stdout.write(
              `RECENCY_STORAGE ${JSON.stringify({ size, liveSharedTrieBytes: live, recencyPayloadBytes: payload, totalFileBytes: total, rowAggregateLiveBytes: store.published?.aggregate.liveBytes })}\n`,
            );
          } finally {
            await read.close();
          }
        } finally {
          await snapshot.close();
        }
      } finally {
        await store.close();
      }
    },
    180_000,
  );
  it('converts only newly appended response blocks after the initial fact fill', async () => {
    let converted = 0;
    const store = await JournalStore.create(
      join(directory(), 'incremental.llxj'),
      {
        ...storeDeps(),
        recencyFactPolicy: {
          ...densityRecencyFactPolicy,
          bucket: (bytes) => {
            converted++;
            return densityRecencyFactPolicy.bucket(bytes);
          },
        },
      },
    );
    try {
      await store.commit([
        {
          kind: 'replace',
          rows: (function* () {
            for (let index = 0; index < 4000; index++)
              yield encodeContentRow(response(index), { owner: 0 });
          })(),
        },
      ]);
      expect(converted).toBe(4000);
      converted = 0;
      await store.commit([
        {
          kind: 'append',
          rows: [encodeContentRow(response(4000), { owner: 0 })],
        },
      ]);
      expect(converted).toBe(1);
    } finally {
      await store.close();
    }
  }, 180_000);
  it('drops tentative facts after a streamed producer failure and continues on the same writer', async () => {
    const session = await JournalSession.create(
      join(directory(), 'producer.llxj'),
    );
    const primary = new Error('recency producer rejected');
    try {
      await session.append([response(0)]);
      await expect(
        session.store.commit([
          {
            kind: 'replace',
            rows: (async function* () {
              for (let index = 0; index < 65; index++)
                yield encodeContentRow(response(index), { owner: 0 });
              throw new JournalInputError(primary);
            })(),
          },
        ]),
      ).rejects.toBe(primary);
      expect(await counts(session)).toStrictEqual([1, 1, 0]);
      await session.append([response(1)]);
      expect(await counts(session)).toStrictEqual([1, 1, 1]);
    } finally {
      await session.close();
    }
  });
});
