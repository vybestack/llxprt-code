/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  getProjectHash,
  SessionRecordingService,
  type IContent,
} from '@vybestack/llxprt-code-core';
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
  const recording = await SessionRecordingService.createLocked({
    sessionId: SESSION_BROWSER_RESIZE_SESSION_ID,
    projectHash: getProjectHash(options.projectRoot),
    chatsDir: options.chatsDir,
    workspaceDirs: [options.projectRoot],
    cwd: options.projectRoot,
    provider: 'fake',
    model: 'fake-model',
  });

  try {
    recording.recordContent(content('human', 'seed isolated resize session'));
    recording.recordContent(content('ai', 'isolated resize session ready'));
    await recording.flush();
  } finally {
    await recording.dispose();
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
