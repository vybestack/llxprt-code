/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getProjectHash,
  RecordingIntegration,
  type IContent,
} from '@vybestack/llxprt-code-core';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { Storage } from '@vybestack/llxprt-code-storage';

const SESSION_BROWSER_RESIZE_SESSION_ID =
  '00000000-0000-4000-8000-000000002017';

export interface SessionBrowserResizeSeedOptions {
  readonly chatsDir: string;
  readonly projectRoot: string;
}

function content(speaker: IContent['speaker'], text: string): IContent {
  return {
    speaker,
    blocks: [{ type: 'text', text }],
  };
}

/**
 * Persists an unlocked fake-provider conversation for the resize scenario.
 *
 * @param options - Project and session-storage locations for the seed.
 * @returns A promise that resolves after the session is flushed and unlocked.
 */
export async function seedSessionBrowserResize(
  options: SessionBrowserResizeSeedOptions,
): Promise<void> {
  const recording = await JournalRecordingService.createLocked({
    sessionId: SESSION_BROWSER_RESIZE_SESSION_ID,
    projectHash: getProjectHash(options.projectRoot),
    chatsDir: options.chatsDir,
    workspaceDirs: [options.projectRoot],
    cwd: options.projectRoot,
    provider: 'fake',
    model: 'fake-model',
  });

  const history = new HistoryService();
  const integration = new RecordingIntegration(recording);
  try {
    await integration.subscribeToJournal(history);
    await history.addBatch([
      content('human', 'seed isolated resize session'),
      content('ai', 'isolated resize session ready'),
    ]);
    await integration.flushAtTurnBoundary();
  } finally {
    try {
      await integration.dispose();
    } finally {
      try {
        await history.dispose();
      } finally {
        await recording.dispose();
      }
    }
  }
}

async function main(): Promise<void> {
  const projectRoot = process.cwd();
  const storage = new Storage(projectRoot);
  await seedSessionBrowserResize({
    chatsDir: storage.getProjectChatsDir(),
    projectRoot,
  });
}

if (import.meta.main) {
  await main();
}
