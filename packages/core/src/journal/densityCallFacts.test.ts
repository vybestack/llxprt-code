/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import {
  DensityCallFacts,
  DENSITY_CALL_INDEX_READY,
} from './densityCallFacts.js';
import { JournalSession } from '../services/history/journalSession.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import type { IContent } from '../services/history/IContent.js';
import { ROW_FLAG } from './rowRecord.js';
import { ID_NS, sha256KeyHash } from './idKeys.js';
import { JournalStore } from './journalStore.js';
import { storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { BoundedIdNodeCache, ID_NODE_CACHE_BYTES } from './idTrieCache.js';

function row(index: number): IContent {
  const id = ['', 'a:b', 'a_b'][index % 3];
  return {
    speaker: index % 2 === 0 ? 'ai' : 'tool',
    blocks:
      index % 2 === 0
        ? [
            {
              type: 'tool_call',
              id,
              name: 'read_file',
              parameters: { file_path: `/${index}` },
            },
          ]
        : [
            {
              type: 'tool_response',
              callId: id,
              toolName: 'read_file',
              result: `result-${index}`,
            },
          ],
    metadata: {
      chronology: { seq: index % 3, userTurn: 1, step: 0, recordedAt: 0 },
    },
  };
}

async function assertFacts(store: JournalStore): Promise<void> {
  const snapshot = await store.snapshot();
  try {
    const facts = new DensityCallFacts(snapshot.facts);
    const rows = [];
    for await (const entry of snapshot.entries())
      rows.push(await snapshot.readIds(entry));
    for (const id of ['', 'a:b', 'a_b', 'missing']) {
      const calls = rows.filter(
        ({ header, rawIds }) =>
          (header.flags & ROW_FLAG.curated) !== 0 &&
          header.speaker === 1 &&
          rawIds.includes(id) &&
          header.ids.some((tuple) => tuple.kind === 0),
      );
      const responses = rows.filter(
        ({ header, rawIds }) =>
          (header.flags & ROW_FLAG.curated) !== 0 &&
          header.speaker === 2 &&
          rawIds.includes(id) &&
          header.ids.some((tuple) => tuple.kind === 1),
      );
      const first = calls.find((_, index) => index === 0);
      const last = responses.find((_, index) => index === responses.length - 1);
      expect(await facts.firstCall(id)).toStrictEqual(
        first === undefined
          ? undefined
          : { label: first.header.label, block: 0 },
      );
      expect(await facts.lastResponse(id)).toBe(last?.header.label);
    }
  } finally {
    await snapshot.close();
  }
}

describe('versioned source-row density call lookup', () => {
  const directory = useTempDir('density-call-facts-');
  it('tracks exact raw IDs, first-call order and last tool response through mutation and old pins', async () => {
    const file = join(directory(), 'mutations.llxj');
    const session = await JournalSession.create(file);
    try {
      await session.append(
        Array.from({ length: 18 }, (_, index) => row(index)),
      );
      await assertFacts(session.store);
      const saved = await session.store.snapshot();
      try {
        const first = { label: (await saved.entryAt(0)).label, block: 0 };
        const last = (await saved.entryAt(15)).label;
        await session.append([row(18), row(19)]);
        await assertFacts(session.store);
        expect(
          await new DensityCallFacts(saved.facts).firstCall(''),
        ).toStrictEqual(first);
        expect(await new DensityCallFacts(saved.facts).lastResponse('')).toBe(
          last,
        );
        const anchor = await saved.entryAt(1);
        await session.store.commit([
          {
            kind: 'insert',
            afterLabel: anchor.label,
            draft: encodeContentRow(row(20), { owner: 0 }),
          },
        ]);
        await assertFacts(session.store);
        await session.store.commit([
          {
            kind: 'purge',
            rows: [
              {
                label: anchor.label,
                draft: encodeContentRow(
                  { speaker: 'ai', blocks: [] },
                  { owner: 0 },
                ),
              },
            ],
          },
        ]);
        await assertFacts(session.store);
        const current = await session.store.snapshot();
        try {
          await session.store.commit([
            {
              kind: 'pop',
              cutLabel: (await current.entryAt(current.rows - 3)).label,
              expectedRemoved: 3,
            },
          ]);
        } finally {
          await current.close();
        }
        await assertFacts(session.store);
        if (saved.version === undefined) throw new Error('Expected version');
        await session.store.commit([{ kind: 'restore', saved: saved.version }]);
        await assertFacts(session.store);
        const clone = await session.cloneUnlinked();
        try {
          await assertFacts(clone.store);
        } finally {
          await clone.close();
        }
      } finally {
        await saved.close();
      }
    } finally {
      await session.close();
    }
    const reopened = await JournalSession.open(file);
    try {
      await assertFacts(reopened.store);
      await reopened.store.commit([{ kind: 'clear' }]);
      await assertFacts(reopened.store);
    } finally {
      await reopened.close();
    }
  });
  it.each([40, 4000])(
    'does bounded point lookups over %i rows without decoding history',
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
            kind: 'replace',
            rows: (function* () {
              for (let index = 0; index < size; index++)
                yield encodeContentRow(row(index), { owner: 0 });
            })(),
          },
        ]);
        const snapshot = await store.snapshot();
        try {
          const facts = new DensityCallFacts(snapshot.facts);
          counter.reads = 0;
          const before = snapshot.facts.lookups;
          expect(await facts.firstCall('a:b')).toStrictEqual({
            label: (await snapshot.entryAt(4)).label,
            block: 0,
          });
          expect(await facts.lastResponse('missing')).toBeUndefined();
          const lookups = snapshot.facts.lookups - before;
          expect(lookups).toBe(2);
          expect(counter.reads).toBeLessThanOrEqual(2 * 32 + 8);
          expect(
            caches.every(
              (cache) =>
                cache.capBytes === ID_NODE_CACHE_BYTES &&
                cache.bytes <= ID_NODE_CACHE_BYTES,
            ),
          ).toBe(true);
          process.stdout.write(
            `DENSITY_CALL_QUERY ${JSON.stringify({ size, lookups, reads: counter.reads, caches: caches.map((cache) => ({ bytes: cache.bytes, cap: cache.capBytes })) })}\n`,
          );
        } finally {
          await snapshot.close();
        }
      } finally {
        await store.close();
      }
    },
  );
  it('fills an absent namespace on open once and preserves current row identity', async () => {
    const file = join(directory(), 'absent.llxj');
    const deps = storeDeps();
    const old = await JournalStore.create(file, {
      ...deps,
      idDeps: {
        ...deps.idDeps,
        hasher: (namespace, key) =>
          sha256KeyHash(
            namespace,
            namespace === ID_NS.densityCall ||
              new TextDecoder().decode(key) === DENSITY_CALL_INDEX_READY
              ? new Uint8Array([...key, 0])
              : key,
          ),
      },
    });
    await old.commit([
      {
        kind: 'append',
        rows: [
          encodeContentRow(row(0), { owner: 0 }),
          encodeContentRow(row(1), { owner: 0 }),
        ],
      },
    ]);
    const sequence = old.published?.commitSeq ?? 0;
    await old.close();
    const opened = await JournalSession.open(file);
    try {
      expect(opened.store.published?.commitSeq).toBe(sequence + 1);
      await assertFacts(opened.store);
    } finally {
      await opened.close();
    }
    const warm = await JournalSession.open(file);
    try {
      expect(warm.store.published?.commitSeq).toBe(sequence + 1);
      await assertFacts(warm.store);
    } finally {
      await warm.close();
    }
  });
});
