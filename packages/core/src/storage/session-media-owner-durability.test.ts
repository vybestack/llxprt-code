/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Storage } from '@vybestack/llxprt-code-settings';
import { SessionPersistenceService } from './SessionPersistenceService.js';
import { describe, expect, it } from 'bun:test';
import { link, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from './local-media-store.js';
import { stageRecordedMedia } from './recorded-media-transfer.js';
import { SessionMediaOwner } from './session-media-owner.js';
import { SessionRecordingService } from '../recording/SessionRecordingService.js';
import { replaySession } from '../recording/ReplayEngine.js';
import {
  exportSessionMediaPackage,
  importSessionMediaPackage,
} from '../recording/session-media-package.js';
import type { IContent } from '../services/history/IContent.js';

async function withOwners(
  scenario: (
    directory: string,
    first: SessionMediaOwner,
    second: SessionMediaOwner,
  ) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), 'media-owner-durable-'));
  const first = new SessionMediaOwner(join(directory, 'first'), 1024 * 1024);
  const second = new SessionMediaOwner(join(directory, 'second'), 1024 * 1024);
  try {
    await scenario(directory, first, second);
  } finally {
    await first.dispose();
    await second.dispose();
    await rm(directory, { recursive: true, force: true });
  }
}

async function record(
  owner: SessionMediaOwner,
  directory: string,
): Promise<string> {
  const reference = await owner.store.admit({
    bytes: new Uint8Array([1, 3, 5, 7]),
    mimeType: 'image/png',
    semanticMetadata: {},
  });
  const content: IContent = { speaker: 'human', blocks: [reference] };
  const recording = new SessionRecordingService({
    sessionId: 'durable-owner',
    projectHash: 'owner-project',
    chatsDir: join(directory, 'chats'),
    workspaceDirs: [directory],
    provider: 'test',
    model: 'test-model',
    mediaStore: owner.store,
  });
  recording.recordContent(content);
  await recording.flush();
  const path = recording.getFilePath();
  await recording.dispose();
  if (path === null) throw new Error('Missing recording');
  return path;
}

describe('session media durable transfer', () => {
  it('exports a durable journal through a fresh live owner after the original closes', async () => {
    await withOwners(async (directory, first) => {
      const journal = await record(first, join(directory, 'first'));
      await first.dispose();
      const fresh = new SessionMediaOwner(
        join(directory, 'first'),
        1024 * 1024,
      );
      try {
        await exportSessionMediaPackage(
          journal,
          'owner-project',
          fresh.store,
          join(directory, 'portable'),
        );
        expect(await fresh.store.getStoredByteLength()).toBe(4);
      } finally {
        await fresh.dispose();
      }
    });
  });

  it('keeps imported references durable after the importing live owner closes', async () => {
    await withOwners(async (directory, first, second) => {
      const journal = await record(first, join(directory, 'first'));
      const portable = join(directory, 'portable');
      await exportSessionMediaPackage(
        journal,
        'owner-project',
        first.store,
        portable,
      );
      const imported = await importSessionMediaPackage(
        portable,
        join(directory, 'second', 'chats'),
        'owner-project',
        second.store,
      );
      await second.dispose();
      const fresh = new SessionMediaOwner(
        join(directory, 'second'),
        1024 * 1024,
      );
      try {
        const replay = await replaySession(
          imported.recordingPath,
          'owner-project',
          { mediaStore: fresh.store },
        );
        expect(replay.ok).toBe(true);
        if (!replay.ok) throw new Error(replay.error);
        expect(replay.history[0].blocks[0]).toMatchObject({
          encoding: 'reference',
          byteLength: 4,
        });
      } finally {
        await fresh.dispose();
      }
    });
  });
});

describe('live media store close', () => {
  it('joins an admitted filesystem operation before closing a live store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'media-close-join-'));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const store = new LocalMediaStore({
      rootDirectory: directory,
      quotaBytes: 1024,
      fileOperations: {
        link: async (source, destination) => {
          entered.resolve();
          await release.promise;
          await link(source, destination);
        },
      },
    });
    const admission = store.admit({
      bytes: new Uint8Array([2, 4, 6, 8]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    await entered.promise;
    const closing = store.close();
    try {
      expect(
        await Promise.race([
          closing.then(() => 'closed'),
          new Promise<string>((resolve) =>
            setTimeout(() => resolve('joining'), 20),
          ),
        ]),
      ).toBe('joining');
    } finally {
      release.resolve();
      await admission;
      await closing;
      await rm(directory, { recursive: true, force: true });
    }
    await expect(store.getStoredByteLength()).rejects.toThrow(/closed/i);
  });
});

describe('durable import failure cleanup', () => {
  it('removes staged live objects when durable archive admission exceeds quota', async () => {
    await withOwners(async (directory, first) => {
      const journal = await record(first, join(directory, 'first'));
      const portable = join(directory, 'portable');
      await exportSessionMediaPackage(
        journal,
        'owner-project',
        first.store,
        portable,
      );
      const limited = new SessionMediaOwner(join(directory, 'limited'), 4);
      try {
        const archive = limited.store.recordingArchive;
        if (archive === undefined) throw new Error('Missing archive');
        await archive.admit({
          bytes: new Uint8Array([8, 6, 4, 2]),
          mimeType: 'image/png',
          semanticMetadata: {},
        });
        await expect(
          importSessionMediaPackage(
            portable,
            join(directory, 'limited', 'chats'),
            'owner-project',
            limited.store,
          ),
        ).rejects.toThrow(/quota/i);
        expect(await limited.store.getStoredByteLength()).toBe(0);
      } finally {
        await limited.dispose();
      }
    });
  });
});

describe('import activation durability', () => {
  it('allows import activation to publish referenced history through the same owner', async () => {
    await withOwners(async (directory, first, second) => {
      const journal = await record(first, join(directory, 'first'));
      const portable = join(directory, 'portable');
      await exportSessionMediaPackage(
        journal,
        'owner-project',
        first.store,
        portable,
      );
      await importSessionMediaPackage(
        portable,
        join(directory, 'second', 'chats'),
        'owner-project',
        second.store,
        async (imported) => {
          const replay = await replaySession(
            imported.recordingPath,
            'owner-project',
            { mediaStore: second.store },
          );
          if (!replay.ok) throw new Error(replay.error);
          const recording = new SessionRecordingService({
            sessionId: 'activation-journal',
            projectHash: 'owner-project',
            chatsDir: join(directory, 'second', 'chats'),
            workspaceDirs: [directory],
            provider: 'test',
            model: 'test',
            mediaStore: second.store,
          });
          try {
            recording.recordContent(replay.history[0]);
            await recording.flush();
            expect(await second.store.getStoredByteLength()).toBe(4);
          } finally {
            await recording.dispose();
          }
        },
      );
    });
  }, 10000);
});

describe('known media admission close', () => {
  it('joins the external source read before owner close resolves', async () => {
    await withOwners(async (_directory, first) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const admission = first.store.admitKnown(
        {
          contentId:
            'sha256:9f64a747e1b97f131fabb6b447296c9b6f0201e79fb3c5356e6c77e89b6a806a',
          knownByteLength: 4,
          mimeType: 'image/png',
          semanticMetadata: {},
        },
        async () => {
          entered.resolve();
          await release.promise;
          return new Uint8Array([1, 2, 3, 4]);
        },
      );
      await entered.promise;
      const closing = first.dispose();
      try {
        expect(
          await Promise.race([
            closing.then(() => 'closed'),
            new Promise<string>((resolve) =>
              setTimeout(() => resolve('joining'), 20),
            ),
          ]),
        ).toBe('joining');
      } finally {
        release.resolve();
        await expect(admission).rejects.toThrow(/closed/i);
        await closing;
      }
    });
  });
});

class TemporaryMediaStorage extends Storage {
  constructor(private readonly directory: string) {
    super(directory);
  }
  override getProjectTempDir(): string {
    return this.directory;
  }
}

describe('durable prepared snapshots', () => {
  it('removes newly archived bytes when a published prepared snapshot rolls back', async () => {
    await withOwners(async (directory, first) => {
      const persistence = new SessionPersistenceService(
        {
          projectRoot: new TemporaryMediaStorage(
            join(directory, 'first'),
          ).getProjectRoot(),
          chatsDir: new TemporaryMediaStorage(
            join(directory, 'first'),
          ).getProjectChatsDir(),
        },
        'snapshot',
        { mediaStore: first.store },
      );
      const reference = await first.store.admit({
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const prepared = await persistence.prepareSave([
        { speaker: 'human', blocks: [reference] },
      ]);
      await prepared.publish();
      await prepared.rollback();
      const archive = first.store.recordingArchive;
      if (archive === undefined) throw new Error('Missing archive');
      expect(await archive.getStoredByteLength()).toBe(0);
    });
  });

  it('exports media retained only in a durable snapshot through a fresh owner', async () => {
    await withOwners(async (directory, first) => {
      const journal = await record(first, join(directory, 'first'));
      const persistence = new SessionPersistenceService(
        {
          projectRoot: new TemporaryMediaStorage(
            join(directory, 'first'),
          ).getProjectRoot(),
          chatsDir: new TemporaryMediaStorage(
            join(directory, 'first'),
          ).getProjectChatsDir(),
        },
        'durable-owner',
        { mediaStore: first.store },
      );
      const reference = await first.store.admit({
        bytes: new Uint8Array([8, 6, 4, 2]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      await persistence.save([{ speaker: 'human', blocks: [reference] }]);
      const snapshotPath = persistence.getSessionFilePath();
      const serialized = JSON.parse(await readFile(snapshotPath, 'utf8'));
      await writeFile(
        snapshotPath,
        JSON.stringify({ ...serialized, projectHash: 'owner-project' }),
      );
      await first.dispose();
      const fresh = new SessionMediaOwner(
        join(directory, 'first'),
        1024 * 1024,
      );
      try {
        await exportSessionMediaPackage(
          journal,
          'owner-project',
          fresh.store,
          join(directory, 'portable'),
        );
        expect(await fresh.store.getStoredByteLength()).toBe(8);
      } finally {
        await fresh.dispose();
      }
    });
  });
});

describe('archive staged publication protection', () => {
  it('retains staged durable objects while a concurrent purge runs before journal publication', async () => {
    await withOwners(async (_directory, first) => {
      const reference = await first.store.admit({
        bytes: new Uint8Array([3, 1, 4, 1]),
        mimeType: 'image/png',
        semanticMetadata: {},
      });
      const staged = await stageRecordedMedia(first.store, [
        { speaker: 'human', blocks: [reference] },
      ]);
      const archive = first.store.recordingArchive;
      if (archive === undefined) throw new Error('Missing archive');
      await new Promise((resolve) => setTimeout(resolve, 20));
      await archive.reclaimUnreferenced(new Set(), Date.now());
      try {
        expect(await archive.readVerified(reference)).toStrictEqual(
          new Uint8Array([3, 1, 4, 1]),
        );
      } finally {
        await staged.rollback();
      }
      expect(await archive.getStoredByteLength()).toBe(0);
    });
  });
});
