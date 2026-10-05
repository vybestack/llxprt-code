/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export async function openParent(directory: string): Promise<{
  history: HistoryService;
  path: string;
  before: Buffer;
  close(): Promise<void>;
}> {
  const recording = await SessionRecordingService.createLocked({
    sessionId: 'childaccept-parent',
    projectHash: basename(directory),
    chatsDir: join(directory, 'chats'),
    workspaceDirs: [directory],
    provider: 'openai-responses',
    model: 'gpt-5.2',
  });
  const history = new HistoryService({ recording });
  history.add({
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'task-1',
        name: 'task',
        parameters: { name: 'child' },
      },
    ],
  });
  history.add({
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: 'task-1',
        toolName: 'task',
        result: 'running',
      },
    ],
  });
  await history.waitForCommit();
  const path = history.journalPath();
  if (path === null) throw new Error('Parent journal absent');
  return {
    history,
    path,
    before: await readFile(path),
    close: async () => {
      history.dispose();
      await recording.dispose();
    },
  };
}
