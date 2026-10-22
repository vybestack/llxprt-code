/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { JournalStore } from '../../journal/journalStore.js';
import { rowAlgebra } from '../../journal/rowAlgebra.js';
import { sha256KeyHash } from '../../journal/idKeys.js';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { planSourceRowOccurrences } from './source-fact-planner.js';
import { encodeContentRow } from './journalRowCodec.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { call } from './__tests__/support/normalization-cases.js';
import type { IContent } from './IContent.js';

function candidate(_id: string, salt: number): string {
  return salt.toString(36).padStart(9, '0');
}

async function collectLabels(labels: AsyncIterable<bigint>): Promise<bigint[]> {
  const collected: bigint[] = [];
  for await (const label of labels) collected.push(label);
  return collected;
}

describe('Mistral historical collision cascades', () => {
  const directory = useTempDir('mistral-cascade-');
  it.each([2, 129])(
    'walks %s changed historical IDs from one pending identity without replay',
    async (count) => {
      const store = await JournalStore.create(`${directory()}/cascade.llxj`, {
        journal: testJournalSeams({}, 1, false).dependencies,
        idDeps: {
          hasher: sha256KeyHash,
          occurrenceSpace: 'source-with-normalized',
          normalizers: { openai: (id) => id, anthropic: (id) => id },
          mistralCandidate: candidate,
        },
        planOccurrences: planSourceRowOccurrences,
        algebra: rowAlgebra,
      });
      const ids = Array.from(
        { length: count },
        (_, index) => `historical-raw-${index}`,
      );
      const rows: readonly IContent[] = [
        { speaker: 'ai', blocks: [call('pending-seed', '')] },
        ...ids.map((id): IContent => ({ speaker: 'ai', blocks: [call(id)] })),
        { speaker: 'ai', blocks: ids.map((id) => call(id)) },
      ];
      try {
        await store.commit([
          {
            kind: 'append',
            rows: rows.map((row) => encodeContentRow(row, { owner: 0 })),
          },
        ]);
        await store.commit([{ kind: 'mistral', slot: 0 }]);
        const pin = await store.snapshot();
        const entries = await Array.fromAsync(pin.entries());
        const request = await IndexedJournalRequestSnapshot.create(
          pin,
          [{ speaker: 'ai', blocks: [call('pending-seed')] }],
          {
            label: entries[0].label,
            readChangedRow: async () => ({
              speaker: 'ai',
              blocks: [
                call('pending-seed', ''),
                { type: 'text', text: 'curated seed' },
              ],
            }),
            header: (row) => row,
          },
        );
        try {
          const resolver = await request.mistralForSnapshot(pin, 0);
          const publishedBefore = store.published;
          if (publishedBefore === undefined)
            throw new Error('Missing published cascade history');
          const before = pin.facts.lookups;
          const occurrence = pin.facts.occurrence.bind(pin.facts);
          let occurrenceReads = 0;
          pin.facts.occurrence = async (id, kind, ordinal) => {
            occurrenceReads++;
            return occurrence(id, kind, ordinal);
          };
          let labels: readonly bigint[];
          try {
            labels = await collectLabels(resolver.affectedSources());
          } finally {
            pin.facts.occurrence = occurrence;
          }
          const queries = pin.facts.lookups - before;
          const publishedAfter = store.published;
          if (publishedAfter === undefined)
            throw new Error('Lost published cascade history');
          const persistentBytes =
            publishedAfter.durableEnd - publishedBefore.durableEnd;
          expect(publishedAfter.roots).toStrictEqual(publishedBefore.roots);
          expect(publishedAfter.aggregate).toStrictEqual(
            publishedBefore.aggregate,
          );
          expect(Math.sign(persistentBytes)).toBe(count === 129 ? 1 : 0);
          if (process.env.MISTRAL_CASCADE_RECEIPT !== undefined)
            appendFileSync(
              process.env.MISTRAL_CASCADE_RECEIPT,
              JSON.stringify({
                count,
                occurrenceReads,
                queries,
                persistentBytes,
              }) + String.fromCharCode(10),
            );
          expect(occurrenceReads).toBe(count * 2);
          expect(labels).toStrictEqual(
            entries.slice(1).map((entry) => entry.label),
          );
          expect(queries).toBeLessThanOrEqual(
            count * count * 3 + count * 20 + 30,
          );
          for (const [index, id] of ids.entries()) {
            expect(await pin.mistralMapping(id, 0)).toStrictEqual({
              id: candidate(id, index),
              salt: index,
            });
            expect(await resolver.resolve(id)).toStrictEqual({
              id: candidate(id, index + 1),
              salt: index + 1,
            });
          }
        } finally {
          await request.close();
          await pin.close();
        }
      } finally {
        await store.close();
      }
    },
  );
});
