/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  createSessionRecorder,
  getProjectHash,
} from '@vybestack/llxprt-code-core';
import { seedSessionRows } from './journal-recording.js';
import { Storage } from '@vybestack/llxprt-code-settings';

export async function recordStartupSession(
  root: string,
): Promise<{ path: string; id: string }> {
  const id = crypto.randomUUID();
  const recording = createSessionRecorder({
    sessionId: id,
    projectHash: getProjectHash(root),
    chatsDir: new Storage(root).getProjectChatsDir(),
    workspaceDirs: [root],
    provider: 'fake',
    model: 'fake-model',
  });
  await seedSessionRows(recording, [
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'session seed' }],
    },
  ]);
  await recording.flush();
  const path = recording.getFilePath();
  if (!path) throw new Error('Session file was not created');
  await recording.dispose();
  return { id, path };
}
