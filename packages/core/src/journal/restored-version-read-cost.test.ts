/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { RECENCY_INDEX_READY } from './recencyFacts.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { testJournalSeams } from './__tests__/support/journalFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import {
  neutralRowFactKey,
  type NeutralRowFactRegistration,
} from './neutralRowFacts.js';
import { readNeutralRowFact } from './neutral-row-fact-storage.js';

describe('stored version restoration', () => {
  const directory = useTempDir('restored-version-cost-');

  it.each([512, 8192])(
    'restores %i saved neutral facts across a replacement lineage without visiting rows',
    async (size) => {
      const counter = { reads: 0 };
      let measurements = 0;
      const registration: NeutralRowFactRegistration = {
        kind: 'token-usage',
        revision: 'restore-cost',
        measure: async (snapshot, entry) => {
          measurements++;
          return snapshot.readBlock(entry, 0);
        },
      };
      const store = await JournalStore.create(
        join(directory(), `neutral-${size}.llxj`),
        {
          ...storeDeps({
            seams: testJournalSeams({ readCounter: counter }, 1, false),
          }),
          eagerNeutralRowFacts: true,
          neutralRowFacts: registration,
        },
      );
      try {
        await store.commit([
          {
            kind: 'append',
            rows: Array.from({ length: size }, (_, index) =>
              draftRow({ text: `saved-${index}` }),
            ),
          },
        ]);
        expect(measurements).toBe(size);
        const saved = store.published;
        if (saved === undefined) throw new Error('Missing saved version');
        await store.commit([
          { kind: 'replace', rows: [draftRow({ text: 'candidate' })] },
        ]);
        const beforeMeasurements = measurements;
        const beforeReads = counter.reads;
        await store.commit([{ kind: 'restore', saved }]);
        const reads = counter.reads - beforeReads;
        process.stdout.write(
          `RESTORED_NEUTRAL_COST ${JSON.stringify({ size, reads, measurements: measurements - beforeMeasurements })}\n`,
        );
        expect(measurements).toBe(size + 1);
        expect(reads).toBeLessThanOrEqual(32);
        expect(store.published?.roots.rowRoot).toBe(saved.roots.rowRoot);
        expect(store.published?.roots.idRoot).toBe(saved.roots.idRoot);
        const snapshot = await store.snapshot();
        try {
          for (const index of [0, size - 1]) {
            const entry = await snapshot.entryAt(index);
            expect(
              await readNeutralRowFact(
                snapshot.facts,
                neutralRowFactKey(registration, entry.label),
              ),
            ).toStrictEqual(new TextEncoder().encode(`saved-${index}`));
          }
        } finally {
          await snapshot.close();
        }
        await store.commit([
          { kind: 'append', rows: [draftRow({ text: 'after-restore' })] },
        ]);
        expect(measurements).toBe(size + 2);
      } finally {
        await store.close();
      }
    },
    180000,
  );

  it('refills restored facts when the measurement revision has changed', async () => {
    const file = join(directory(), 'revised-neutral.llxj');
    const original = await JournalStore.create(file, {
      ...storeDeps(),
      eagerNeutralRowFacts: true,
      neutralRowFacts: {
        kind: 'token-usage',
        revision: 'old',
        measure: async () => Uint8Array.of(1),
      },
    });
    const saved = await (async () => {
      try {
        await original.commit([
          { kind: 'append', rows: [draftRow(), draftRow()] },
        ]);
        const version = original.published;
        if (version === undefined) throw new Error('Missing saved version');
        return version;
      } finally {
        await original.close();
      }
    })();
    let measurements = 0;
    const registration: NeutralRowFactRegistration = {
      kind: 'token-usage',
      revision: 'new',
      measure: async () => {
        measurements++;
        return Uint8Array.of(2);
      },
    };
    const store = await JournalStore.open(file, {
      ...storeDeps(),
      eagerNeutralRowFacts: true,
      neutralRowFacts: registration,
    });
    try {
      await store.commit([
        { kind: 'replace', rows: [draftRow({ text: 'candidate' })] },
      ]);
      const before = measurements;
      await store.commit([{ kind: 'restore', saved }]);
      expect(measurements - before).toBe(2);
      const snapshot = await store.snapshot();
      try {
        for await (const entry of snapshot.entries())
          expect(
            await readNeutralRowFact(
              snapshot.facts,
              neutralRowFactKey(registration, entry.label),
            ),
          ).toStrictEqual(Uint8Array.of(2));
      } finally {
        await snapshot.close();
      }
    } finally {
      await store.close();
    }
  });

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
