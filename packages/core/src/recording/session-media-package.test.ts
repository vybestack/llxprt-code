/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import { recordRowsForTest } from '@vybestack/llxprt-code-test-utils/core/recorder-for-test.js';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { retiredJournalMessage } from '../journal/journalRefusal.js';
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { SessionLockManager } from './SessionLockManager.js';
import {
  createPackageRecorder,
  packageRecordingName,
  readPackageRows,
} from './__tests__/support/packageRecording.js';
import { JournalRecordingService } from './journalRecordingService.js';

import {
  exportSessionMediaPackage,
  importSessionMediaPackage,
} from './session-media-package.js';

const PROJECT_HASH = 'package-project';

function content(reference: MediaReferenceBlock): IContent {
  return {
    speaker: 'human',
    blocks: [reference],
    metadata: { turnId: 'package-turn' },
  };
}

class ReleaseFailingMediaStore extends LocalMediaStore {
  private releaseAttempt = 0;
  private failingAttempt = 1;

  failOnReleaseAttempt(attempt: number): void {
    this.failingAttempt = attempt;
  }

  override async release(contentId: string, ownerId: string): Promise<void> {
    this.releaseAttempt += 1;
    await super.release(contentId, ownerId);
    if (this.releaseAttempt === this.failingAttempt) {
      throw new Error('injected owner release failure');
    }
  }
}

describe('internal session media package', () => {
  let tempDirectory = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'llxprt-media-package-'));
  });

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('exports content IDs and exact blobs and imports them under a moved project root', async () => {
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'source-project', 'media'),
      quotaBytes: 1024,
    });
    const reference = await sourceStore.admit({
      bytes: new Uint8Array([11, 22, 33, 44]),
      mimeType: 'application/octet-stream',
      semanticMetadata: { origin: 'fixture' },
    });
    const recording = createPackageRecorder({
      sessionId: 'portable-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'source-project', 'chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    await recordRowsForTest(recording, [content(reference)]);
    await recording.flush();
    const sourceRecording = recording.getFilePath();
    assertNotNull(sourceRecording, 'Expected recording path');

    const packageDirectory = join(tempDirectory, 'portable-package');
    await exportSessionMediaPackage(
      sourceRecording,
      PROJECT_HASH,
      sourceStore,
      packageDirectory,
    );
    await recording.dispose();

    const manifest = await readFile(
      join(packageDirectory, 'manifest.json'),
      'utf8',
    );
    expect(manifest).toContain(reference.contentId);
    expect(manifest).not.toContain(tempDirectory);
    expect(manifest).not.toContain('\\');

    const destinationRoot = join(tempDirectory, 'moved', 'project');
    const destinationStore = new LocalMediaStore({
      rootDirectory: join(destinationRoot, 'media'),
      quotaBytes: 1024,
    });
    const imported = await importSessionMediaPackage(
      packageDirectory,
      join(destinationRoot, 'chats'),
      PROJECT_HASH,
      destinationStore,
    );
    const rows = await readPackageRows(
      imported.recordingPath,
      PROJECT_HASH,
      destinationStore,
    );
    expect(rows.map((row) => row.blocks)).toStrictEqual([[reference]]);
    expect(await destinationStore.readVerified(reference)).toStrictEqual(
      new Uint8Array([11, 22, 33, 44]),
    );
  });
  it('exports and imports every original and selected derived object', async () => {
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'derived-source-media'),
      quotaBytes: 1024,
    });
    const originalBytes = new Uint8Array([1, 2, 3, 4]);
    const selectedBytes = new Uint8Array([8, 9]);
    const reference = await sourceStore.admit({
      bytes: selectedBytes,
      mimeType: 'image/webp',
      original: { bytes: originalBytes, mimeType: 'image/png' },
      transformation: {
        policyId: 'image-resize',
        policyVersion: 1,
        parameters: { maxLongEdge: 20 },
      },
      semanticMetadata: {},
    });
    const recording = createPackageRecorder({
      sessionId: 'derived-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'derived-source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    await recordRowsForTest(recording, [content(reference)]);
    await recording.flush();
    const recordingPath = recording.getFilePath();
    assertNotNull(recordingPath, 'Expected recording path');
    const packageDirectory = join(tempDirectory, 'derived-package');

    await exportSessionMediaPackage(
      recordingPath,
      PROJECT_HASH,
      sourceStore,
      packageDirectory,
    );
    await recording.dispose();
    const packagedObjects = await readdir(
      join(packageDirectory, 'blobs', 'sha256'),
    );
    const destinationStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'derived-destination-media'),
      quotaBytes: 1024,
    });

    await importSessionMediaPackage(
      packageDirectory,
      join(tempDirectory, 'derived-destination-chats'),
      PROJECT_HASH,
      destinationStore,
    );

    expect(packagedObjects).toHaveLength(2);
    expect(
      await destinationStore.readObjectVerified(reference.originalObject),
    ).toStrictEqual(originalBytes);
    expect(await destinationStore.readVerified(reference)).toStrictEqual(
      selectedBytes,
    );
  });

  it('does not publish recording or blobs when a packaged blob is missing or corrupt', async () => {
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'source-media'),
      quotaBytes: 1024,
    });
    const reference = await sourceStore.admit({
      bytes: new Uint8Array([99, 88, 77]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const recording = createPackageRecorder({
      sessionId: 'atomic-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    await recordRowsForTest(recording, [content(reference)]);
    await recording.flush();
    const sourceRecording = recording.getFilePath();
    assertNotNull(sourceRecording, 'Expected recording path');
    const packageDirectory = join(tempDirectory, 'broken-package');
    await exportSessionMediaPackage(
      sourceRecording,
      PROJECT_HASH,
      sourceStore,
      packageDirectory,
    );
    await recording.dispose();

    const digest = reference.contentId.slice('sha256:'.length);
    await writeFile(
      join(packageDirectory, 'blobs', 'sha256', digest),
      'corrupt',
    );
    const destinationRoot = join(tempDirectory, 'destination');
    const destinationStore = new LocalMediaStore({
      rootDirectory: join(destinationRoot, 'media'),
      quotaBytes: 1024,
    });

    await expect(
      importSessionMediaPackage(
        packageDirectory,
        join(destinationRoot, 'chats'),
        PROJECT_HASH,
        destinationStore,
      ),
    ).rejects.toThrow(reference.contentId);
    expect(await destinationStore.getStoredByteLength()).toBe(0);
    await expect(readdir(join(destinationRoot, 'chats'))).rejects.toMatchObject(
      {
        code: 'ENOENT',
      },
    );
    await expect(
      stat(join(destinationStore.rootDirectory, 'objects', 'sha256', digest)),
    ).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('releases import owners before activation and leaves no publication when release fails', async () => {
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'release-source-media'),
      quotaBytes: 1024,
    });
    const reference = await sourceStore.admit({
      bytes: new Uint8Array([12, 34, 56]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const recording = createPackageRecorder({
      sessionId: 'release-order-source',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'release-source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    try {
      await recordRowsForTest(recording, [content(reference)]);
      await recording.flush();
      const recordingPath = recording.getFilePath();
      assertNotNull(recordingPath, 'Expected recording path');
      const packageDirectory = join(tempDirectory, 'release-order-package');
      await exportSessionMediaPackage(
        recordingPath,
        PROJECT_HASH,
        sourceStore,
        packageDirectory,
      );
      const destinationRoot = join(tempDirectory, 'release-order-destination');
      const destinationChats = join(destinationRoot, 'chats');
      const activationMarker = join(destinationRoot, 'activated');
      const destinationStore = new ReleaseFailingMediaStore({
        rootDirectory: join(destinationRoot, 'media'),
        quotaBytes: 1024,
      });

      await expect(
        importSessionMediaPackage(
          packageDirectory,
          destinationChats,
          PROJECT_HASH,
          destinationStore,
          async () => {
            await writeFile(activationMarker, 'activated');
          },
        ),
      ).rejects.toThrow(/owner release/);
      await expect(stat(activationMarker)).rejects.toMatchObject({
        code: 'ENOENT',
      });
      const chatEntries = await readdir(destinationChats).catch(
        (error: unknown) => {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          ) {
            return [];
          }
          throw error;
        },
      );
      expect(chatEntries).toStrictEqual([]);
    } finally {
      await recording.dispose();
    }
  });

  it('does not expose an export destination when temporary owner release fails', async () => {
    const sourceStore = new ReleaseFailingMediaStore({
      rootDirectory: join(tempDirectory, 'export-release-media'),
      quotaBytes: 1024,
    });
    sourceStore.failOnReleaseAttempt(2);
    const acquire = SessionLockManager.acquire.bind(SessionLockManager);
    const lockFailure = spyOn(SessionLockManager, 'acquire').mockImplementation(
      async (chats, id) => {
        const lock = await acquire(chats, id);
        return {
          ...lock,
          release: async () => {
            await lock.release();
            throw new Error('injected export lock release failure');
          },
        };
      },
    );
    const reference = await sourceStore.admit({
      bytes: new Uint8Array([65, 66, 67]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const recording = createPackageRecorder({
      sessionId: 'export-release-source',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'export-release-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    const packageDirectory = join(tempDirectory, 'export-release-package');
    try {
      await recordRowsForTest(recording, [content(reference)]);
      await recording.flush();
      const recordingPath = recording.getFilePath();
      assertNotNull(recordingPath, 'Expected recording path');

      await expect(
        exportSessionMediaPackage(
          recordingPath,
          PROJECT_HASH,
          sourceStore,
          packageDirectory,
        ),
      ).rejects.toThrow('injected export lock release failure');
      await expect(stat(packageDirectory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      lockFailure.mockRestore();
      await recording.dispose().catch(() => undefined);
    }
  });

  it('publishes with atomic no-overwrite behavior for existing and concurrent destinations', async () => {
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'publish-media'),
      quotaBytes: 1024,
    });
    const recording = createPackageRecorder({
      sessionId: 'publish-source',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'publish-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    try {
      await recordRowsForTest(recording, [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'publish me once' }],
        },
      ]);
      await recording.flush();
      const recordingPath = recording.getFilePath();
      assertNotNull(recordingPath, 'Expected recording path');
      const emptyDestination = join(tempDirectory, 'existing-empty-package');
      const nonemptyDestination = join(tempDirectory, 'existing-package');
      await mkdir(emptyDestination);
      await mkdir(nonemptyDestination);
      await writeFile(join(nonemptyDestination, 'keep.txt'), 'keep');

      await expect(
        exportSessionMediaPackage(
          recordingPath,
          PROJECT_HASH,
          sourceStore,
          emptyDestination,
        ),
      ).rejects.toThrow(/exist|publish/i);
      await expect(
        exportSessionMediaPackage(
          recordingPath,
          PROJECT_HASH,
          sourceStore,
          nonemptyDestination,
        ),
      ).rejects.toThrow(/exist|publish/i);
      expect(await readdir(emptyDestination)).toStrictEqual([]);
      expect(
        await readFile(join(nonemptyDestination, 'keep.txt'), 'utf8'),
      ).toBe('keep');

      const concurrentDestination = join(tempDirectory, 'concurrent-package');
      const outcomes = await Promise.allSettled([
        exportSessionMediaPackage(
          recordingPath,
          PROJECT_HASH,
          sourceStore,
          concurrentDestination,
        ),
        exportSessionMediaPackage(
          recordingPath,
          PROJECT_HASH,
          sourceStore,
          concurrentDestination,
        ),
      ]);
      expect(outcomes.map((outcome) => outcome.status).sort()).toStrictEqual([
        'fulfilled',
        'rejected',
      ]);
      expect(
        (await stat(join(concurrentDestination, 'manifest.json'))).isFile(),
      ).toBe(true);
    } finally {
      await recording.dispose();
    }
  });

  it('rolls back only files and blobs created by an import when activation fails', async () => {
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'transaction-source-media'),
      quotaBytes: 1024,
    });
    const deduplicatedBytes = new Uint8Array([10, 20, 30]);
    const newBytes = new Uint8Array([40, 50, 60, 70]);
    const deduplicatedReference = await sourceStore.admit({
      bytes: deduplicatedBytes,
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const newReference = await sourceStore.admit({
      bytes: newBytes,
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const recording = createPackageRecorder({
      sessionId: 'transaction-source',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'transaction-source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    await recordRowsForTest(recording, [content(deduplicatedReference)]);
    await recordRowsForTest(recording, [content(newReference)]);
    await recording.flush();
    const recordingPath = recording.getFilePath();
    assertNotNull(recordingPath, 'Expected recording path');
    const packageDirectory = join(tempDirectory, 'transaction-package');
    await exportSessionMediaPackage(
      recordingPath,
      PROJECT_HASH,
      sourceStore,
      packageDirectory,
    );
    await recording.dispose();

    const destinationRoot = join(tempDirectory, 'transaction-destination');
    const destinationStore = new LocalMediaStore({
      rootDirectory: join(destinationRoot, 'media'),
      quotaBytes: 1024,
    });
    await destinationStore.admit({
      bytes: deduplicatedBytes,
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const destinationChats = join(destinationRoot, 'chats');

    await expect(
      importSessionMediaPackage(
        packageDirectory,
        destinationChats,
        PROJECT_HASH,
        destinationStore,
        async () => {
          throw new Error('resume rejected imported session');
        },
      ),
    ).rejects.toThrow('resume rejected imported session');

    expect(await destinationStore.getStoredByteLength()).toBe(
      deduplicatedBytes.byteLength,
    );
    expect(
      await destinationStore.readVerified(deduplicatedReference),
    ).toStrictEqual(deduplicatedBytes);
    await expect(destinationStore.readVerified(newReference)).rejects.toThrow(
      newReference.contentId,
    );
    const chatEntries = await readdir(destinationChats).catch(
      (error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return [];
        }
        throw error;
      },
    );
    expect(chatEntries).toStrictEqual([]);
  });

  it('packages media retained by native popped rows and checkpoint state', async () => {
    const media = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'native-media'),
      quotaBytes: 1024,
    });
    const first = await media.admit({
      bytes: new Uint8Array([1, 3, 5]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const second = await media.admit({
      bytes: new Uint8Array([2, 4, 6, 8]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const recorder = createPackageRecorder({
      chatsDir: join(tempDirectory, 'native-chats'),
      projectHash: PROJECT_HASH,
    });
    if (!(recorder instanceof JournalRecordingService))
      throw new Error('Expected native recorder');
    const session = await recorder.session();
    try {
      await recordRowsForTest(recorder, [content(first), content(second)]);
      await recorder.createCheckpoint('Retained');
      const snapshot = await session.store.snapshot();
      try {
        await session.store.commit([
          {
            kind: 'pop',
            cutLabel: (await snapshot.entryAt(0)).label,
            expectedRemoved: 2,
          },
        ]);
      } finally {
        await snapshot.close();
      }
      await recordRowsForTest(recorder, [
        { speaker: 'human', blocks: [{ type: 'text', text: 'current' }] },
      ]);
    } finally {
      await recorder.dispose();
    }
    const directory = join(tempDirectory, 'native-package');
    await exportSessionMediaPackage(
      session.path,
      PROJECT_HASH,
      media,
      directory,
    );
    expect(await readdir(join(directory, 'blobs', 'sha256'))).toHaveLength(2);
    const destination = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'native-destination-media'),
      quotaBytes: 1024,
    });
    const imported = await importSessionMediaPackage(
      directory,
      join(tempDirectory, 'native-destination-chats'),
      PROJECT_HASH,
      destination,
    );
    expect(await destination.readVerified(first)).toStrictEqual(
      new Uint8Array([1, 3, 5]),
    );
    expect(await destination.readVerified(second)).toStrictEqual(
      new Uint8Array([2, 4, 6, 8]),
    );
    expect(
      (await readPackageRows(imported.recordingPath, PROJECT_HASH)).map(
        (row) => row.blocks,
      ),
    ).toStrictEqual([[{ type: 'text', text: 'current' }]]);
  });

  it('rejects unsupported package and recording versions before changing the destination', async () => {
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'version-source-media'),
      quotaBytes: 1024,
    });
    const reference = await sourceStore.admit({
      bytes: new Uint8Array([7, 7, 7]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const recording = createPackageRecorder({
      sessionId: 'version-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'version-source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    await recordRowsForTest(recording, [content(reference)]);
    await recording.flush();
    const recordingPath = recording.getFilePath();
    assertNotNull(recordingPath, 'Expected recording path');
    const packageDirectory = join(tempDirectory, 'version-package');
    await exportSessionMediaPackage(
      recordingPath,
      PROJECT_HASH,
      sourceStore,
      packageDirectory,
    );
    await recording.dispose();
    const manifestPath = join(packageDirectory, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, version: 999 }),
    );
    const destinationStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'version-destination-media'),
      quotaBytes: 1024,
    });
    const destinationChats = join(tempDirectory, 'version-destination-chats');

    await expect(
      importSessionMediaPackage(
        packageDirectory,
        destinationChats,
        PROJECT_HASH,
        destinationStore,
      ),
    ).rejects.toThrow(/version/i);
    expect(await destinationStore.getStoredByteLength()).toBe(0);
    await expect(readdir(destinationChats)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rolls back newly published blobs when the packaged recording is invalid', async () => {
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'rollback-source-media'),
      quotaBytes: 1024,
    });
    const reference = await sourceStore.admit({
      bytes: new Uint8Array([4, 3, 2, 1]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const recording = createPackageRecorder({
      sessionId: 'rollback-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'rollback-source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    await recordRowsForTest(recording, [content(reference)]);
    await recording.flush();
    const recordingPath = recording.getFilePath();
    assertNotNull(recordingPath, 'Expected recording path');
    const packageDirectory = join(tempDirectory, 'rollback-package');
    await exportSessionMediaPackage(
      recordingPath,
      PROJECT_HASH,
      sourceStore,
      packageDirectory,
    );
    await recording.dispose();
    const packagedRecordingPath = join(
      packageDirectory,
      packageRecordingName(),
    );

    const bytes = await readFile(packagedRecordingPath);
    bytes.writeUInt32LE(999, 8);
    await writeFile(packagedRecordingPath, bytes);

    const destinationStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'rollback-destination-media'),
      quotaBytes: 1024,
    });
    const destinationChats = join(tempDirectory, 'rollback-destination-chats');

    await expect(
      importSessionMediaPackage(
        packageDirectory,
        destinationChats,
        PROJECT_HASH,
        destinationStore,
      ),
    ).rejects.toThrow(retiredJournalMessage(packagedRecordingPath));
    expect(await destinationStore.getStoredByteLength()).toBe(0);
    await expect(readdir(destinationChats)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
