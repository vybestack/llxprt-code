/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { IdFactBatch } from './idFactBatch.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { JOURNAL_HEADER_BYTES } from './fileHeader.js';
import { RECORD_KIND } from './recordKinds.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { identitySlotSummary } from './summaryComposition.js';
import type { RowFormatRegistration } from './rowFormat.js';

async function nodeCounts(
  file: string,
): Promise<{ rows: number; tries: number; trailers: number }> {
  const bytes = await readFile(file);
  let rows = 0;
  let tries = 0;
  let trailers = 0;
  for (let offset = JOURNAL_HEADER_BYTES; offset < bytes.length; ) {
    const kind = bytes[offset];
    if (kind === RECORD_KIND.RTNODE) rows++;
    if (kind === RECORD_KIND.ITNODE) tries++;
    if (kind === RECORD_KIND.TRAILER) trailers++;
    offset +=
      24 +
      bytes.readUInt32LE(offset + 4) +
      Number(bytes.readBigUInt64LE(offset + 8));
  }
  return { rows, tries, trailers };
}

describe('prepared append group write cost', () => {
  const directory = useTempDir('prepared-append-cost-');
  it('finalizes the fact index once for a group extending existing rows', async () => {
    const store = await JournalStore.create(
      join(directory(), 'finalize.llxj'),
      storeDeps(),
    );
    await store.commit([{ kind: 'append', rows: [draftRow()] }]);
    const finalizes = spyOn(IdFactBatch.prototype, 'commit');
    try {
      await store.commit([
        {
          kind: 'prepared',
          admission: [],
          prepare: async (group) =>
            group.append(
              (async function* () {
                for (let index = 0; index < 128; index++)
                  yield draftRow({ text: `added ${index}` });
              })(),
              [],
            ),
        },
      ]);
      expect(store.published?.rows).toBe(129);
      expect(finalizes.mock.calls.length).toBe(1);
    } finally {
      finalizes.mockRestore();
      await store.close();
    }
  });
  it('shares changed paths while filling an active format for a streamed group', async () => {
    const file = join(directory(), 'active-format.llxj');
    const store = await JournalStore.create(file, storeDeps());
    const registration: RowFormatRegistration = {
      settings: {
        formatId: 'openai-chat:plain',
        formatRev: 1,
        model: 'test',
        endpoint: '',
        isOAuth: false,
        toolNameTransform: 'none',
        supportsUrlImages: false,
        reasoningEnabled: false,
        reasoningFieldName: '',
        mediaPdfEnabled: false,
        unsupportedMedia: 'notice',
        outputLimits: null,
      },
      incremental: 'append',
      measure: async (_snapshot, entry) => ({
        summary: identitySlotSummary('chat'),
        lens: new TextEncoder().encode(String(entry.label)),
      }),
    };
    try {
      await store.commit([{ kind: 'format', registration }]);
      await store.commit([
        {
          kind: 'prepared',
          admission: [],
          prepare: async (group) =>
            group.append(
              (async function* () {
                for (let index = 0; index < 1024; index++)
                  yield draftRow({ text: `row ${index}` });
              })(),
              [],
            ),
        },
      ]);
      expect((await nodeCounts(file)).rows).toBeLessThanOrEqual(524);
      expect(store.published?.aggregate.missingBase[0]).toBe(0);
      for await (const entry of store.rows())
        expect(entry.lensRef[0]).toBeGreaterThan(0);
    } finally {
      await store.close();
    }
  });
  it.each([1024, 4096, 8192])(
    'shares row-tree paths for %i streamed rows',
    async (count) => {
      const file = join(directory(), `${count}.llxj`);
      const store = await JournalStore.create(file, storeDeps());
      try {
        await store.commit([
          {
            kind: 'prepared',
            admission: [],
            prepare: async (group) => {
              await group.append(
                (async function* () {
                  for (let index = 0; index < count; index++)
                    yield draftRow({
                      text: `row ${index}`,
                      chronologySeq: BigInt(index),
                    });
                })(),
                [],
              );
            },
          },
        ]);
        const counts = await nodeCounts(file);
        expect(store.published?.rows).toBe(count);
        expect(counts.trailers).toBe(1);
        expect(counts.rows).toBeLessThanOrEqual(Math.ceil(count / 3) + 12);
      } finally {
        await store.close();
      }
    },
  );
});
