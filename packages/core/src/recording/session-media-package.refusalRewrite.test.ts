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
import { HistoryService } from '../services/history/HistoryService.js';
import { JournalSession } from '../services/history/journalSession.js';
import { ScratchRootOwner } from '../storage/scratch-root.js';
import {
  withTestNamedWriters,
  testJournalOptions,
} from '../journal/__tests__/support/namedWriterOwner.js';
import { JournalRecordingService } from './journalRecordingService.js';
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
    const recording = JournalRecordingService.create(
      withTestNamedWriters({
        sessionId: 'rewrite-package-session',
        projectHash: PROJECT_HASH,
        chatsDir: join(tempDirectory, 'source', 'chats'),
        workspaceDirs: [],
        provider: 'test',
        model: 'test',
        mediaStore: sourceStore,
      }),
    );
    const history = new HistoryService({
      scratchRoots: new ScratchRootOwner(),
      recording,
    });
    await history.registerRuntimeMediaOwner(sourceStore);
    await history.addBatch([withMedia('original wording')]);
    await recording.flush();
    const payload = {
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
    };
    await history.detachedValues.transform(
      async (source, sink) => {
        let index = 0;
        for await (const row of source.streamRows())
          await sink.appendDerived(index++, {
            ...row,
            blocks: row.blocks.map((block) =>
              block.type === 'text'
                ? { ...block, text: 'rewritten wording' }
                : block,
            ),
          });
      },
      undefined,
      {
        audit: {
          key: 'refusal_rewrite:op-package',
          value: new TextEncoder().encode(JSON.stringify(payload)),
        },
      },
    );
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
    await history.dispose();
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
      undefined,
      testJournalOptions(),
    );
    const replay = await JournalSession.open(
      imported.recordingPath,
      testJournalOptions(),
    );
    const texts: string[] = [];
    try {
      for await (const { content } of replay.rows())
        texts.push(
          ...content.blocks.flatMap((block) =>
            block.type === 'text' ? [block.text] : [],
          ),
        );
      expect(
        await replay.store.getMeta('refusal_rewrite:op-package'),
      ).toBeDefined();
    } finally {
      await replay.close();
    }
    expect({
      texts,
      blob: await destinationStore.readVerified(reference),
    }).toStrictEqual({
      texts: ['rewritten wording'],
      blob: new Uint8Array([5, 6, 7, 8]),
    });
  });
});
