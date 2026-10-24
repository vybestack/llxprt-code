/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { JournalStore } from './journalStore.js';
import { draftRow, storeDeps } from './__tests__/support/storeFixtures.js';
import { useTempDir } from './__tests__/support/useTempDir.js';
import { identitySlotSummary } from './summaryComposition.js';
import type { RowFormatRegistration } from './rowFormat.js';
import { hasNativeRequestFormat } from '../services/history/native-provider-format.js';

async function storedFacts(store: JournalStore): Promise<Uint8Array[]> {
  const read = await store.openRead();
  const facts: Uint8Array[] = [];
  try {
    for await (const entry of store.rows()) {
      facts.push(entry.summary[0]);
      const head = await read.access.readRecordHead(entry.lensRef[0]);
      const chunks: Uint8Array[] = [];
      for await (const chunk of read.access.readRecordBody(head))
        chunks.push(chunk);
      facts.push(Buffer.concat(chunks));
    }
    return facts;
  } finally {
    await read.close();
  }
}

const settings: RowFormatRegistration['settings'] = {
  formatId: 'openai-chat:plain',
  formatRev: 1,
  model: 'resume',
  endpoint: '',
  isOAuth: false,
  toolNameTransform: 'none',
  supportsUrlImages: false,
  reasoningEnabled: false,
  reasoningFieldName: '',
  mediaPdfEnabled: false,
  unsupportedMedia: 'notice',
  outputLimits: null,
};

describe('cold resume format cache', () => {
  const directory = useTempDir('cold-resume-format-');
  it.each([16, 128])(
    'fills only appended rows after reopening %i measured rows',
    async (size) => {
      let reads = 0;
      const registration: RowFormatRegistration = {
        settings,
        incremental: 'append',
        measure: async (snapshot, entry) => {
          const bytes = await snapshot.readBlock(entry, 0);
          reads++;
          const summary = identitySlotSummary('chat');
          if (summary.kind !== 'chat') throw new Error('Expected chat summary');
          const variant = {
            ...summary.variants[0],
            bytes: summary.variants[0].bytes.map(() => bytes.length),
            count: summary.variants[0].count.map(() => 1),
          };
          return {
            summary: { ...summary, variants: [variant, variant] },
            lens: bytes,
          };
        },
      };
      const path = join(directory(), `resume-${size}.llxj`);
      const rows = Array.from({ length: size + 3 }, (_, index) =>
        draftRow({ text: `row ${index}` }),
      );
      const original = await JournalStore.create(path, storeDeps());
      try {
        await original.commit([{ kind: 'replace', rows: rows.slice(0, size) }]);
        await original.commit([{ kind: 'format', registration }]);
      } finally {
        await original.close();
      }
      const resumed = await JournalStore.open(path, storeDeps());
      const cold = await JournalStore.create(
        join(directory(), `cold-${size}.llxj`),
        storeDeps(),
      );
      try {
        reads = 0;
        await resumed.commit([{ kind: 'append', rows: rows.slice(size) }]);
        expect(reads).toBe(0);
        const pending = await resumed.snapshot();
        try {
          expect(hasNativeRequestFormat(pending, registration)).toBe(false);
          expect(pending.version?.slots.formatSlots[0].filledThrough).toBe(2);
          await expect(
            pending.formatSummaryRange(0, 0n, pending.version?.nextLabel ?? 0n),
          ).rejects.toThrow('stale');
        } finally {
          await pending.close();
        }
        await resumed.commit([{ kind: 'format', registration }]);
        expect(reads).toBe(3);
        expect(resumed.published?.slots.formatSlots[0].filledThrough).toBe(
          resumed.published?.commitSeq,
        );
        await cold.commit([{ kind: 'replace', rows }]);
        await cold.commit([{ kind: 'format', registration }]);
        expect(resumed.published?.aggregate.summaries[0]).toStrictEqual(
          cold.published?.aggregate.summaries[0],
        );
        expect(await storedFacts(resumed)).toStrictEqual(
          await storedFacts(cold),
        );
      } finally {
        await resumed.close();
        await cold.close();
      }
    },
  );
  it('keeps complete live caches current when an older pin receives a format fill', async () => {
    const store = await JournalStore.create(
      join(directory(), 'pinned.llxj'),
      storeDeps(),
    );
    const registration: RowFormatRegistration = {
      settings,
      measure: async () => ({
        summary: identitySlotSummary('chat'),
        lens: new Uint8Array(0),
      }),
    };
    try {
      await store.commit([{ kind: 'append', rows: [draftRow()] }]);
      const before = await store.snapshot();
      try {
        await store.commit([{ kind: 'format', registration }]);
        const filled = await store.prepareSnapshotFormat(before, registration);
        await filled.close();
        const current = await store.snapshot();
        try {
          expect(hasNativeRequestFormat(current, registration)).toBe(true);
        } finally {
          await current.close();
        }
      } finally {
        await before.close();
      }
    } finally {
      await store.close();
    }
  });
});
