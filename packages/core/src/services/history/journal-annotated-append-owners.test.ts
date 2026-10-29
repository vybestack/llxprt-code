/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { openOwnedJournal } from './journalOwnedFixture.js';
import { historyOriginId } from './historyOriginId.js';
import { MUTATION } from '../../journal/recordKinds.js';
import { decodeStoredRow } from './journalRowCodec.js';
import type { VersionSnapshot } from '../../journal/versionSnapshot.js';
import type { IContent } from './IContent.js';

async function assertCopiedOwners(
  current: VersionSnapshot,
  prior: VersionSnapshot,
  size: number,
): Promise<void> {
  for (let index = 0; index < size; index++) {
    expect(await current.entryAt(index)).toStrictEqual(
      await prior.entryAt(index),
    );
    expect((await current.entryAt(size + 1 + index)).owner).toBe(
      (await prior.entryAt(index)).owner,
    );
  }
}

function row(index: number): IContent {
  return {
    speaker: index % 2 === 0 ? 'human' : 'ai',
    blocks: [{ type: 'text', text: `annotated ${index}` }],
    metadata: {
      chronology: {
        seq: index * 4,
        userTurn: index + 1,
        step: 1,
        recordedAt: 0,
      },
    },
  };
}

describe('native annotated append current source ownership', () => {
  const directory = useTempDir('annotated-append-owner-');
  it.each([3, 64, 65, 5000])(
    'preserves labels and current source owners after a prefix cut and %i annotated derived appends',
    async (size) => {
      const owners = ['a', 'b', undefined];
      const journal = await openOwnedJournal(
        join(directory(), 'owners.llxj'),
        Array.from({ length: size + 2 }, (_, index) => ({
          content: row(index),
          origin: owners[index % owners.length],
        })),
      );
      const origin = {};
      try {
        await journal.store.publishDetached(
          {
            transform: async (source, sink) => {
              let ordinal = 0;
              for await (const content of source.streamRows()) {
                if (ordinal < size) await sink.appendDerived(ordinal, content);
                ordinal++;
              }
            },
          },
          journal.host,
          undefined,
          {},
        );
        const prior = await journal.session.store.snapshot();
        try {
          await journal.store.publishDetached(
            {
              append: true,
              transform: async (source, sink) => {
                await sink.removeValue(0);
                await sink.appendValue(row(size + 9));
                let ordinal = 0;
                for await (const content of source.streamRows())
                  await sink.appendDerived(ordinal++, { ...content });
              },
            },
            journal.host,
            undefined,
            { origin },
          );
          const current = await journal.session.store.snapshot();
          try {
            expect(current.rows).toBe(size * 2 + 1);
            expect(current.version?.mutation).toBe(MUTATION.append);
            expect(current.version?.roots.rowRoot).not.toBe(
              prior.version?.roots.rowRoot,
            );
            await assertCopiedOwners(current, prior, size);
            expect(await journal.originsOfRows()).toStrictEqual([
              ...Array.from(
                { length: size },
                (_, index) => owners[index % owners.length],
              ),
              historyOriginId(origin),
              ...Array.from(
                { length: size },
                (_, index) => owners[index % owners.length],
              ),
            ]);
            expect(
              decodeStoredRow(await prior.readRow(await prior.entryAt(0)))
                .blocks,
            ).toStrictEqual(row(0).blocks);
          } finally {
            await current.close();
          }
        } finally {
          await prior.close();
        }
      } finally {
        await journal.dispose();
      }
    },
    180_000,
  );
});
