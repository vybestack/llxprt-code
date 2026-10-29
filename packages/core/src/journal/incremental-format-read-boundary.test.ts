/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { identitySlotSummary } from './summaryComposition.js';
import type { RowFormatRegistration } from './rowFormat.js';

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
  measure: async () => ({
    summary: identitySlotSummary('chat'),
    lens: new Uint8Array(136),
  }),
};

describe('incremental format read boundary', () => {
  const directory = useTempDir('incremental-format-boundary-');
  it('reads drained tree nodes while lens records remain buffered', async () => {
    const store = await JournalStore.create(
      join(directory(), 'history.llxj'),
      storeDeps(),
    );
    try {
      await store.commit([
        {
          kind: 'replace',
          rows: Array.from({ length: 8 }, (_, index) =>
            draftRow({ text: `row ${index}` }),
          ),
        },
      ]);
      await store.commit([{ kind: 'format', registration }]);
      await store.commit([
        {
          kind: 'prepared',
          admission: [],
          prepare: async (group) =>
            group.append(
              (async function* () {
                for (let index = 0; index < 9; index++)
                  yield draftRow({ text: `next ${index}` });
              })(),
              [],
            ),
        },
      ]);
      expect(store.published?.rows).toBe(17);
      expect(store.published?.aggregate.missingBase[0]).toBe(0);
      let count = 0;
      for await (const entry of store.rows()) {
        expect(entry.lensRef[0]).toBeGreaterThan(0);
        count++;
      }
      expect(count).toBe(17);
    } finally {
      await store.close();
    }
  });
});
