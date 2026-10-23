import { HistoryJournalStore } from './historyJournalStore.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { testJournalSeams } from '../../journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { RowOwnership } from '../../recording/rowOwnership.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';
import type {
  HistoryMediaOwner,
  PreparedHistoryBatchEffect,
} from './historyBatchContracts.js';
import { RemovalObserverFailure } from './historyRemovalObserverFailure.js';
import type { HistoryStorePort } from './historyStorePort.js';
import type { IContent, MediaReferenceBlock } from './IContent.js';
import { JournalHistoryStore } from './journalHistoryStore.js';
import { JournalSession } from './journalSession.js';

/** What both stores serve for a tail removal; the journal store does not implement the whole port until W6. */
type RemovalStore = Pick<
  HistoryStorePort,
  | 'apply'
  | 'removeTail'
  | 'getLength'
  | 'streamRows'
  | 'waitForDurable'
  | 'dispose'
>;

function row(
  speaker: 'human' | 'ai',
  text: string,
  seq: number,
  ...references: MediaReferenceBlock[]
): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }, ...references],
    metadata: { chronology: { seq, userTurn: 1, step: seq, recordedAt: 1 } },
  };
}

function textsOf(rows: readonly IContent[]): string[] {
  return rows.map((content) => {
    const [first] = content.blocks;
    return first.type === 'text' ? first.text : first.type;
  });
}

async function rowsOf(store: RemovalStore): Promise<IContent[]> {
  const rows: IContent[] = [];
  for await (const content of store.streamRows()) rows.push(content);
  return rows;
}

/** A media owner whose effects publish and then fail, so the removal has to be taken back. */
function failingOwner(
  owner: HistoryMediaOwnership,
  failure: Error,
): HistoryMediaOwner {
  const failing = (
    effect: PreparedHistoryBatchEffect,
  ): PreparedHistoryBatchEffect => ({
    ...effect,
    publish: () => Promise.reject(failure),
  });
  return {
    prepareReplacement: (input) => failing(owner.prepareReplacement(input)),
    prepareReferenceReplacement: (references, own) =>
      failing(owner.prepareReferenceReplacement(references, own)),
    reconcile: (previous, next) => owner.reconcile(previous, next),
    releaseAll: () => owner.releaseAll(),
    adopt: (contents) => owner.adopt(contents),
  };
}

describe.each(['old', 'journal'] as const)(
  'HistoryStorePort.removeTail (%s store)',
  (backend) => {
    const directory = useTempDir('history-port-remove-tail-');
    const open: RemovalStore[] = [];
    let mediaRoot: string;
    let media: LocalMediaStore;
    let owner: HistoryMediaOwnership;
    let ownership: RowOwnership;
    let shared: MediaReferenceBlock;
    let removed: MediaReferenceBlock;

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
      ownership = new RowOwnership();
      shared = await admit(1);
      removed = await admit(2);
    });

    afterEach(async () => {
      for (const store of open.splice(0)) await store.dispose();
      await owner.releaseAll();
      await media.close();
      await rm(mediaRoot, { recursive: true, force: true });
    });

    /** A store holding `rows`, the media owner holding what they reference. */
    async function opened(rows: readonly IContent[]): Promise<RemovalStore> {
      const store: RemovalStore =
        backend === 'old'
          ? new HistoryJournalStore()
          : new JournalHistoryStore(
              await JournalSession.create(
                path.join(directory(), 'remove-tail.llxj'),
                { journal: testJournalSeams({}).dependencies },
              ),
            );
      open.push(store);
      for (const content of rows) store.apply({ kind: 'content', content });
      await store.waitForDurable();
      await owner.reconcile([], () => rows);
      return store;
    }

    it('removes and returns the last row', async () => {
      const store = await opened([row('human', 'one', 1), row('ai', 'two', 2)]);
      const tail = await store.removeTail({});
      expect(textsOf([tail!])).toStrictEqual(['two']);
      expect(store.getLength()).toBe(1);
      expect(textsOf(await rowsOf(store))).toStrictEqual(['one']);
    });

    it('returns undefined for an empty history', async () => {
      const store = await opened([]);
      expect(await store.removeTail({})).toBeUndefined();
      expect(store.getLength()).toBe(0);
    });

    it('removes nothing when the match differs and removes the row when it is equal', async () => {
      const rows = [row('human', 'one', 1), row('ai', 'two', 2)];
      const store = await opened(rows);
      expect(
        await store.removeTail({ match: row('ai', 'other', 2) }),
      ).toBeUndefined();
      expect(store.getLength()).toBe(2);
      expect((await store.removeTail({ match: rows[1] }))?.speaker).toBe('ai');
      expect(store.getLength()).toBe(1);
    });

    it('keeps media that an earlier row still references and releases media only the removed row held', async () => {
      const store = await opened([
        row('human', 'one', 1, shared),
        row('ai', 'two', 2, shared, removed),
      ]);
      expect(await held(shared, removed)).toStrictEqual([true, true]);
      await store.removeTail({ owner, ownership });
      expect(await held(shared, removed)).toStrictEqual([true, false]);
      expect(textsOf(await rowsOf(store))).toStrictEqual(['one']);
    });

    it('takes the removal back when the observer fails, restoring rows and media', async () => {
      const store = await opened([
        row('human', 'one', 1, shared),
        row('ai', 'two', 2, removed),
      ]);
      const boom = new Error('observer failed');
      await expect(
        store.removeTail({
          owner,
          ownership,
          recalculate: () => Promise.reject(new RemovalObserverFailure(boom)),
        }),
      ).rejects.toBe(boom);
      expect(store.getLength()).toBe(2);
      expect(textsOf(await rowsOf(store))).toStrictEqual(['one', 'two']);
      expect(await held(shared, removed)).toStrictEqual([true, true]);
    });

    it('keeps the removal when the recalculation fails for another reason', async () => {
      const store = await opened([
        row('human', 'one', 1),
        row('ai', 'two', 2, removed),
      ]);
      const boom = new Error('recalculation failed');
      await expect(
        store.removeTail({
          owner,
          recalculate: () => Promise.reject(boom),
        }),
      ).rejects.toBe(boom);
      expect(textsOf(await rowsOf(store))).toStrictEqual(['one']);
      expect(await held(removed)).toStrictEqual([false]);
    });

    it('puts the row back when the media publication fails', async () => {
      const store = await opened([
        row('human', 'one', 1, shared),
        row('ai', 'two', 2, removed),
      ]);
      const boom = new Error('media publication failed');
      await expect(
        store.removeTail({ owner: failingOwner(owner, boom), ownership }),
      ).rejects.toBe(boom);
      expect(store.getLength()).toBe(2);
      expect(textsOf(await rowsOf(store))).toStrictEqual(['one', 'two']);
      expect(await held(shared, removed)).toStrictEqual([true, true]);
      // The owner is settled again: a later removal succeeds.
      await store.removeTail({ owner, ownership });
      expect(await held(shared, removed)).toStrictEqual([true, false]);
    });

    it('releases the row from ownership accounting when it is done', async () => {
      const store = await opened([row('human', 'one', 1)]);
      await store.removeTail({ owner, ownership });
      expect(ownership.snapshot().liveRows).toBe(0);
    });
  },
);
