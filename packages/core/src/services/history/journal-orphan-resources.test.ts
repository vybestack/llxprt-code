/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import * as fs from 'node:fs';
import * as promises from 'node:fs/promises';
import { JournalStore } from '../../journal/journalStore.js';
import {
  BoundedIdNodeCache,
  ID_NODE_CACHE_BYTES,
} from '../../journal/idTrieCache.js';
import { storeDeps } from '../../journal/__tests__/support/storeFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { planSourceRowOccurrences } from './source-fact-planner.js';
import { encodeContentRow } from './journalRowCodec.js';
import { streamJournalOrphanUnits } from './journal-orphan-units.js';
import { streamJournalResponseUnits } from './journal-response-units.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import type { RowDraft } from '../../journal/rowDraft.js';

async function createsDuring(action: () => Promise<void>): Promise<number> {
  const spies = [
    spyOn(fs, 'mkdirSync'),
    spyOn(fs, 'mkdtempSync'),
    spyOn(fs, 'writeFileSync'),
    spyOn(fs, 'appendFileSync'),
    spyOn(promises, 'mkdir'),
    spyOn(promises, 'mkdtemp'),
    spyOn(promises, 'writeFile'),
    spyOn(promises, 'appendFile'),
    spyOn(fs, 'mkdir'),
    spyOn(fs, 'mkdtemp'),
    spyOn(fs, 'writeFile'),
    spyOn(fs, 'appendFile'),
  ];
  const openSync = spyOn(fs, 'openSync');
  const open = spyOn(promises, 'open');
  const callbackOpen = spyOn(fs, 'open');
  function creates(flags: unknown): boolean {
    return typeof flags === 'number'
      ? (flags & fs.constants.O_CREAT) !== 0
      : typeof flags === 'string' && /[wa]/.test(flags);
  }
  try {
    await action();
    return (
      spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0) +
      [openSync.mock.calls, open.mock.calls, callbackOpen.mock.calls].reduce(
        (sum, calls) =>
          sum + calls.filter(([, flags]) => creates(flags)).length,
        0,
      )
    );
  } finally {
    for (const spy of spies) spy.mockRestore();
    openSync.mockRestore();
    open.mockRestore();
    callbackOpen.mockRestore();
  }
}

describe('indexed orphan unit resources', () => {
  const directory = useTempDir('orphan-resources-');

  it('observes external filesystem creation rather than filtering by scratch-root name', async () => {
    expect(
      await createsDuring(async () => {
        await promises.writeFile(`${directory()}/control`, 'created');
      }),
    ).toBe(1);
  });

  it('streams indexed real responses and media without operation files or an unbounded query cache', async () => {
    const caches: BoundedIdNodeCache[] = [];
    const deps = storeDeps();
    const store = await JournalStore.create(`${directory()}/responses.llxj`, {
      ...deps,
      idDeps: { ...deps.idDeps, occurrenceSpace: 'source' },
      planOccurrences: planSourceRowOccurrences,
      createCache: () => {
        const cache = new BoundedIdNodeCache();
        caches.push(cache);
        return cache;
      },
    });
    function* rows(): Generator<RowDraft> {
      for (let index = 0; index < 2000; index++) {
        const id = `response-${index}`;
        yield encodeContentRow(
          { speaker: 'ai', blocks: [call(id)] },
          { owner: 7 },
        );
        yield encodeContentRow(
          {
            speaker: 'tool',
            blocks: [
              response(id),
              {
                type: 'media',
                mimeType: 'image/png',
                data: 'YWJj',
                encoding: 'base64',
              },
            ],
          },
          { owner: 7 },
        );
      }
    }
    try {
      await store.commit([{ kind: 'replace', rows: rows() }]);
      const snapshot = await store.snapshot();
      try {
        let count = 0;
        let media = 0;
        const creates = await createsDuring(async () => {
          for await (const unit of streamJournalResponseUnits(snapshot)) {
            await Promise.resolve();
            count++;
            media += unit.blocks.filter(
              (block) => block.type === 'media',
            ).length;
          }
        });
        expect({ count, media, creates }).toStrictEqual({
          count: 4000,
          media: 2000,
          creates: 0,
        });
        expect(caches.length).toBeGreaterThan(0);
        for (const cache of caches)
          expect(cache.bytes).toBeLessThanOrEqual(ID_NODE_CACHE_BYTES);
      } finally {
        await snapshot.close();
      }
    } finally {
      await store.close();
    }
  }, 120000);

  it('streams 4000 native ids with bounded query caches and no operation files', async () => {
    const caches: BoundedIdNodeCache[] = [];
    const deps = storeDeps();
    const store = await JournalStore.create(`${directory()}/native.llxj`, {
      ...deps,
      idDeps: { ...deps.idDeps, occurrenceSpace: 'source' },
      planOccurrences: planSourceRowOccurrences,
      createCache: () => {
        const cache = new BoundedIdNodeCache();
        caches.push(cache);
        return cache;
      },
    });
    function* rows(): Generator<RowDraft> {
      for (let index = 0; index < 4000; index++)
        yield encodeContentRow(
          { speaker: 'ai', blocks: [call(`id-${index}`)] },
          { owner: 7 },
        );
    }
    try {
      await store.commit([{ kind: 'replace', rows: rows() }]);
      const snapshot = await store.snapshot();
      try {
        let count = 0;
        const creates = await createsDuring(async () => {
          for await (const unit of streamJournalOrphanUnits(snapshot)) {
            expect(unit.blocks.length).toBe(1);
            count++;
          }
        });
        expect({ count, creates }).toStrictEqual({ count: 8000, creates: 0 });
        expect(caches.length).toBeGreaterThan(0);
        for (const cache of caches)
          expect(cache.bytes).toBeLessThanOrEqual(ID_NODE_CACHE_BYTES);
      } finally {
        await snapshot.close();
      }
    } finally {
      await store.close();
    }
  }, 120000);
});
