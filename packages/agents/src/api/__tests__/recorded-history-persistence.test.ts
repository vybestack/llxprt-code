/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { SemanticMediaPurgeStreamCoordinator } from '@vybestack/llxprt-code-core/services/history/semantic-purge-stream.js';
import { collectJournalFileRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  persistSemanticMediaPurge,
  restoreRecordedHistory,
} from '../control/recordedHistoryPersistence.js';

const image: IContent = {
  speaker: 'human',
  blocks: [
    { type: 'text', text: 'retained text' },
    {
      type: 'media',
      encoding: 'url',
      mimeType: 'image/png',
      data: 'https://example.test/image.png',
      caption: 'image caption',
    },
  ],
};

async function withJournal(
  scenario: (
    history: HistoryService,
    recording: JournalRecordingService,
    path: string,
  ) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'w17-persistence-'));
  const recording = await JournalRecordingService.createLocked({
    sessionId: 'persisted',
    projectHash: 'project',
    chatsDir: root,
    workspaceDirs: [],
    provider: 'fake',
    model: 'fake',
  });
  const history = new HistoryService({});
  try {
    history.add(image);
    await history.attachJournal(recording);
    const path = recording.getFilePath();
    if (path === null) throw new Error('Missing journal file');
    await scenario(history, recording, path);
  } finally {
    await history.dispose();
    await recording.dispose();
    await rm(root, { recursive: true, force: true });
  }
}

describe('journal history persistence', () => {
  for (const cancel of [false, true]) {
    it(`persists ${cancel ? 'rollback after a durable purge' : 'semantic purge'} without recording a second history mutation`, async () => {
      await withJournal(async (history, recording, path) => {
        const controller = new AbortController();
        const cancelled = new Error('cancel after persistence');
        let writes = 0;
        const coordinator = new SemanticMediaPurgeStreamCoordinator(history, {
          enabled: true,
          explicitCacheWriteRequired: false,
          persist: async () => {
            await persistSemanticMediaPurge(recording);
            if (cancel && ++writes === 1) controller.abort(cancelled);
          },
        });
        const transaction = await coordinator.begin({ mode: 'remove' });
        if (transaction === undefined)
          throw new Error('Missing purge transaction');
        try {
          const commit = coordinator.commit(
            transaction,
            { status: 'success', cachePrefixWritten: true },
            controller.signal,
          );
          const outcome = await commit.then(
            () => undefined,
            (error: unknown) => error,
          );
          expect(outcome).toBe(cancel ? cancelled : undefined);
          if (cancel) await restoreRecordedHistory(recording);
          await history.waitForCommit();
          await recording.flush();
          await collectJournalFileRowsForAssertions(path, (rows) => {
            expect(rows).toHaveLength(1);
            expect(rows[0].blocks.some((block) => block.type === 'media')).toBe(
              cancel,
            );
            expect(rows[0].blocks).toStrictEqual(
              cancel ? image.blocks : [image.blocks[0]],
            );
          });
        } finally {
          await transaction.close();
        }
      });
    });
  }
});
