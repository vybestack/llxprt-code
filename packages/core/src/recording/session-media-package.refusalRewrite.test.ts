/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4036: the resulting-history snapshot of a `refusal_rewrite` record
 * carries media references like any other history snapshot, so a session
 * package must export and import the referenced blobs.
 */

import { assertNotNull } from '@vybestack/llxprt-code-test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IContent } from '../services/history/IContent.js';
import { LocalMediaStore } from '../storage/local-media-store.js';
import { replaySession } from './ReplayEngine.js';
import { SessionRecordingService } from './SessionRecordingService.js';
import {
  exportSessionMediaPackage,
  importSessionMediaPackage,
} from './session-media-package.js';

const PROJECT_HASH = 'package-rewrite-project';

describe('session media package with a refusal_rewrite record', () => {
  let tempDirectory = '';

  beforeEach(async () => {
    tempDirectory = await mkdtemp(join(tmpdir(), 'llxprt-rewrite-package-'));
  });

  afterEach(async () => {
    await rm(tempDirectory, { recursive: true, force: true });
  });

  it('moves the media of the resulting history and replays the rewritten text', async () => {
    const sourceStore = new LocalMediaStore({
      rootDirectory: join(tempDirectory, 'source', 'media'),
      quotaBytes: 1024,
    });
    const reference = await sourceStore.admit({
      bytes: new Uint8Array([5, 6, 7, 8]),
      mimeType: 'application/octet-stream',
      semanticMetadata: {},
    });
    const withMedia = (text: string): IContent => ({
      speaker: 'human',
      blocks: [{ type: 'text', text }, reference],
      metadata: { isSummary: true },
    });
    const recording = new SessionRecordingService({
      sessionId: 'rewrite-package-session',
      projectHash: PROJECT_HASH,
      chatsDir: join(tempDirectory, 'source', 'chats'),
      workspaceDirs: [],
      provider: 'test',
      model: 'test',
      mediaStore: sourceStore,
    });
    recording.recordContent(withMedia('original wording'));
    await recording.flush();
    const prepared = recording.prepareRefusalRewrite({
      operationId: 'op-package',
      time: '2026-11-12T10:00:00.000Z',
      promptId: 'prompt-1',
      attemptIndex: 1,
      reviewer: { provider: 'test', model: 'test' },
      explanation: 'plain wording',
      changes: [
        {
          id: 'c1.0',
          role: 'human',
          kind: 'summary',
          originalText: 'original wording',
          newText: 'rewritten wording',
        },
      ],
      resultingHistory: [withMedia('rewritten wording')],
    });
    prepared.publish();
    await prepared.finalize();
    await recording.flush();
    const sourcePath = recording.getFilePath();
    assertNotNull(sourcePath, 'Expected recording path');
    const packageDirectory = join(tempDirectory, 'package');

    await exportSessionMediaPackage(
      sourcePath,
      PROJECT_HASH,
      sourceStore,
      packageDirectory,
    );
    await recording.dispose();
    const destinationRoot = join(tempDirectory, 'moved');
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

    assertNotNull(replay.ok ? replay : null, 'Expected a successful replay');
    expect({
      texts: replay.ok
        ? replay.history.flatMap((c) =>
            c.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])),
          )
        : [],
      blob: await destinationStore.readVerified(reference),
    }).toStrictEqual({
      texts: ['rewritten wording'],
      blob: new Uint8Array([5, 6, 7, 8]),
    });
  });
});
