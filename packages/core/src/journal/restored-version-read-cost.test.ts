/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { RECENCY_INDEX_READY } from './recencyFacts.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';

describe('stored version restoration', () => {
  const directory = useTempDir('restored-version-cost-');

  it.each([512, 8192])(
    'restores %i rows without deriving a newly configured fact index',
    async (size) => {
      const file = join(directory(), `restore-${size}.llxj`);
      const initial = await JournalStore.create(file, storeDeps());
      const saved = await (async () => {
        try {
          await initial.commit([
            {
              kind: 'replace',
              rows: Array.from({ length: size }, (_, index) =>
                draftRow({
                  text: `stored-${index}`,
                  calls: index % 128 === 0 ? [`call-${index}`] : [],
                }),
              ),
            },
          ]);
          const version = initial.published;
          if (version === undefined) throw new Error('Missing saved version');
          await initial.commit([
            { kind: 'setState', key: 'title', value: Uint8Array.of(7) },
          ]);
          return version;
        } finally {
          await initial.close();
        }
      })();
      const counter = { reads: 0 };
      const store = await JournalStore.open(file, {
        ...storeDeps({
          seams: testJournalSeams({ readCounter: counter }, 1, false),
        }),
        recencyFactPolicy: {
          revision: 'new-recency-policy',
          bucket: () => undefined,
        },
      });
      try {
        const currentStateRoot = store.published?.roots.stateRoot;
        if (currentStateRoot === undefined)
          throw new Error('Missing current state root');
        const readsBefore = counter.reads;
        await store.commit([{ kind: 'restore', saved }]);
        const reads = counter.reads - readsBefore;
        process.stdout.write(
          `RESTORED_VERSION_COST ${JSON.stringify({ size, reads })}\n`,
        );
        expect(reads).toBeLessThanOrEqual(32);
        expect(store.published?.roots).toStrictEqual({
          ...saved.roots,
          stateRoot: currentStateRoot,
        });
        expect(store.published?.aggregate).toStrictEqual(saved.aggregate);
        expect(await store.getMeta(RECENCY_INDEX_READY)).toBeUndefined();
        expect(await store.getState('title')).toStrictEqual(Uint8Array.of(7));
      } finally {
        await store.close();
      }
    },
    180000,
  );
});
