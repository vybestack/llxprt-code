/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createLockedSessionRecorder,
  type IContent,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { isJsonlRecorder } from '@vybestack/llxprt-code-core/services/history/recorderBackend.js';
import { JournalSession } from '@vybestack/llxprt-code-core/services/history/journalSession.js';
import { foldDurableRows } from '@vybestack/llxprt-code-core/recording/durableRowFold.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { withPublicHistory } from '../../../../agents/src/api/__tests__/helpers/public-history-fixture.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import type { CommandContext } from './types.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';

export interface ChatMutationFixture {
  readonly context: CommandContext;
  readonly history: HistoryService;
  readonly client: AgentClientContract;
  readonly recording: SessionRecordingPort;
  readonly reader: RowOwnership;
}

export async function* recordedChatRows(
  recording: SessionRecordingPort,
  history: HistoryService,
): AsyncGenerator<IContent, void, unknown> {
  await history.waitForCommit();
  await recording.flush();
  const file = recording.getFilePath();
  if (file === null) throw new Error('Missing recording path');
  if (!isJsonlRecorder(recording)) {
    const session = await JournalSession.open(file);
    try {
      for await (const row of session.rows()) yield row.content;
    } finally {
      await session.close();
    }
    return;
  }
  const fold = await foldDurableRows({
    filePath: file,
    maxBytes: (await stat(file)).size,
  });
  try {
    for (let index = 0; index < fold.length; index++)
      yield await fold.readRow(index);
  } finally {
    await fold.close();
  }
}

export async function withChatMutationFixture<T>(
  size: number,
  execute: (fixture: ChatMutationFixture) => Promise<T>,
  bytes = 2048,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'chat-mutation-'));
  const recording = await createLockedSessionRecorder({
    sessionId: crypto.randomUUID(),
    projectHash: 'chat-stream',
    chatsDir: root,
    workspaceDirs: [root],
    cwd: root,
    provider: 'test',
    model: 'test',
  });
  try {
    return await withPublicHistory(
      size,
      true,
      async (agent, history, reader) => {
        const client = agent.agentClient;
        const context = createMockCommandContext({
          services: {
            config: { getEphemeralSetting: () => undefined },
            agent: { agentClient: client },
          },
        });
        context.recordingIntegration = undefined;
        context.recordingSwapCallbacks = {
          getCurrentRecording: () => recording,
          getCurrentIntegration: () => null,
          getCurrentLockHandle: () => null,
          getCurrentMetadata: () => null,
          setRecording: () => {},
        };
        await history.attachJournal(recording);
        return execute({ context, history, client, recording, reader });
      },
      bytes,
    );
  } finally {
    await recording.dispose();
  }
}
