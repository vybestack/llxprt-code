/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import type { DetachedHistoryTransform } from './detachedHistoryMutation.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import { openOwnedJournal, type OwnedJournal } from './journalOwnedFixture.js';

const now = (execute: () => Promise<void>): Promise<void> => execute();

describe('detached publication and media ownership on the journal', () => {
  const directory = useTempDir('journal-detached-media-');
  let mediaRoot: string;
  let media: LocalMediaStore;
  let owner: HistoryMediaOwnership;
  let ownership: RowOwnership;
  let a: MediaReferenceBlock;
  let b: MediaReferenceBlock;
  let c: MediaReferenceBlock;

  const rowOf = (...blocks: MediaReferenceBlock[]): IContent => ({
    speaker: 'human',
    blocks,
  });

  async function admit(byte: number): Promise<MediaReferenceBlock> {
    return media.admit({
      bytes: new Uint8Array([byte]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
  }

  /** A journal whose only row references `a`, which the media owner holds. */
  async function openWithA(
    name: string,
    mediaOwner: HistoryMediaOwner = owner,
  ): Promise<OwnedJournal> {
    const journal = await openOwnedJournal(
      path.join(directory(), name),
      [{ content: rowOf(a) }],
      { mediaOwner, ownership },
    );
    await owner.reconcile([], () => [rowOf(a)]);
    return journal;
  }

  beforeEach(async () => {
    mediaRoot = await mkdtemp(path.join(tmpdir(), 'journal-media-store-'));
    media = new LocalMediaStore({ rootDirectory: mediaRoot, quotaBytes: 4096 });
    owner = new HistoryMediaOwnership(media);
    ownership = new RowOwnership();
    a = await admit(1);
    b = await admit(2);
    c = await admit(3);
  });

  afterEach(async () => {
    await owner.releaseAll();
    await media.close();
    await rm(mediaRoot, { recursive: true, force: true });
  });

  const held = async (...refs: MediaReferenceBlock[]) =>
    Promise.all(refs.map((ref) => media.hasReservations(ref.contentId)));

  describe('append mode', () => {
    const appendB: DetachedHistoryTransform = async (_source, sink) => {
      await sink.appendValue(rowOf(b));
    };

    it('reserves the media of the appended rows and keeps the media already held', async () => {
      const journal = await openWithA('append.llxj');
      try {
        await journal.store.publishDetached(
          { transform: appendB, append: true },
          journal.host,
          undefined,
          {},
        );
        expect(journal.store.getLength()).toBe(2);
        expect(await held(a, b)).toStrictEqual([true, true]);
      } finally {
        await journal.dispose();
      }
    });

    it('releases the media of an appended row when the transform fails after it', async () => {
      const journal = await openWithA('append-fail.llxj');
      try {
        const boom = new Error('transform failed after the append');
        const failing: DetachedHistoryTransform = async (source, sink) => {
          await appendB(source, sink);
          throw boom;
        };
        await expect(
          journal.store.publishDetached(
            { transform: failing, append: true },
            journal.host,
            undefined,
            {},
          ),
        ).rejects.toBe(boom);
        expect(journal.store.getLength()).toBe(1);
        expect(await held(a, b)).toStrictEqual([true, false]);
      } finally {
        await journal.dispose();
      }
    });

    it('does not release media the history already held when an append that repeats it fails', async () => {
      const journal = await openWithA('append-repeat.llxj');
      try {
        const boom = new Error('transform failed after repeating a held row');
        const failing: DetachedHistoryTransform = async (_source, sink) => {
          await sink.appendValue(rowOf(a));
          await sink.appendValue(rowOf(b));
          throw boom;
        };
        await expect(
          journal.store.publishDetached(
            { transform: failing, append: true },
            journal.host,
            undefined,
            {},
          ),
        ).rejects.toBe(boom);
        expect(await held(a, b)).toStrictEqual([true, false]);
      } finally {
        await journal.dispose();
      }
    });

    it('takes the appended row and its media back when a hook fails after the ack', async () => {
      const journal = await openWithA('append-hook.llxj');
      try {
        const boom = new Error('hook failed after the ack');
        await expect(
          journal.store.publishDetached(
            { transform: appendB, append: true },
            journal.host,
            undefined,
            {
              afterPublication: () => {
                throw boom;
              },
            },
          ),
        ).rejects.toBe(boom);
        expect(await journal.store.materialize()).toHaveLength(1);
        expect(await held(a, b)).toStrictEqual([true, false]);
      } finally {
        await journal.dispose();
      }
    });
  });

  describe('rollback checkpoint', () => {
    const compressToC: DetachedHistoryTransform = async (_source, sink) => {
      await sink.appendValue(rowOf(c));
    };

    it('re-adopts the media of the restored rows and releases the media of the rows it removes', async () => {
      const journal = await openWithA('rollback.llxj');
      try {
        await journal.store.withRollbackCheckpoint(
          journal.host,
          now,
          async (restore) => {
            await journal.store.publishDetached(
              { transform: compressToC },
              journal.host,
              undefined,
              {},
            );
            expect(await held(a, c)).toStrictEqual([false, true]);

            await restore();

            expect(journal.store.getLength()).toBe(1);
            expect(await held(a, c)).toStrictEqual([true, false]);
          },
        );
      } finally {
        await journal.dispose();
      }
    });

    it('leaves the compressed rows and their media in place when the media of the restore cannot be taken', async () => {
      const boom = new Error('reserving the restored media failed');
      let prepared = 0;
      const failingSecond: HistoryMediaOwner = {
        prepareReferenceReplacement: (references, own) => {
          const effect = owner.prepareReferenceReplacement(references, own);
          if (++prepared < 2) return effect;
          return {
            publish: async () => {
              await effect.publish();
              throw boom;
            },
            rollback: () => effect.rollback(),
            finalize: () => effect.finalize?.(),
          };
        },
        prepareReplacement: (input) => owner.prepareReplacement(input),
        reconcile: (previous, next) => owner.reconcile(previous, next),
        releaseAll: () => owner.releaseAll(),
        adopt: (contents) => owner.adopt(contents),
      };
      const journal = await openWithA('rollback-fail.llxj', failingSecond);
      try {
        await journal.store.withRollbackCheckpoint(
          journal.host,
          now,
          async (restore) => {
            await journal.store.publishDetached(
              { transform: compressToC },
              journal.host,
              undefined,
              {},
            );
            await expect(restore()).rejects.toBe(boom);
            expect(journal.store.getLength()).toBe(1);
            expect(await journal.store.materialize()).toStrictEqual([
              expect.objectContaining({ blocks: [c] }),
            ]);
            expect(await held(a, c)).toStrictEqual([false, true]);
          },
        );
      } finally {
        await journal.dispose();
      }
    });
  });
});
