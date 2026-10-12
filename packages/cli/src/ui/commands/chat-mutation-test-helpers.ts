/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionRecordingService } from '@vybestack/llxprt-code-core/recording/SessionRecordingService.js';
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
  readonly recording: SessionRecordingService;
  readonly reader: RowOwnership;
}

export async function withChatMutationFixture<T>(
  size: number,
  execute: (fixture: ChatMutationFixture) => Promise<T>,
  bytes = 2048,
): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'chat-mutation-'));
  const recording = await SessionRecordingService.createLocked({
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
          setRecording: () => {},
        };
        await history.attachJournal(recording);
        return execute({ context, history, client, recording, reader });
      },
      bytes,
    );
  } finally {
    try {
      await recording.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
}
