/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { JournalFileHandle } from './positionalFile.js';
import { JournalStore } from './journalStore.js';
import {
  draftRow,
  scenarioDrafts,
  storeDeps,
  factSnapshot,
  metaSnapshot,
} from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { rowDigests } from './__tests__/support/mirrorFixtures.js';
import type { RowEntry } from './rowEntry.js';

async function summaries(
  store: JournalStore,
): Promise<Array<Omit<RowEntry, 'recordOffset' | 'recordLength'>>> {
  const out: Array<Omit<RowEntry, 'recordOffset' | 'recordLength'>> = [];
  for await (const entry of store.rows()) {
    const { recordOffset: _offset, recordLength: _length, ...rest } = entry;
    out.push(rest);
  }
  return out;
}

describe('prepared append durable parity', () => {
  const directory = useTempDir('prepared-append-parity-');
  it('releases digest readers before the store closes its descriptor', async () => {
    const deps = storeDeps();
    const handles: JournalFileHandle[] = [];
    const store = await JournalStore.create(join(directory(), 'readers.llxj'), {
      ...deps,
      journal: {
        ...deps.journal,
        open: async (file, flags) => {
          const handle = await deps.journal.open(file, flags);
          handles.push(handle);
          return handle;
        },
      },
    });
    try {
      await store.commit([{ kind: 'append', rows: scenarioDrafts() }]);
      expect(await rowDigests(store)).toHaveLength(scenarioDrafts().length);
    } finally {
      await store.close();
    }
    for (const handle of handles) {
      await expect(handle.stat()).rejects.toMatchObject({ code: 'EBADF' });
    }
  });
  it('matches batch facts and summaries across old calls, same-group responses and adopted rows after reopening', async () => {
    const files = ['batch', 'stream', 'mirror'].map((name) =>
      join(directory(), `${name}.llxj`),
    );
    const stores = await Promise.all(
      files.map((file) => JournalStore.create(file, storeDeps())),
    );
    const [batch, stream, mirror] = stores;
    const seed = draftRow({ calls: ['old'], speaker: 1 });
    const rows = [
      ...scenarioDrafts(),
      draftRow({ responses: ['old'], speaker: 2 }),
      draftRow({ calls: ['a'], speaker: 1 }),
    ];
    try {
      for (const store of [batch, stream])
        await store.commit([{ kind: 'append', rows: [seed] }]);
      await batch.commit([{ kind: 'append', rows }]);
      await stream.commit([
        {
          kind: 'prepared',
          admission: [],
          prepare: async (group) =>
            group.append(
              (async function* () {
                yield* rows;
              })(),
              [],
            ),
        },
      ]);
      const read = await stream.openRead();
      try {
        await mirror.commit([
          {
            kind: 'prepared',
            admission: [],
            prepare: async (group) =>
              group.adopt(
                (async function* () {
                  for await (const entry of stream.rows())
                    yield { source: read.access, entry };
                })(),
                stream.published?.nextLabel ?? 0n,
              ),
          },
        ]);
      } finally {
        await read.close();
      }
    } finally {
      for (const store of stores) await store.close();
    }
    const opened = await Promise.all(
      files.map((file) => JournalStore.open(file, storeDeps())),
    );
    try {
      const expectedRows = await rowDigests(opened[0]);
      const expectedSummaries = await summaries(opened[0]);
      const expectedFacts = await factSnapshot(opened[0], [
        'old',
        'a',
        'b',
        'c',
        'd',
      ]);
      const expectedMeta = await metaSnapshot(opened[0]);
      for (const store of opened.slice(1)) {
        expect(await rowDigests(store)).toStrictEqual(expectedRows);
        expect(await summaries(store)).toStrictEqual(expectedSummaries);
        expect(
          await factSnapshot(store, ['old', 'a', 'b', 'c', 'd']),
        ).toStrictEqual(expectedFacts);
        expect(await metaSnapshot(store)).toStrictEqual(expectedMeta);
      }
    } finally {
      for (const store of opened) await store.close();
    }
  });

  it('keeps the prior version readable when a streamed producer fails before its trailer', async () => {
    const file = join(directory(), 'failure.llxj');
    const store = await JournalStore.create(file, storeDeps());
    await store.commit([
      { kind: 'append', rows: [draftRow({ text: 'prior' })] },
    ]);
    const before = store.published;
    await expect(
      store.commit([
        {
          kind: 'prepared',
          admission: [],
          prepare: async (group) =>
            group.append(
              (async function* () {
                for (let index = 0; index < 200; index++)
                  yield draftRow({ calls: [`call-${index}`] });
                throw new Error('producer failed');
              })(),
              [],
            ),
        },
      ]),
    ).rejects.toThrow('producer failed');
    expect(store.published).toBe(before);
    await store.close();
    const reopened = await JournalStore.open(
      file,
      storeDeps({ seams: testJournalSeams() }),
    );
    try {
      expect(reopened.published?.rows).toBe(1);
      expect(await factSnapshot(reopened, ['call-0'])).toStrictEqual(['none']);
    } finally {
      await reopened.close();
    }
  });
});
