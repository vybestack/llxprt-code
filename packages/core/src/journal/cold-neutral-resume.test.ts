/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import {
  neutralRowFactKey,
  type NeutralRowFactRegistration,
} from './neutralRowFacts.js';
import { readNeutralRowFact } from './neutral-row-fact-storage.js';

describe('cold neutral fact resume', () => {
  const directory = useTempDir('cold-neutral-resume-');
  it.each([16, 128])(
    'measures only three appended rows after %i stored token facts',
    async (size) => {
      let reads = 0;
      const registration: NeutralRowFactRegistration = {
        kind: 'token-usage',
        revision: 'resume',
        measure: async (snapshot, entry) => {
          reads++;
          return snapshot.readBlock(entry, 0);
        },
      };
      const path = join(directory(), `resume-${size}.llxj`);
      const rows = Array.from({ length: size + 3 }, (_, index) =>
        draftRow({ text: `row ${index}` }),
      );
      const original = await JournalStore.create(path, {
        ...storeDeps(),
        neutralRowFacts: registration,
        eagerNeutralRowFacts: true,
      });
      try {
        await original.commit([{ kind: 'append', rows: rows.slice(0, size) }]);
      } finally {
        await original.close();
      }
      const resumed = await JournalStore.open(path, storeDeps());
      try {
        await resumed.commit([{ kind: 'append', rows: rows.slice(size) }]);
      } finally {
        await resumed.close();
      }
      const attached = await JournalStore.open(path, {
        ...storeDeps(),
        neutralRowFacts: registration,
        eagerNeutralRowFacts: true,
      });
      try {
        reads = 0;
        await attached.commit([{ kind: 'append', rows: [] }]);
        expect(reads).toBe(3);
        const snapshot = await attached.snapshot();
        try {
          let index = 0;
          for await (const entry of snapshot.entries()) {
            expect(
              await readNeutralRowFact(
                snapshot.facts,
                neutralRowFactKey(registration, entry.label),
              ),
            ).toStrictEqual(rows[index++].blocks[0].bytes);
          }
          expect(index).toBe(rows.length);
        } finally {
          await snapshot.close();
        }
      } finally {
        await attached.close();
      }
    },
  );
});
