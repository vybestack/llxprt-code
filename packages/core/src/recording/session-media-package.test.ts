/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
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
import type {
  IContent,
  MediaReferenceBlock,
} from '../services/history/IContent.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { replaySession } from './ReplayEngine.js';
import { SessionRecordingService } from './SessionRecordingService.js';
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
    const recording = new SessionRecordingService({
      sessionId: 'portable-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'source-project', 'chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    recording.recordContent(content(reference));
    await recording.flush();
    const sourceRecording = recording.getFilePath();
    if (sourceRecording === null) throw new Error('Expected recording path');

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
    const replay = await replaySession(imported.recordingPath, PROJECT_HASH, {
      mediaStore: destinationStore,
    });

    expect(replay.ok).toBe(true);
    expect(await destinationStore.readVerified(reference)).toEqual(
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
    const recording = new SessionRecordingService({
      sessionId: 'derived-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'derived-source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    recording.recordContent(content(reference));
    await recording.flush();
    const recordingPath = recording.getFilePath();
    if (recordingPath === null) throw new Error('Expected recording path');
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
    ).toEqual(originalBytes);
    expect(await destinationStore.readVerified(reference)).toEqual(
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
    const recording = new SessionRecordingService({
      sessionId: 'atomic-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    recording.recordContent(content(reference));
    await recording.flush();
    const sourceRecording = recording.getFilePath();
    if (sourceRecording === null) throw new Error('Expected recording path');
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
    const recording = new SessionRecordingService({
      sessionId: 'release-order-source',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'release-source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    try {
      recording.recordContent(content(reference));
      await recording.flush();
      const recordingPath = recording.getFilePath();
      if (recordingPath === null) throw new Error('Expected recording path');
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
      expect(chatEntries).toEqual([]);
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
    const reference = await sourceStore.admit({
      bytes: new Uint8Array([65, 66, 67]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const recording = new SessionRecordingService({
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
      recording.recordContent(content(reference));
      await recording.flush();
      const recordingPath = recording.getFilePath();
      if (recordingPath === null) throw new Error('Expected recording path');

      await expect(
        exportSessionMediaPackage(
          recordingPath,
          PROJECT_HASH,
          sourceStore,
          packageDirectory,
        ),
      ).rejects.toThrow(/owner release|reservation release/i);
      await expect(stat(packageDirectory)).rejects.toMatchObject({
        code: 'ENOENT',
      });
    } finally {
      await recording.dispose().catch(() => undefined);
    }
  });

  it('publishes with atomic no-overwrite behavior for existing and concurrent destinations', async () => {
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'publish-media'),
      quotaBytes: 1024,
    });
    const recording = new SessionRecordingService({
      sessionId: 'publish-source',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'publish-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    try {
      recording.recordContent({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'publish me once' }],
      });
      await recording.flush();
      const recordingPath = recording.getFilePath();
      if (recordingPath === null) throw new Error('Expected recording path');
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
      expect(await readdir(emptyDestination)).toEqual([]);
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
      expect(outcomes.map((outcome) => outcome.status).sort()).toEqual([
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
    const recording = new SessionRecordingService({
      sessionId: 'transaction-source',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'transaction-source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    recording.recordContent(content(deduplicatedReference));
    recording.recordContent(content(newReference));
    await recording.flush();
    const recordingPath = recording.getFilePath();
    if (recordingPath === null) throw new Error('Expected recording path');
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
    expect(await destinationStore.readVerified(deduplicatedReference)).toEqual(
      deduplicatedBytes,
    );
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
    expect(chatEntries).toEqual([]);
  });

  it('packages media from rewound recording events and sibling persisted session state', async () => {
    const sourceRoot = join(tempDirectory, 'complete-source');
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(sourceRoot, 'media'),
      quotaBytes: 1024,
    });
    const recordingOnly = await sourceStore.admit({
      bytes: new Uint8Array([1, 3, 5]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const persistedOnly = await sourceStore.admit({
      bytes: new Uint8Array([2, 4, 6, 8]),
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const recording = new SessionRecordingService({
      sessionId: 'complete-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(sourceRoot, 'chats'),
      workspaceDirs: [join(sourceRoot, 'workspace')],
      cwd: sourceRoot,
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    recording.recordContent(content(recordingOnly));
    recording.recordRewind(1);
    await recording.flush();
    const recordingPath = recording.getFilePath();
    if (recordingPath === null) throw new Error('Expected recording path');
    await writeFile(
      join(sourceRoot, 'chats', 'persisted-session-extra.json'),
      JSON.stringify({
        version: 1,
        sessionId: 'complete-session',
        projectHash: PROJECT_HASH,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        history: [content(persistedOnly)],
      }),
    );
    const packageDirectory = join(tempDirectory, 'complete-package');

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
    const packagedRecording = await readFile(
      join(packageDirectory, 'session.jsonl'),
      'utf8',
    );
    expect(packagedObjects).toHaveLength(2);
    expect(packagedRecording).not.toContain(sourceRoot);
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
    const recording = new SessionRecordingService({
      sessionId: 'version-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'version-source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    recording.recordContent(content(reference));
    await recording.flush();
    const recordingPath = recording.getFilePath();
    if (recordingPath === null) throw new Error('Expected recording path');
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
    const recording = new SessionRecordingService({
      sessionId: 'rollback-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'rollback-source-chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    recording.recordContent(content(reference));
    await recording.flush();
    const recordingPath = recording.getFilePath();
    if (recordingPath === null) throw new Error('Expected recording path');
    const packageDirectory = join(tempDirectory, 'rollback-package');
    await exportSessionMediaPackage(
      recordingPath,
      PROJECT_HASH,
      sourceStore,
      packageDirectory,
    );
    await recording.dispose();
    const packagedRecordingPath = join(packageDirectory, 'session.jsonl');
    const lines = (await readFile(packagedRecordingPath, 'utf8'))
      .trim()
      .split('\n');
    const contentLine = JSON.parse(lines[1] ?? '{}');
    lines[1] = JSON.stringify({ ...contentLine, v: 999 });
    await writeFile(packagedRecordingPath, `${lines.join('\n')}\n`);
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
    ).rejects.toThrow(/recording version/i);
    expect(await destinationStore.getStoredByteLength()).toBe(0);
    await expect(readdir(destinationChats)).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
