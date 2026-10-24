/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { gzipSync } from 'node:zlib';
import { useTempDir } from '../../journal/__tests__/support/useTempDir.js';
import { JOURNAL_HEADER_BYTES } from '../../journal/fileHeader.js';
import { openJournalReadOnly } from '../../journal/journalReader.js';
import { RECORD_KIND } from '../../journal/recordKinds.js';
import { HistoryService } from '../../services/history/HistoryService.js';
import { JournalSession } from '../../services/history/journalSession.js';
import { HistoryMediaOwnership } from '../../storage/history-media-ownership.js';
import { LocalMediaStore } from '../../storage/local-media-store.js';

type HistoryBackend = 'journal';

import {
  recordJournal,
  userRow,
} from '../__tests__/support/recordedJournals.js';
import { RecordingIntegration } from '../RecordingIntegration.js';
import { createLockedSessionRecorder } from '../sessionRecorderFactory.js';
import {
  projectRecordedContentIds,
  reclaimSessionMedia,
} from './mediaReclamation.js';
import { resolveRetentionConfig } from './retentionPolicy.js';
import { runSessionCleanup } from './sessionJanitor.js';

const PROJECT = 'a'.repeat(64);
const BACKENDS: readonly HistoryBackend[] = ['journal'];

async function firstRowBody(filePath: string): Promise<number> {
  const reader = await openJournalReadOnly(filePath);
  try {
    let offset = JOURNAL_HEADER_BYTES;
    while (offset < reader.fileSize) {
      const head = await reader.readRecordHead(offset);
      if (head.kind === RECORD_KIND.ROW) return head.bodyOffset;
      offset = head.endOffset;
    }
    throw new Error('No ROW body found');
  } finally {
    await reader.close();
  }
}

describe('validated journal media ownership without persisted snapshots', () => {
  const directory = useTempDir('media-reclamation-journal-');

  const chatsDir = (): string => path.join(directory(), PROJECT, 'chats');

  async function media(): Promise<{
    store: LocalMediaStore;
    reference: Awaited<ReturnType<LocalMediaStore['admit']>>;
    objectPath: string;
  }> {
    const store = new LocalMediaStore({
      rootDirectory: path.join(directory(), PROJECT, 'media'),
      quotaBytes: 1024 * 1024,
    });
    const reference = await store.admit({
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    return {
      store,
      reference,
      objectPath: path.join(
        store.rootDirectory,
        'objects',
        'sha256',
        reference.contentId.slice(7),
      ),
    };
  }

  for (const backend of BACKENDS) {
    it(`keeps turn media after owner shutdown and reclaims it only after session cleanup on ${backend}`, async () => {
      const { store, reference, objectPath } = await media();
      const recording = await createLockedSessionRecorder({
        sessionId: 'media-turn',
        projectHash: PROJECT,
        chatsDir: chatsDir(),
        workspaceDirs: ['/work'],
        provider: 'test',
        model: 'test',
        mediaStore: store,
      });
      const history = new HistoryService();
      const integration = new RecordingIntegration(recording);
      let file: string;
      try {
        await history.registerMediaOwner(new HistoryMediaOwnership(store));
        await integration.subscribeToJournal(history);
        await history.addBatch([{ speaker: 'human', blocks: [reference] }]);
        await integration.flushAtTurnBoundary();
        await history.waitForOwnershipSettlement();
        expect(await store.hasReservations(reference.contentId)).toBe(true);
        const recorded = recording.getFilePath();
        if (recorded === null) throw new Error('No session recording');
        file = recorded;
        const snapshots = (await fsp.readdir(chatsDir())).filter((name) =>
          name.endsWith('.json'),
        );
        expect(snapshots.length).toBe(0);
      } finally {
        await integration.dispose();
        await history.dispose();
        await history.waitForOwnershipSettlement();
        await recording.dispose();
      }
      try {
        await expect(store.hasReservations(reference.contentId)).resolves.toBe(
          false,
        );
        await expect(reclaimSessionMedia(directory(), undefined)).resolves.toBe(
          0,
        );
        expect(await store.readVerified(reference)).toStrictEqual(
          new Uint8Array([1, 2, 3]),
        );
        const persisted = (await fsp.readdir(chatsDir())).filter((name) =>
          name.startsWith('persisted-session-'),
        );
        for (const name of persisted)
          await fsp.unlink(path.join(chatsDir(), name));
        await store.reserve(reference, 'in-flight');
        const old = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
        await fsp.utimes(file, old, old);
        const result = await runSessionCleanup({
          globalTempDir: directory(),
          config: resolveRetentionConfig({ maxAge: '3d' }),
          quiet: true,
        });
        expect(result.rawDeleted).toBe(1);
        await expect(fsp.stat(file)).rejects.toMatchObject({ code: 'ENOENT' });
        expect((await fsp.stat(objectPath)).isFile()).toBe(true);
        await store.release(reference.contentId, 'in-flight');
        await expect(reclaimSessionMedia(directory(), undefined)).resolves.toBe(
          0,
        );
        await expect(fsp.stat(objectPath)).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        await store.close();
      }
    });
  }

  it('retains and reports a corrupt binary journal rather than treating a regex match as validation', async () => {
    const { store, objectPath } = await media();
    try {
      await fsp.mkdir(chatsDir(), { recursive: true });
      await fsp.writeFile(
        path.join(chatsDir(), 'session-broken.llxj'),
        'not a journal',
      );
      expect(await reclaimSessionMedia(directory(), undefined)).toBe(1);
      expect((await fsp.stat(objectPath)).isFile()).toBe(true);
      await expect(
        projectRecordedContentIds(path.dirname(chatsDir())),
      ).rejects.toThrow('retired JSONL journal format');
    } finally {
      await store.close();
    }
  });

  it('retains and reports a refused binary archive without a scratch decompression file', async () => {
    const { store, objectPath } = await media();
    try {
      const { filePath } = await recordJournal(chatsDir(), 'archive', {
        rows: [userRow('valid')],
      });
      await fsp.writeFile(
        `${filePath}.gz`,
        gzipSync(await fsp.readFile(filePath)),
      );
      await fsp.unlink(filePath);
      expect(await reclaimSessionMedia(directory(), undefined)).toBe(1);
      expect((await fsp.stat(objectPath)).isFile()).toBe(true);
    } finally {
      await store.close();
    }
  });

  it('does not treat an unrelated metadata contentId as a media reference', async () => {
    const { store, reference, objectPath } = await media();
    try {
      await recordJournal(chatsDir(), 'not-media', {
        rows: [
          {
            ...userRow('plain'),
            metadata: { providerMetadata: { contentId: reference.contentId } },
          },
        ],
      });
      expect([
        ...(await projectRecordedContentIds(path.dirname(chatsDir()))),
      ]).toStrictEqual([]);
      expect(await reclaimSessionMedia(directory(), undefined)).toBe(0);
      await expect(fsp.stat(objectPath)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await store.close();
    }
  });

  it('reports a committed ROW body CRC failure and preserves the entire project', async () => {
    const { store, reference, objectPath } = await media();
    try {
      const { filePath } = await recordJournal(chatsDir(), 'body-crc', {
        rows: [userRow('payload'), { speaker: 'human', blocks: [reference] }],
      });
      const bodyOffset = await firstRowBody(filePath);
      const handle = await fsp.open(filePath, 'r+');
      try {
        const byte = Buffer.alloc(1);
        await handle.read(byte, 0, 1, bodyOffset);
        byte[0] ^= 1;
        await handle.write(byte, 0, 1, bodyOffset);
      } finally {
        await handle.close();
      }
      await expect(
        projectRecordedContentIds(path.dirname(chatsDir())),
      ).rejects.toThrow('CRC');
      expect(await reclaimSessionMedia(directory(), undefined)).toBe(1);
      expect((await fsp.stat(objectPath)).isFile()).toBe(true);
    } finally {
      await store.close();
    }
  });

  it('retains and reports a journal above the existing 256 MiB scan ceiling', async () => {
    const { store, objectPath } = await media();
    try {
      const { filePath } = await recordJournal(chatsDir(), 'oversize', {
        rows: [userRow('small')],
      });
      await fsp.truncate(filePath, 256 * 1024 * 1024 + 1);
      expect(await reclaimSessionMedia(directory(), undefined)).toBe(1);
      expect((await fsp.stat(objectPath)).isFile()).toBe(true);
      await expect(
        projectRecordedContentIds(path.dirname(chatsDir())),
      ).rejects.toThrow('scan limits');
    } finally {
      await store.close();
    }
  });

  it('decodes one large row at a time and includes missing and retained checkpoint media', async () => {
    const { store, reference, objectPath } = await media();
    try {
      const { filePath } = await recordJournal(chatsDir(), 'large-row', {
        rows: [
          userRow('large'.repeat(80 * 1024)),
          { speaker: 'human', blocks: [reference] },
        ],
        checkpoints: ['saved'],
      });
      const session = await JournalSession.open(filePath);
      try {
        const snapshot = await session.store.snapshot();
        try {
          await session.store.commit([
            {
              kind: 'pop',
              cutLabel: (await snapshot.entryAt(1)).label,
              expectedRemoved: 1,
            },
          ]);
        } finally {
          await snapshot.close();
        }
        expect(session.store.published?.rows).toBe(1);
      } finally {
        await session.close();
      }
      await fsp.unlink(objectPath);
      const ids = await projectRecordedContentIds(path.dirname(chatsDir()));
      expect([...ids]).toStrictEqual([reference.contentId]);
      expect(await reclaimSessionMedia(directory(), undefined)).toBe(0);
      expect((await fsp.stat(filePath)).isFile()).toBe(true);
    } finally {
      await store.close();
    }
  });
});
