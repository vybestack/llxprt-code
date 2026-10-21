/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { encodeContentRow } from './journalRowCodec.js';
import { IndexedJournalRequestSnapshot } from './indexed-journal-request-snapshot.js';
import { JournalSession } from './journalSession.js';
import { measuredRequestSnapshot } from './__tests__/support/measured-request-snapshot.js';
import { call, response } from './__tests__/support/normalization-cases.js';
import type { IContent } from './IContent.js';

describe('persisted selected Mistral conversion facts', () => {
  const directory = useTempDir('mistral-selected-');
  const options = { journal: testJournalSeams({}, 1, false).dependencies };

  async function selected(session: JournalSession): Promise<void> {
    const pin = await session.store.snapshot();
    const request = await IndexedJournalRequestSnapshot.create(pin);
    try {
      await request.withMistralSelection(
        session.store,
        0,
        [2, 3],
        async (view) => {
          expect(await view.resolve('toolu_alpha-1')).toStrictEqual({
            id: '4SftZvDMX',
            salt: 0,
          });
        },
      );
    } finally {
      await request.close();
      await pin.close();
    }
  }

  it('retains filled selection facts across compaction and reopen without rescanning selected ids', async () => {
    const path = `${directory()}/reuse.llxj`;
    let session = await JournalSession.create(path, options);
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append([
        { speaker: 'ai', blocks: [call('4SftZvDMX')] },
        { speaker: 'ai', blocks: [call('toolu_alpha-1')] },
      ]);
      await selected(session);
      const clone = await session.cloneUnlinked({
        unlinkedDirectory: directory(),
      });
      try {
        await selected(clone);
        expect(clone.store.published?.commitSeq).toBe(3);
      } finally {
        await clone.close();
      }
      await session.store.compact();
      await selected(session);
      expect(session.store.published?.commitSeq).toBe(3);
      await session.close();
      session = await JournalSession.open(path, options);
      await selected(session);
      expect(session.store.published?.commitSeq).toBe(3);
    } finally {
      await session.close();
    }
  });

  it('invalidates conversion scopes when an index-preserving purge changes emitted units', async () => {
    const session = await JournalSession.create(
      `${directory()}/purge.llxj`,
      options,
    );
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append([{ speaker: 'human', blocks: [response('raw')] }]);
      const before = await session.store.snapshot();
      try {
        const entry = await before.entryAt(0);
        await session.store.commit([
          {
            kind: 'purge',
            rows: [
              {
                label: entry.label,
                draft: encodeContentRow(
                  {
                    speaker: 'human',
                    blocks: [
                      response('raw'),
                      { type: 'text', text: 'new self' },
                    ],
                  },
                  { owner: 0 },
                ),
              },
            ],
          },
        ]);
        const after = await session.store.snapshot();
        try {
          expect(await after.mistralGeneration()).not.toBe(
            await before.mistralGeneration(),
          );
        } finally {
          await after.close();
        }
      } finally {
        await before.close();
      }
    } finally {
      await session.close();
    }
  });

  it('keeps response-only historical mappings on disk and admits only selected conversion ids', async () => {
    const readCounter = { reads: 0 };
    const session = await JournalSession.create(
      `${directory()}/responses.llxj`,
      { journal: testJournalSeams({ readCounter }, 1, false).dependencies },
    );
    const rows: IContent[] = [];
    for (let index = 0; index < 2000; index++)
      rows.push(
        { speaker: 'ai', blocks: [call(`response-only-${index}`)] },
        { speaker: 'tool', blocks: [response(`response-only-${index}`)] },
      );
    try {
      await session.store.commit([{ kind: 'mistral', slot: 0 }]);
      await session.append(rows);
      const { snapshot: pin, stats } = await measuredRequestSnapshot(session);
      const request = await IndexedJournalRequestSnapshot.create(pin);
      try {
        const indices = Array.from(
          { length: 2000 },
          (_unused, index) => index * 2 + 1,
        );
        await request.withMistralSelection(
          session.store,
          0,
          indices,
          async (view) => {
            for (const index of [0, 999, 1999]) {
              const before = readCounter.reads;
              expect(
                (await view.resolve(`response-only-${index}`)).id,
              ).toHaveLength(9);
              expect(readCounter.reads - before).toBeLessThan(150);
            }
            expect(stats.heads).toBeLessThan(indices.length * 100);
            expect({
              blocks: stats.blocks,
              bodies: stats.bodies,
            }).toStrictEqual({ blocks: 0, bodies: 0 });
            await expect(view.resolve('not selected')).rejects.toThrow('scope');
          },
        );
        const filledHeads = stats.heads;
        await request.withMistralSelection(
          session.store,
          0,
          indices,
          async (view) => {
            expect((await view.resolve('response-only-1999')).salt).toBe(0);
          },
        );
        expect(session.store.published?.commitSeq).toBe(3);
        expect(stats.heads - filledHeads).toBeLessThan(120);
        await expect(
          request.withMistralSelection(
            session.store,
            0,
            [3, 2],
            () => undefined,
          ),
        ).rejects.toThrow('increasing');
      } finally {
        await request.close();
        await pin.close();
      }
    } finally {
      await session.close();
    }
  }, 120000);
});
