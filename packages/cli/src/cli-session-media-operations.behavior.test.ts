/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  LocalMediaStore,
  SessionRecordingService,
  getProjectHash,
} from '@vybestack/llxprt-code-core';
import { CliSessionPersistence } from './cliSessionPersistence.js';

describe('CLI recording media operations', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('creates, discovers, renames and deletes checkpoints with their retained media owner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cli-recording-media-'));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const chatsDir = join(root, 'chats');
    const media = new LocalMediaStore({
      rootDirectory: join(root, 'media'),
      quotaBytes: 4096,
    });
    cleanups.push(() => media.close());
    const recording = await SessionRecordingService.createLocked({
      sessionId: crypto.randomUUID(),
      chatsDir,
      projectHash: getProjectHash(root),
      workspaceDirs: [root],
      cwd: root,
      provider: 'fake',
      model: 'fake-model',
      mediaStore: media,
    });
    cleanups.push(() => recording.dispose());
    const reference = await media.admit({
      bytes: new TextEncoder().encode('attachment body'),
      mimeType: 'text/plain',
      semanticMetadata: { mediaType: 'document' },
    });
    recording.recordContent({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'attached source' }, reference],
    });
    const owner = new CliSessionPersistence(
      { projectRoot: root, chatsDir },
      { mediaStore: media },
    );
    await owner.createCheckpoint(recording, 'source', false);
    const listing = await owner.listBrowserTargetsDetailed();
    const checkpoint = listing.targets.find(
      (target) => target.kind === 'checkpoint',
    );
    if (!checkpoint) throw new Error('Checkpoint missing');
    expect(checkpoint.checkpointName).toBe('source');
    await owner.renameCheckpoint(recording, checkpoint, 'renamed', false);
    const renamed = (await owner.listBrowserTargetsDetailed()).targets.find(
      (target) => target.kind === 'checkpoint',
    );
    expect(renamed?.kind === 'checkpoint' && renamed.checkpointName).toBe(
      'renamed',
    );
    await owner.deleteBrowserTarget(checkpoint, recording);
    expect(
      (await owner.listBrowserTargetsDetailed()).targets.filter(
        (target) => target.kind === 'checkpoint',
      ),
    ).toHaveLength(0);
    owner.close();
    expect(new TextDecoder().decode(await media.readVerified(reference))).toBe(
      'attachment body',
    );
  });
});
