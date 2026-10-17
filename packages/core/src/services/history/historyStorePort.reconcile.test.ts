/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import * as path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import { createHistoryStore } from './historyBackend.js';
import type { HistoryMediaOwner } from './historyBatchContracts.js';
import type { HistoryStorePort } from './historyStorePort.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

type ReconcileStore = Pick<
  HistoryStorePort,
  'apply' | 'reconcileMedia' | 'waitForDurable' | 'dispose'
>;

function row(text: string, seq: number, ...references: MediaReferenceBlock[]) {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }, ...references],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  } satisfies IContent;
}

describe.each(['old', 'journal'] as const)(
  'HistoryStorePort.reconcileMedia (%s store)',
  (backend) => {
    const directory = useTempDir('history-port-reconcile-');
    const open: ReconcileStore[] = [];
    let mediaRoot: string;
    let media: LocalMediaStore;
    let owner: HistoryMediaOwnership;
    let a: MediaReferenceBlock;
    let b: MediaReferenceBlock;

    const admit = (byte: number): Promise<MediaReferenceBlock> =>
      media.admit({
        bytes: new Uint8Array([byte]),
        mimeType: 'application/octet-stream',
        semanticMetadata: {},
      });

    const held = (...refs: MediaReferenceBlock[]): Promise<boolean[]> =>
      Promise.all(refs.map((ref) => media.hasReservations(ref.contentId)));

    beforeEach(async () => {
      mediaRoot = await mkdtemp(path.join(tmpdir(), 'history-port-media-'));
      media = new LocalMediaStore({
        rootDirectory: mediaRoot,
        quotaBytes: 4096,
      });
      owner = new HistoryMediaOwnership(media);
      a = await admit(1);
      b = await admit(2);
    });

    afterEach(async () => {
      for (const store of open.splice(0)) await store.dispose();
      await owner.releaseAll();
      await media.close();
      await rm(mediaRoot, { recursive: true, force: true });
    });

    async function opened(): Promise<ReconcileStore> {
      const store: ReconcileStore =
        backend === 'old'
          ? createHistoryStore({}, 'old')
          : new JournalHistoryStore(
              await JournalSession.create(
                path.join(directory(), 'reconcile.llxj'),
                { journal: testJournalSeams({}).dependencies },
              ),
            );
      open.push(store);
      return store;
    }

    it('reserves the media of rows the owner does not hold yet', async () => {
      const store = await opened();
      store.apply({ kind: 'content', content: row('one', 1, a) });
      store.apply({ kind: 'content', content: row('two', 2, a, b) });
      await store.waitForDurable();
      expect(await held(a, b)).toStrictEqual([false, false]);
      await store.reconcileMedia(owner);
      expect(await held(a, b)).toStrictEqual([true, true]);
    });

    it('releases the media of rows that are gone', async () => {
      const store = await opened();
      store.apply({ kind: 'content', content: row('one', 1, a) });
      store.apply({ kind: 'content', content: row('two', 2, b) });
      await store.waitForDurable();
      await store.reconcileMedia(owner);
      store.apply({ kind: 'rewind', itemsRemoved: 1 });
      await store.waitForDurable();
      await store.reconcileMedia(owner);
      expect(await held(a, b)).toStrictEqual([true, false]);
    });

    it('rolls the owner back and reports the failure when the publication fails', async () => {
      const store = await opened();
      store.apply({ kind: 'content', content: row('one', 1, a) });
      await store.waitForDurable();
      const boom = new Error('reservation failed');
      const failing: HistoryMediaOwner = {
        prepareReplacement: (input) => owner.prepareReplacement(input),
        prepareReferenceReplacement: (references, own) => {
          const effect = owner.prepareReferenceReplacement(references, own);
          return { ...effect, publish: () => Promise.reject(boom) };
        },
        // The old store reconciles through `reconcile`, the journal store through the reference replacement.
        reconcile: () => Promise.reject(boom),
        releaseAll: () => owner.releaseAll(),
        adopt: (contents) => owner.adopt(contents),
      };
      await expect(store.reconcileMedia(failing)).rejects.toBe(boom);
      expect(await held(a)).toStrictEqual([false]);
      // The owner is settled again, so the next reconcile works.
      await store.reconcileMedia(owner);
      expect(await held(a)).toStrictEqual([true]);
    });
  },
);
