import { ScratchRootOwner } from '@vybestack/llxprt-code-core/storage/scratch-root.js';
import { withTestNamedWriters } from './named-writer-owner.js';
/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  LocalMediaStore,
  exportSessionMediaPackage,
  type MediaReferenceBlock,
} from '@vybestack/llxprt-code-core';
import { createLockedSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
const historyScratchRoots = new ScratchRootOwner();

export interface PortablePackageFixture {
  readonly directory: string;
  readonly references: readonly MediaReferenceBlock[];
}

export async function createPortablePackage(
  root: string,
  media: readonly Uint8Array[] = [],
  text = 'history restored through perform_resume',
): Promise<PortablePackageFixture> {
  const sourceRoot = join(root, `source-${randomUUID()}`);
  const projectHash = 'portable-source-project';
  const store = new LocalMediaStore({
    rootDirectory: join(sourceRoot, 'media'),
    quotaBytes: 1024 * 1024,
  });
  const recording = await createLockedSessionRecorder(
    withTestNamedWriters({
      sessionId: randomUUID(),
      projectHash,
      chatsDir: join(sourceRoot, 'chats'),
      workspaceDirs: [],
      provider: 'source-provider',
      model: 'source-model',
      mediaStore: store,
    }),
  );
  const history = new HistoryService({
    scratchRoots: historyScratchRoots,
    recording,
  });
  const references: MediaReferenceBlock[] = [];
  try {
    for (const bytes of media) {
      references.push(
        await store.admit({
          bytes,
          mimeType: 'image/png',
          semanticMetadata: {},
        }),
      );
    }
    history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text }, ...references],
    });
    await history.waitForCommit();
    recording.recordSessionMetadata('Portable title');
    await recording.setSessionName('portable-name');
    await recording.createCheckpoint('Portable checkpoint');
    await recording.flush();
    const path = recording.getFilePath();
    if (path === null) throw new Error('Expected source recording');
    await history.dispose();
    await recording.dispose();
    const directory = join(root, `package-${randomUUID()}`);
    await exportSessionMediaPackage(path, projectHash, store, directory);
    return { directory, references };
  } finally {
    await history.dispose();
    await recording.dispose();
    await store.close();
  }
}
