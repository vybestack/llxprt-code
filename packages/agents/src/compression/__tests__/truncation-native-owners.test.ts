/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { openOwnedJournal } from '@vybestack/llxprt-code-core/services/history/journalOwnedFixture.js';
import { useTempDir } from '../../../../core/src/journal/__tests__/support/useTempDir.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { OwnerDictionary } from '@vybestack/llxprt-code-core/journal/ownerDictionary.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { journalBackedHistory } from './support/journal-detached-history.js';
import { operationFileCreates } from './support/operation-file-creates.js';
import { publishCandidate } from '../diskTruncation.js';

function source(index: number): IContent {
  return {
    speaker: index === 1 ? 'ai' : 'human',
    blocks: index === 1 ? [] : [{ type: 'text', text: `original ${index}` }],
    metadata: {
      chronology: { seq: (index % 5) + 1, userTurn: 1, step: 0, recordedAt: 0 },
    },
  };
}

describe('native truncation source ownership', () => {
  const directory = useTempDir('native-truncation-owners-');
  it.each([3, 64, 65, 5000])(
    'retains original owners and distinct repeated-sequence rows across the raw ordinal hole at %i rows',
    async (size) => {
      const owned = await openOwnedJournal(
        join(directory(), 'owners.llxj'),
        Array.from({ length: size }, (_, index) => ({
          content: source(index),
          origin: index % 2 === 0 ? 'owner-a' : 'owner-b',
        })),
      );
      const history = journalBackedHistory(owned);
      try {
        await history.detachedValues.withCheckpoint(async (checkpoint) => {
          if (
            !('compressionInput' in checkpoint) ||
            checkpoint.compressionInput === undefined
          )
            throw new Error('Expected native pinned compression input');
          const input = checkpoint.compressionInput;
          expect(await input.rows.sourceOrdinalAt(1)).toBe(2);
          const creates = await operationFileCreates(async () => {
            await publishCandidate(
              history,
              input.previous,
              input.rows,
              1,
              'test',
              0,
              {},
              (position) => input.rows.sourceOrdinalAt(position),
            );
          }, true);
          expect(creates).toStrictEqual({ directories: [], files: [] });
        });
        const expected = Array.from({ length: size - 2 }, (_, offset) =>
          (offset + 2) % 2 === 0 ? 'owner-a' : 'owner-b',
        );
        expect(await owned.originsOfRows()).toStrictEqual(expected);
        const reopened = await JournalSession.open(owned.session.path);
        try {
          const dictionary = await OwnerDictionary.load(reopened.store);
          const actual: Array<string | undefined> = [];
          const labels: bigint[] = [];
          for await (const { entry } of reopened.rows()) {
            actual.push(dictionary.originOf(entry.owner));
            labels.push(entry.label);
          }
          expect(actual).toStrictEqual(expected);
          expect(new Set(labels).size).toBe(size - 2);
        } finally {
          await reopened.close();
        }
      } finally {
        await owned.dispose();
      }
    },
    180_000,
  );
});
