/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { link, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { JournalRecordingService } from './journalRecordingService.js';
import { JournalSession } from '../services/history/journalSession.js';
import { JournalResumeBoot, resumePointOf } from './journalResume.js';
import { encodeContentRow } from '../services/history/journalRowCodec.js';
import { projectRecordedContentIds } from './janitor/mediaReclamation.js';

async function fixture(): Promise<{
  root: string;
  store: LocalMediaStore;
  archive: LocalMediaStore;
  recording: JournalRecordingService;
  rejectArchive: () => void;
  rejectJournal: () => void;
}> {
  const root = await mkdtemp(join(tmpdir(), 'native-recorder-media-'));
  let archiveRejected = false;
  let journalRejected = false;
  const archive = new LocalMediaStore({
    rootDirectory: join(root, 'media'),
    quotaBytes: 1024 * 1024,
    fileOperations: {
      link: async (source, destination) => {
        if (archiveRejected) throw new Error('archive publication refused');
        await link(source, destination);
      },
    },
  });
  const store = new LocalMediaStore({
    rootDirectory: join(root, 'live'),
    quotaBytes: 1024 * 1024,
    recordingArchive: archive,
  });
  const recording = JournalRecordingService.create({
    sessionId: 'media-recording',
    projectHash: 'media-project',
    chatsDir: join(root, 'chats'),
    workspaceDirs: [root],
    provider: 'fake',
    model: 'fake',
    mediaStore: store,
    journal: {
      journal: {
        flush: () => {
          if (journalRejected) throw new Error('journal durability refused');
        },
      },
    },
  });
  return {
    root,
    store,
    archive,
    recording,
    rejectArchive: () => {
      archiveRejected = true;
    },
    rejectJournal: () => {
      journalRejected = true;
    },
  };
}

describe('native recording media archive', () => {
  it('retains both objects through clear and checkpoints, releases its lease and hydrates a reopened recording', async () => {
    const { root, store, archive, recording } = await fixture();
    const bytes = new Uint8Array([2, 4, 6, 8]);
    const original = new Uint8Array([1, 3, 5, 7, 9]);
    const reference = await store.admit({
      bytes,
      mimeType: 'image/png',
      semanticMetadata: {},
      original: { bytes: original, mimeType: 'image/png' },
      transformation: { policyId: 'test', policyVersion: 1 },
    });
    const session = await recording.session();
    await session.append([{ speaker: 'human', blocks: [reference] }]);
    const path = session.path;
    expect(
      await archive.readObjectVerified(reference.originalObject),
    ).toStrictEqual(original);
    expect(await archive.readVerified(reference)).toStrictEqual(bytes);
    expect(await archive.hasReservations(reference.contentId)).toBe(true);
    await recording.createCheckpoint('keep-image');
    await session.store.commit([{ kind: 'clear' }]);
    const protectedIds = await projectRecordedContentIds(root);
    expect(protectedIds.has(reference.originalContentId)).toBe(true);
    expect(protectedIds.has(reference.selectedContentId)).toBe(true);
    await recording.dispose();
    expect(await archive.hasReservations(reference.contentId)).toBe(false);
    await archive.reclaimUnreferenced(protectedIds, Date.now());
    expect(await archive.readVerified(reference)).toStrictEqual(bytes);
    await store.close();
    await archive.close();
    const freshArchive = new LocalMediaStore({
      rootDirectory: join(root, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const fresh = new LocalMediaStore({
      rootDirectory: join(root, 'fresh'),
      quotaBytes: 1024 * 1024,
      recordingArchive: freshArchive,
    });
    const reopened = await JournalRecordingService.open(
      {
        sessionId: 'media-recording',
        projectHash: 'media-project',
        chatsDir: join(root, 'chats'),
        workspaceDirs: [root],
        provider: 'fake',
        model: 'fake',
        mediaStore: fresh,
      },
      path,
    );
    try {
      const opened = await reopened.session();
      const checkpoint = await opened.store.checkpoint(
        (await Array.fromAsync(opened.store.checkpoints()))[0].id,
      );
      if (checkpoint === undefined) throw new Error('Missing media checkpoint');
      const saved = await opened.store.readVersion(checkpoint.trailerOffset);
      await opened.store.commit([{ kind: 'restore', saved }]);
      const boot = new JournalResumeBoot(
        reopened,
        await resumePointOf(reopened),
      );
      let rows = 0;
      for await (const row of boot.streamRows()) {
        rows++;
        expect(row.blocks).toContainEqual(reference);
      }
      expect(rows).toBe(1);
      expect(await fresh.readVerified(reference)).toStrictEqual(bytes);
      expect(
        await fresh.readObjectVerified(reference.originalObject),
      ).toStrictEqual(original);
    } finally {
      await reopened.dispose();
      await fresh.close();
      await freshArchive.close();
    }
  });

  for (const failure of ['archive', 'journal'] as const) {
    it(`reports ${failure} publication failure without releasing another recording's objects`, async () => {
      const { store, archive, recording, rejectArchive, rejectJournal } =
        await fixture();
      const old = await store.admit({
        bytes: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const next = await store.admit({
        bytes: new Uint8Array([4, 5, 6]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const session = await recording.session();
      try {
        await session.append([{ speaker: 'human', blocks: [old] }]);
        const before = session.store.published?.commitSeq;
        if (failure === 'archive') rejectArchive();
        else rejectJournal();
        await expect(
          session.append([{ speaker: 'human', blocks: [next] }]),
        ).rejects.toThrow(
          failure === 'archive'
            ? 'archive publication refused'
            : 'journal durability refused',
        );
        expect(session.store.published?.commitSeq).toBe(before);
        expect(await archive.hasReservations(next.contentId)).toBe(false);
        expect(await archive.hasReservations(old.contentId)).toBe(true);
        expect(await archive.readVerified(old)).toStrictEqual(
          new Uint8Array([1, 2, 3]),
        );
        expect(await store.readVerified(next)).toStrictEqual(
          new Uint8Array([4, 5, 6]),
        );
      } finally {
        await recording.dispose();
        expect(await archive.hasReservations(old.contentId)).toBe(false);
        await store.close();
        await archive.close();
      }
    });
  }

  it('publishes streamed rows without needing prior row text or re-reading already recorded objects', async () => {
    const { store, archive, recording, rejectArchive } = await fixture();
    const reference = await store.admit({
      bytes: new Uint8Array([9, 7, 5]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const session = await recording.session();
    try {
      await session.store.commit([
        {
          kind: 'replace',
          rows: (async function* () {
            for (let index = 0; index < 24; index++)
              yield encodeContentRow(
                {
                  speaker: 'human',
                  blocks: [
                    { type: 'text', text: 'x'.repeat(128 * 1024) },
                    reference,
                  ],
                },
                { owner: 0 },
              );
          })(),
        },
      ]);
      rejectArchive();
      await store.close();
      await session.append([
        { speaker: 'ai', blocks: [{ type: 'text', text: 'no archive I/O' }] },
      ]);
      await session.append([{ speaker: 'human', blocks: [reference] }]);
      expect(session.store.published?.rows).toBe(26);
      expect(await archive.readVerified(reference)).toStrictEqual(
        new Uint8Array([9, 7, 5]),
      );
      const observer = await JournalSession.open(session.path);
      try {
        expect(observer.store.published?.rows).toBe(26);
      } finally {
        await observer.close();
      }
    } finally {
      await recording.dispose();
      await store.close();
      await archive.close();
    }
  });
});
